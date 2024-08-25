// noinspection SqlResolve,JSUnusedLocalSymbols

import * as AWS from 'aws-sdk';
import {AutoScaling, EC2, RDS} from 'aws-sdk';
import * as AWSXRay from 'aws-xray-sdk-core';
import {isScheduleMatch, parseSchedule} from './utils/cronUtils';
import {checkCPUIdleTime, checkNetworkIdleTime, checkRDSIdleTime} from './utils/networkUtils';
import {checkELBStatus} from './utils/elbUtils';
import {Instance, Reservation, Tag} from 'aws-sdk/clients/ec2';
import {AutoScalingGroup} from 'aws-sdk/clients/autoscaling';
import {DBCluster, DBInstance} from 'aws-sdk/clients/rds';
import {performance} from 'perf_hooks';
import {Set} from 'immutable';
import {hasDependencies, startDependency} from './utils/dependencyUtils';
import {RateLimiter} from "./utils/rateLimiter";

const XRayAWS = AWSXRay.captureAWS(AWS);

export const ec2: EC2 = new XRayAWS.EC2();
export const rds: RDS = new XRayAWS.RDS();
export const autoscaling: AutoScaling = new XRayAWS.AutoScaling();
export const elb = new XRayAWS.ELBv2();
type ManageableResource = EC2.Instance | DBInstance | DBCluster | AutoScalingGroup;


// Define an interface for resource managers
interface ResourceManager<T extends ManageableResource> {
    getResourcesToManage(): Promise<T[]>;

    manageResource(resource: T): Promise<void>;
}

async function getRDSResourcesToManage(): Promise<(DBInstance | DBCluster)[]> {
    console.log('Fetching RDS resources to manage...');
    const instanceParams: RDS.DescribeDBInstancesMessage = {};
    const clusterParams: RDS.DescribeDBClustersMessage = {};
    try {
        const [instanceData, clusterData] = await Promise.all([
            rds.describeDBInstances(instanceParams).promise(),
            rds.describeDBClusters(clusterParams).promise()
        ]);
        const instances = (instanceData.DBInstances || []).filter(instance =>
            instance.TagList?.some(tag => tag.Key === 'AutoStart' || tag.Key === 'AutoStop')
        );
        const clusters = (clusterData.DBClusters || []).filter(cluster =>
            cluster.TagList?.some(tag => tag.Key === 'AutoStart' || tag.Key === 'AutoStop')
        );
        console.log(`Found ${instances.length} RDS instances and ${clusters.length} RDS clusters to manage.`);
        return [...instances, ...clusters];
    } catch (error) {
        console.error('Error fetching RDS resources:', error);
        throw error;
    }

}

function isDBCluster(resource: DBInstance | DBCluster): resource is DBCluster {
    return 'DBClusterIdentifier' in resource;
}

async function manageRDSResource(resource: DBInstance | DBCluster) {
    const isCluster = isDBCluster(resource);
    const resourceId = isCluster ? resource.DBClusterIdentifier : resource.DBInstanceIdentifier;
    console.log(`Managing RDS ${isCluster ? 'cluster' : 'instance'} ${resourceId}`);
    const resourceArn = isCluster ? resource.DBClusterArn : resource.DBInstanceArn;
    const tags = resourceArn ? await getRDSTags(resourceArn) : [];
    console.log(`Full tag list for RDS ${isCluster ? 'cluster' : 'instance'} ${resourceId}:`, JSON.stringify(tags, null, 2));
    const autoStart = tags.find(t => t.Key === 'AutoStart')?.Value === 'true';
    const autoStop = tags.find(t => t.Key === 'AutoStop')?.Value === 'true';
    const startSchedule = tags.find(t => t.Key === 'start-schedule')?.Value;
    const stopSchedule = tags.find(t => t.Key === 'stop-schedule')?.Value;
    const dependsOn = tags.find(t => t.Key === 'depends-on')?.Value;
    const toBeStarted = tags.find(t => t.Key === 'to-be-started')?.Value === 'true';
    const maxIdleTime = tags.find(t => t.Key === 'max-idle-time')?.Value;
    const idleConnectionThreshold = parseInt(tags.find(t => t.Key === 'idle-connection-threshold')?.Value || '0');
    const now = new Date();
    const status = isCluster ? resource.Status : resource.DBInstanceStatus;
    console.log(`RDS ${isCluster ? 'cluster' : 'instance'} state: ${status}, AutoStart: ${autoStart}, AutoStop: ${autoStop}`);
    if ((autoStart && status === 'stopped' && startSchedule && isScheduleMatch(parseSchedule(startSchedule), now)) ||
        (toBeStarted && status === 'stopped')) {
        console.log(`Starting RDS ${isCluster ? 'cluster' : 'instance'} ${resourceId} based on schedule or to-be-started flag`);
        await startRDSResource(resourceId!, isCluster, dependsOn);
    }
    if (autoStop && status === 'available') {
        // Check if any running resources depend on this RDS resource
        const hasDependents = await checkRDSDependents(resourceArn!);
        if (hasDependents) {
            console.log(`Cannot stop RDS ${isCluster ? 'cluster' : 'instance'} ${resourceId} due to existing dependencies`);
            return;
        }
        console.log(`Checking stop conditions for RDS ${isCluster ? 'cluster' : 'instance'} ${resourceId}`);

        if (stopSchedule && isScheduleMatch(parseSchedule(stopSchedule), now)) {
            console.log(`Stopping RDS ${isCluster ? 'cluster' : 'instance'} ${resourceId} based on schedule`);
            await stopRDSResource(resourceId!, isCluster);
        } else if (maxIdleTime && await checkRDSIdleTime(resourceId!, isCluster, maxIdleTime, idleConnectionThreshold)) {
            console.log(`Stopping RDS ${isCluster ? 'cluster' : 'instance'} ${resourceId} due to max idle time`);
            await stopRDSResource(resourceId!, isCluster);
        }
    }
}

async function checkRDSDependents(resourceArn: string): Promise<boolean> {
    console.log(`Checking for dependents of RDS resource: ${resourceArn}`);
    // Check EC2 instances
    const ec2Params = {
        Filters: [
            // Filter by tag:depends-on
            {Name: 'tag:depends-on', Values: [resourceArn]},
            // Only include running instances
            {Name: 'instance-state-name', Values: ['running']}
        ]
    };
    const ec2Data = await ec2.describeInstances(ec2Params).promise();
    const runningEc2Instances = ec2Data.Reservations?.flatMap(r => r.Instances || []) || [];
    console.log(`Found ${runningEc2Instances.length} running EC2 instances dependent on ${resourceArn}`);
    // Check Auto Scaling groups
    const asgParams = {
        Filters: [
            // Filter by tag:depends-on
            {Name: 'tag:depends-on', Values: [resourceArn]}
            // No need to filter by desired capacity since we only care about active ASGs
        ]
    };
    const asgData = await autoscaling.describeAutoScalingGroups(asgParams).promise();
    const activeASGs = asgData.AutoScalingGroups?.filter(asg => asg.DesiredCapacity > 0) || [];
    console.log(`Found ${activeASGs.length} active Auto Scaling Groups dependent on ${resourceArn}`);
    const hasDependents = runningEc2Instances.length > 0 || activeASGs.length > 0;
    console.log(`RDS resource ${resourceArn} has dependents: ${hasDependents}`);
    return hasDependents;
}

async function getRDSTags(resourceArn: string): Promise<RDS.Tag[]> {
    const params: RDS.ListTagsForResourceMessage = {
        ResourceName: resourceArn
    };
    const data = await rds.listTagsForResource(params).promise();
    return data.TagList || [];
}

async function startRDSResource(resourceId: string, isCluster: boolean, dependsOn?: string, visited: Set<string> = Set()) {
    console.log(`Starting RDS ${isCluster ? 'cluster' : 'instance'} ${resourceId}...`);
    try {
        if (dependsOn && !visited.has(resourceId)) {
            const newVisited = visited.add(resourceId);
            console.log(`Checking dependency ${dependsOn} before starting RDS ${isCluster ? 'cluster' : 'instance'} ${resourceId}`);
            if (dependsOn.startsWith('arn:aws:rds:')) {
                await startDependentRDSInstance(dependsOn, newVisited);
            } else if (dependsOn.startsWith('arn:aws:ec2:')) {
                await startDependentEC2Instance(dependsOn, newVisited);
            } else {
                console.log(`No stop conditions met for RDS ${isCluster ? 'cluster' : 'instance'} ${resourceId}`);
                console.warn(`Invalid ARN format for dependency: ${dependsOn}. Skipping dependency check.`);
            }
            console.log(`Dependency check complete. Proceeding to start RDS ${isCluster ? 'cluster' : 'instance'} ${resourceId}`);
        }

        if (isCluster) {
            await rds.startDBCluster({DBClusterIdentifier: resourceId}).promise();
        } else {
            await rds.startDBInstance({DBInstanceIdentifier: resourceId}).promise();
        }
        console.log(`Started RDS ${isCluster ? 'cluster' : 'instance'} ${resourceId}`);
    } catch (error) {
        console.error(`Error starting RDS ${isCluster ? 'cluster' : 'instance'} ${resourceId}:`, error);
        throw error;
    }
    const rdsArn = `arn:aws:rds:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:${isCluster ? 'cluster' : 'db'}:${resourceId}`;
    const tags = await getRDSTags(rdsArn);
    const toBeStartedTag = tags.find(t => t.Key === 'to-be-started' && t.Value === 'true');
    if (toBeStartedTag) {
        // Remove the to-be-started tag
        await rds.removeTagsFromResource({
            ResourceName: rdsArn,
            TagKeys: ['to-be-started']
        }).promise();
        console.log(`Removed to-be-started tag from RDS ${isCluster ? 'cluster' : 'instance'} ${resourceId}`);
    } else {
        console.log(`No to-be-started tag found on RDS ${isCluster ? 'cluster' : 'instance'} ${resourceId}`);
    }
}

async function stopRDSResource(resourceId: string, isCluster: boolean) {
    console.log(`Stopping RDS ${isCluster ? 'cluster' : 'instance'} ${resourceId}...`);
    if (isCluster) {
        await rds.stopDBCluster({DBClusterIdentifier: resourceId}).promise();
    } else {
        await rds.stopDBInstance({DBInstanceIdentifier: resourceId}).promise();
    }
    console.log(`Stopped RDS ${isCluster ? 'cluster' : 'instance'} ${resourceId}`);
}

export async function startDependentRDSInstance(arn: string, visited: Set<string>) {
    const resourceId = arn.split(':').pop();
    if (!resourceId) {
        console.log(`Invalid RDS ARN: ${arn}`);
        return;
    }
    const isCluster = arn.includes(':cluster:');
    let resource;
    if (isCluster) {
        const params: RDS.DescribeDBClustersMessage = {
            DBClusterIdentifier: resourceId
        };
        const data = await rds.describeDBClusters(params).promise();
        resource = data.DBClusters?.[0];
    } else {
        const params: RDS.DescribeDBInstancesMessage = {
            DBInstanceIdentifier: resourceId
        };
        const data = await rds.describeDBInstances(params).promise();
        resource = data.DBInstances?.[0];
    }
    if (resource) {
        const isResourceStopped = isCluster
            ? (resource as DBCluster).Status === 'stopped'
            : (resource as DBInstance).DBInstanceStatus === 'stopped';
        if (isResourceStopped) {
            console.log(`Starting dependent RDS ${isCluster ? 'cluster' : 'instance'} ${resourceId}`);
            const tags = await getRDSTags(arn);
            const dependsOnTag = tags.find(t => t.Key === 'depends-on');
            await startRDSResource(resourceId, isCluster, dependsOnTag?.Value, visited);
        }
    }
}

export async function startDependentEC2Instance(arn: string, _visited: Set<string>) {
    const instanceId = arn.split(':').pop()?.split('/').pop();
    if (!instanceId) {
        console.log(`Invalid EC2 ARN: ${arn}`);
        return;
    }
    const instance = await getEC2Instance(instanceId);
    if (instance && instance.State?.Name === 'stopped') {
        await startInstance(instanceId);
    }
}


async function getInstancesToManage(): Promise<EC2.Instance[]> {
    console.log('Fetching instances to manage...');
    const params: EC2.DescribeInstancesRequest = {
        Filters: [
            {Name: 'instance-state-name', Values: ['running', 'stopped']},
            {Name: 'tag-key', Values: ['AutoStart', 'AutoStop', 'AutoTerminate']}
        ]
    };
    const data = await ec2.describeInstances(params).promise();
    const instances = data.Reservations?.flatMap((r: Reservation) => r.Instances || []) || [];
    console.log(`Found ${instances.length} instances to manage.`);
    return instances;
}

async function getEC2Instance(instanceId: string): Promise<Instance | undefined> {
    const params: EC2.DescribeInstancesRequest = {
        InstanceIds: [instanceId]
    };
    const data = await ec2.describeInstances(params).promise();
    const instances = data.Reservations?.flatMap((r: Reservation) => r.Instances || []) || [];
    return instances[0];
}


async function manageInstance(instance: EC2.Instance) {
    console.log(`Managing instance ${instance.InstanceId}`);
    const tags = instance.Tags || [];
    console.log(`Full tag list for EC2 instance ${instance.InstanceId}:`, JSON.stringify(tags, null, 2));
    const autoStart = tags.find((t: Tag) => t.Key === 'AutoStart')?.Value === 'true';
    const autoStop = tags.find((t: Tag) => t.Key === 'AutoStop')?.Value === 'true';
    const autoTerminate = tags.find((t: Tag) => t.Key === 'AutoTerminate')?.Value === 'true';
    const startSchedule = tags.find((t: Tag) => t.Key === 'start-schedule')?.Value;
    const stopSchedule = tags.find((t: Tag) => t.Key === 'stop-schedule')?.Value;
    const maxRuntime = tags.find((t: Tag) => t.Key === 'max-runtime')?.Value;
    const idleStopTime = tags.find((t: Tag) => t.Key === 'idle-stop-time')?.Value;
    const cpuIdleStopTime = tags.find((t: Tag) => t.Key === 'cpu-idle-stop-time')?.Value;
    const networkIdleThreshold = parseInt(tags.find((t: Tag) => t.Key === 'network-idle-threshold')?.Value || '0');
    const cpuIdleThreshold = parseFloat(tags.find((t: Tag) => t.Key === 'cpu-idle-threshold')?.Value || '10');
    const dependsOn = tags.find((t: Tag) => t.Key === 'depends-on')?.Value;
    const toBeStarted = tags.find((t: Tag) => t.Key === 'to-be-started')?.Value === 'true';
    const now = new Date();
    console.log(`Instance state: ${instance.State?.Name}, AutoStart: ${autoStart}, AutoStop: ${autoStop}, AutoTerminate: ${autoTerminate}`);
    if ((autoStart && instance.State?.Name === 'stopped' && startSchedule && isScheduleMatch(parseSchedule(startSchedule), now)) ||
        (toBeStarted && instance.State?.Name === 'stopped')) {
        console.log(`Starting instance ${instance.InstanceId} based on schedule or to-be-started flag`);
        await startInstance(instance.InstanceId!, dependsOn);
        return; // Exit after attempting to start the instance or its dependency
    }
    if (autoStop && instance.State?.Name === 'running') {
        if (dependsOn) {
            console.log(`Instance ${instance.InstanceId} depends on ${dependsOn}. Checking dependency before stop operation.`);
            return;
        }
        if (stopSchedule && isScheduleMatch(parseSchedule(stopSchedule), now)) {
            console.log(`Stopping instance ${instance.InstanceId} based on schedule`);
            await stopInstance(instance.InstanceId!);
        } else if (maxRuntime && checkMaxRuntime(instance, maxRuntime)) {
            console.log(`Stopping instance ${instance.InstanceId} due to max runtime`);
            await stopInstance(instance.InstanceId!);
        } else if (idleStopTime && await checkNetworkIdleTime(instance.InstanceId!, idleStopTime, networkIdleThreshold)) {
            console.log(`Stopping instance ${instance.InstanceId} due to idle time`);
            await stopInstance(instance.InstanceId!);
        } else if (cpuIdleStopTime && await checkCPUIdleTime(instance.InstanceId!, cpuIdleStopTime, cpuIdleThreshold)) {
            console.log(`Stopping instance ${instance.InstanceId} due to CPU idle time`);
            await stopInstance(instance.InstanceId!);
        }
    }
    if (autoTerminate && instance.State?.Name === 'running' && maxRuntime && checkMaxRuntime(instance, maxRuntime)) {
        const hasDependents = await hasDependencies(instance.InstanceId!);
        if (hasDependents) {
            console.log(`Cannot terminate instance ${instance.InstanceId} due to existing dependencies`);
            return;
        }
        console.log(`Terminating instance ${instance.InstanceId} due to max runtime`);
        // Add a tag to indicate that the instance is being terminated
        await ec2.createTags({
            Resources: [instance.InstanceId!],
            Tags: [{Key: 'TerminationInProgress', Value: 'true'}]
        }).promise();
        await terminateInstance(instance.InstanceId!);
    }
}

async function startInstance(instanceId: string, dependsOn?: string, visited: Set<string> = Set()) {
    console.log(`Starting instance ${instanceId}...`);
    if (dependsOn && !visited.has(instanceId)) {
        const newVisited = visited.add(instanceId);
        console.log(`Checking dependency ${dependsOn} before starting instance ${instanceId}`);
        if (dependsOn.startsWith('arn:aws:rds:')) {
            await startDependentRDSInstance(dependsOn, newVisited);
        } else if (dependsOn.startsWith('arn:aws:ec2:')) {
            await startDependentEC2Instance(dependsOn, newVisited);
        } else {
            console.log(`Invalid ARN format for dependency: ${dependsOn}. Skipping dependency check.`);
        }
        console.log(`Dependency check complete. Proceeding to start instance ${instanceId}`);
    }
    await ec2.startInstances({InstanceIds: [instanceId]}).promise();
    const params: EC2.DescribeTagsRequest = {
        Filters: [{
            Name: 'resource-id',
            Values: [instanceId]
        }, {
            Name: 'key', Values: ['to-be-started']
        }, {
            Name: 'value', Values: ['true']
        }]
    };
    const tagData = await ec2.describeTags(params).promise();
    const toBeStartedTag = tagData.Tags?.find(tag => tag.Value === 'true');
    if (toBeStartedTag) {
        // Remove the to-be-started tag
        await ec2.deleteTags({
            Resources: [instanceId],
            Tags: [{Key: 'to-be-started'}]
        }).promise();
        console.log(`Removed to-be-started tag from instance ${instanceId}`);
    } else {
        console.log(`No to-be-started tag found on instance ${instanceId}`);
    }
    console.log(`Started instance ${instanceId}`);
}

async function stopInstance(instanceId: string) {
    console.log(`Stopping instance ${instanceId}...`);
    await ec2.stopInstances({InstanceIds: [instanceId]}).promise();
    console.log(`Stopped instance ${instanceId}`);
}

async function terminateInstance(instanceId: string) {
    console.log(`Terminating instance ${instanceId}...`);
    await ec2.terminateInstances({InstanceIds: [instanceId]}).promise();
    console.log(`Terminated instance ${instanceId}`);
}

function checkMaxRuntime(instance: EC2.Instance, maxRuntime: string): boolean {
    const launchTime = instance.LaunchTime;
    if (!launchTime) {
        console.log(`No launch time available for instance ${instance.InstanceId}`);
        return false;
    }
    const now = new Date();
    const runningTime = (now.getTime() - launchTime.getTime()) / 1000 / 60 / 60; // in hours
    const maxRuntimeHours = parseInt(maxRuntime.replace('h', ''));
    console.log(`Instance ${instance.InstanceId} running time: ${runningTime.toFixed(2)} hours, max runtime: ${maxRuntimeHours} hours`);
    return runningTime >= maxRuntimeHours;
}

async function getAutoScalingGroupsToManage(): Promise<AutoScalingGroup[]> {
    console.log('Fetching Auto Scaling groups to manage...');
    const params = {}; // Remove the filter to get all ASGs
    const data = await autoscaling.describeAutoScalingGroups(params).promise();
    const groups = data.AutoScalingGroups || [];
    console.log(`Found ${groups.length} Auto Scaling groups in total.`);
    const groupsToManage = groups.filter(group =>
        group.Tags?.some(tag => tag.Key === 'AutoStart' || tag.Key === 'AutoStop' || tag.Key === 'depends-on')
    );
    console.log(`Found ${groupsToManage.length} Auto Scaling groups to manage or with dependencies.`);
    return groupsToManage;
    return groups;
}

const rateLimiter = new RateLimiter(5);

// Generic function to manage resources
async function manageResources<T extends ManageableResource>(
    manager: ResourceManager<T>
) {
    const resources = await manager.getResourcesToManage();
    for (const resource of resources) {
        await rateLimiter.add(() => manager.manageResource(resource));
    }
}

async function manageAutoScalingGroup(group: AutoScalingGroup) {
    console.log(`Managing Auto Scaling group ${group.AutoScalingGroupName}`);
    const tags: Tag[] = group.Tags || [];
    console.log(`Full tag list for Auto Scaling group ${group.AutoScalingGroupName}:`, JSON.stringify(tags, null, 2));
    const autoStart = tags.find((t) => t.Key === 'AutoStart')?.Value === 'true';
    const autoStop = tags.find((t) => t.Key === 'AutoStop')?.Value === 'true';
    const startSchedule = tags.find((t) => t.Key === 'start-schedule')?.Value;
    const stopSchedule = tags.find((t) => t.Key === 'stop-schedule')?.Value;
    const dependsOn = tags.find((t) => t.Key === 'depends-on')?.Value;
    const now = new Date();
    if (autoStart && group.DesiredCapacity === 0 && startSchedule && isScheduleMatch(parseSchedule(startSchedule), now)) {
        console.log(`Starting Auto Scaling group ${group.AutoScalingGroupName} based on schedule`);
        await startAutoScalingGroup(group.AutoScalingGroupName, dependsOn);
    }
    if (autoStop && group.DesiredCapacity > 0 && stopSchedule && isScheduleMatch(parseSchedule(stopSchedule), now)) {
        if (dependsOn) {
            console.log(`Auto Scaling group ${group.AutoScalingGroupName} depends on ${dependsOn}. Checking dependency before stop operation.`);
            return;
        }
        console.log(`Stopping Auto Scaling group ${group.AutoScalingGroupName} based on schedule`);
        await stopAutoScalingGroup(group.AutoScalingGroupName);
    }
}

const DEFAULT_ASG_DESIRED_CAPACITY = process.env.DEFAULT_ASG_DESIRED_CAPACITY || '1';
const DEFAULT_ASG_MIN_SIZE = process.env.DEFAULT_ASG_MIN_SIZE || '1';

async function startAutoScalingGroup(groupName: string, dependsOn?: string, visited: Set<string> = Set()) {
    console.log(`Starting Auto Scaling group ${groupName}...`);
    if (dependsOn) {
        console.log(`Checking dependency ${dependsOn} before starting Auto Scaling group ${groupName}`);
        await startDependency(dependsOn, visited.add(groupName));
        console.log(`Dependency check complete. Proceeding to start Auto Scaling group ${groupName}`);
    }
    const params = {
        AutoScalingGroupName: groupName,
        DesiredCapacity: parseInt(DEFAULT_ASG_DESIRED_CAPACITY),
        MinSize: parseInt(DEFAULT_ASG_MIN_SIZE)
    };
    await autoscaling.updateAutoScalingGroup(params).promise();
    console.log(`Started Auto Scaling group ${groupName}`);
}

export async function startDependentAutoScalingGroup(arn: string, visited: Set<string>) {
    const groupName = arn.split(':').pop();
    if (!groupName) {
        console.log(`Invalid Auto Scaling group ARN: ${arn}`);
        return;
    }
    const params = {
        AutoScalingGroupNames: [groupName]
    };
    const data = await autoscaling.describeAutoScalingGroups(params).promise();
    const group = data.AutoScalingGroups?.[0];
    if (group && group.DesiredCapacity === 0) {
        console.log(`Starting dependent Auto Scaling group ${groupName}`);
        await startAutoScalingGroup(groupName, group.Tags?.find(t => t.Key === 'depends-on')?.Value, visited);
    }
}

async function stopAutoScalingGroup(groupName: string) {
    console.log(`Stopping Auto Scaling group ${groupName}...`);
    const params = {
        AutoScalingGroupName: groupName,
        DesiredCapacity: 0,
        MinSize: 0
    };
    await autoscaling.updateAutoScalingGroup(params).promise();
    console.log(`Stopped Auto Scaling group ${groupName}`);
}

async function monitorELBAndActivateResources() {
    console.log('Monitoring ELB and activating resources if necessary...');
    const loadBalancers = await elb.describeLoadBalancers().promise();
    for (const lb of loadBalancers.LoadBalancers || []) {
        console.log(`Processing Load Balancer: ${lb.LoadBalancerName}`);
        const elbTags = await elb.describeTags({ResourceArns: [lb.LoadBalancerArn!]}).promise();
        console.log(`Full tag list for ELB ${lb.LoadBalancerName}:`, JSON.stringify(elbTags.TagDescriptions?.[0]?.Tags, null, 2));
        const elbStatus = await checkELBStatus(lb.LoadBalancerArn!);
        if (elbStatus.noHandlersAvailable && elbStatus.hasIncomingRequests) {
            console.log(`ELB ${lb.LoadBalancerName} has no handlers and incoming requests. Activating associated resources.`);
            // Activate associated ASG
            const asgTags = await autoscaling.describeTags({
                Filters: [{Name: 'key', Values: ['AssociatedELB']}, {Name: 'value', Values: [lb.LoadBalancerArn!]}]
            }).promise();
            for (const tag of asgTags.Tags || []) {
                await startAutoScalingGroup(tag.ResourceId!);
            }
            // Activate associated RDS
            const dbInstances = await rds.describeDBInstances().promise();
            for (const dbInstance of dbInstances.DBInstances || []) {
                const rdsTags = await rds.listTagsForResource({ResourceName: dbInstance.DBInstanceArn!}).promise();
                const associatedELBTag = rdsTags.TagList?.find(tag => tag.Key === 'AssociatedELB' && tag.Value === lb.LoadBalancerArn);
                if (associatedELBTag) {
                    console.log(`Starting associated RDS instance: ${dbInstance.DBInstanceIdentifier}`);
                    await startRDSResource(dbInstance.DBInstanceIdentifier!, false);
                }
            }
        }
    }
}


export async function handler(event: any, context: any) {
    const startTime = performance.now();
    console.log('Event:', JSON.stringify(event));
    console.log('Context:', JSON.stringify(context));
    try {
        await manageResources({
            getResourcesToManage: getInstancesToManage,
            manageResource: manageInstance
        });
        await manageResources({
            getResourcesToManage: getRDSResourcesToManage,
            manageResource: manageRDSResource
        });
        await manageResources({
            getResourcesToManage: getAutoScalingGroupsToManage,
            manageResource: manageAutoScalingGroup
        });
        // Add ELB monitoring and resource activation
        await monitorELBAndActivateResources();

        const endTime = performance.now();
        const executionTime = (endTime - startTime) / 1000;
        console.log(`Lambda execution completed in ${executionTime.toFixed(2)} seconds`);
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'EC2, RDS instances, RDS clusters, and Auto Scaling group management completed successfully',
                executionTime: `${executionTime.toFixed(2)} seconds`
            })
        };
    } catch (error: unknown) {
        console.error('Error in lambda handler:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'Error occurred during EC2, RDS, and Auto Scaling group management',
                error: error instanceof Error ? error.message : String(error)
            })
        };
    }
}