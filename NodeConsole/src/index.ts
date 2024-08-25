// noinspection SqlResolve,JSUnusedLocalSymbols

import * as AWS from 'aws-sdk';
import * as AWSXRay from 'aws-xray-sdk-core';
import {APIGatewayProxyEvent, APIGatewayProxyResult} from 'aws-lambda';

const XRayAWS = AWSXRay.captureAWS(AWS);

const region = process.env.AWS_REGION || 'us-east-1';
const ec2 = new XRayAWS.EC2({region});
const rds = new XRayAWS.RDS({region});
const rdsCluster = new XRayAWS.RDS({region, apiVersion: '2014-10-31'});
const autoscaling = new XRayAWS.AutoScaling({region});
const cloudWatch = new XRayAWS.CloudWatch({region});
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};
const DEPENDS_ON_TAG = 'depends-on';
const STOP_START_PASSWORD_TAG = 'Stop-Start-Password';
const START_PASSWORD_TAG = 'Start-Password';
const STOP_PASSWORD_TAG = 'Stop-Password';

function getPasswordFromTags(tags: AWS.AutoScaling.Tags | AWS.EC2.Tag[]  | AWS.RDS.Tag[], action: 'start' | 'stop'): string | undefined {
    const combinedPassword = tags.find(tag => tag.Key === STOP_START_PASSWORD_TAG)?.Value;
    const startPassword = tags.find(tag => tag.Key === START_PASSWORD_TAG)?.Value;
    const stopPassword = tags.find(tag => tag.Key === STOP_PASSWORD_TAG)?.Value;
    if (action === 'start') {
        return combinedPassword || startPassword;
    } else {
        return combinedPassword || stopPassword;
    }
}

interface SimpleAutoScalingGroup {
    AutoScalingGroupName: string | undefined;
    DesiredCapacity: number | undefined;
    MinSize: number | undefined;
    MaxSize: number | undefined;
    Status: string | undefined;
}

async function listAutoScalingGroups(): Promise<SimpleAutoScalingGroup[]> {
    const result = await autoscaling.describeAutoScalingGroups().promise();
    return (result.AutoScalingGroups || []).map(group => ({
        AutoScalingGroupName: group.AutoScalingGroupName,
        DesiredCapacity: group.DesiredCapacity,
        MinSize: group.MinSize,
        MaxSize: group.MaxSize,
        Status: group.Status
    }));
}

async function changeAutoScalingGroupState(groupName: string, action: 'start' | 'stop', password?: string): Promise<void> {
    const group = (await autoscaling.describeAutoScalingGroups({AutoScalingGroupNames: [groupName]}).promise()).AutoScalingGroups?.[0];
    if (!group) {
        throw new Error('Auto Scaling Group not found');
    }
    const tags = group.Tags || [];
    const requiredPassword = getPasswordFromTags(tags, action);
    if (!requiredPassword || requiredPassword !== password) {
        throw new Error('Invalid password');
    }
    if (action === 'start') {
        await autoscaling.updateAutoScalingGroup({
            AutoScalingGroupName: groupName,
            DesiredCapacity: 1,
            MinSize: 1
        }).promise();
    } else {
        await autoscaling.updateAutoScalingGroup({
            AutoScalingGroupName: groupName,
            DesiredCapacity: 0,
            MinSize: 0
        }).promise();
    }
}


interface SimpleInstance {
    InstanceId: string | undefined;
    InstanceType: string | undefined;
    State: string | undefined;
    Name: string | undefined;
    PublicIpAddress: string | undefined;
    LaunchTime: Date | undefined;
    IdleMetrics: {
        isIdle: boolean;
        networkInDatapoints: Array<{ Timestamp: Date; Sum: number }>;
        cpuUtilizationDatapoints: Array<{ Timestamp: Date; Average: number }>;
    };
}

interface SimpleRDSInstance {
    DBInstanceIdentifier: string | undefined;
    DBInstanceClass: string | undefined;
    DBInstanceStatus: string | undefined;
    Engine: string | undefined;
    Endpoint: {
        Address?: string | undefined;
        Port?: number | undefined;
    } | undefined;
    IsCluster: boolean;
}


async function listInstances(): Promise<SimpleInstance[]> {
    const params: AWS.EC2.DescribeInstancesRequest = {
        Filters: [
            {
                Name: 'instance-state-name',
                Values: ['stopped', 'stopping', 'running']
            }
        ]
    };
    const result = await ec2.describeInstances(params).promise();
    const instances = result.Reservations?.flatMap(r => r.Instances?.filter(instance =>
        instance.Tags?.some(tag => [STOP_START_PASSWORD_TAG, START_PASSWORD_TAG, STOP_PASSWORD_TAG].includes(tag.Key!))
    ).map(async instance => ({
        InstanceId: instance.InstanceId,
        InstanceType: instance.InstanceType,
        State: instance.State?.Name,
        Name: instance.Tags?.find(tag => tag.Key === 'Name')?.Value,
        PublicIpAddress: instance.PublicIpAddress,
        LaunchTime: instance.LaunchTime,
        IdleMetrics: await getIdleMetrics(instance.InstanceId || '', '1h')
    })) || []) || [];
    return Promise.all(instances);
}

async function listRDSInstances(): Promise<SimpleRDSInstance[]> {
    const [instancesResult, clustersResult] = await Promise.all([
        rds.describeDBInstances().promise(),
        rdsCluster.describeDBClusters().promise()
    ]);
    const instances = await Promise.all((instancesResult.DBInstances || []).map(async (instance): Promise<SimpleRDSInstance | null> => {
        const tags = await rds.listTagsForResource({ResourceName: instance.DBInstanceArn || ''}).promise();
        if (tags.TagList?.some(tag => [STOP_START_PASSWORD_TAG, START_PASSWORD_TAG, STOP_PASSWORD_TAG].includes(tag.Key!))) {
            return {
                DBInstanceIdentifier: instance.DBInstanceIdentifier,
                DBInstanceClass: instance.DBInstanceClass,
                DBInstanceStatus: instance.DBInstanceStatus,
                Engine: instance.Engine,
                Endpoint: instance.Endpoint,
                IsCluster: false
            };
        }
        return null;
    }));
    const clusters = await Promise.all((clustersResult.DBClusters || []).map(async (cluster): Promise<SimpleRDSInstance | null> => {
        const tags = await rdsCluster.listTagsForResource({ResourceName: cluster.DBClusterArn || ''}).promise();
        if (tags.TagList?.some(tag => [STOP_START_PASSWORD_TAG, START_PASSWORD_TAG, STOP_PASSWORD_TAG].includes(tag.Key!))) {
            return {
                DBInstanceIdentifier: cluster.DBClusterIdentifier,
                DBInstanceClass: 'N/A',
                DBInstanceStatus: cluster.Status,
                Engine: cluster.Engine,
                Endpoint: {
                    Address: cluster.Endpoint,
                    Port: cluster.Port
                },
                IsCluster: true
            };
        }
        return null;
    }));
    return [...instances, ...clusters].filter((instance): instance is SimpleRDSInstance => instance !== null);
}

async function getIdleMetrics(instanceId: string, idleTime: string): Promise<{
    isIdle: boolean;
    networkInDatapoints: Array<{ Timestamp: Date; Sum: number }>
    cpuUtilizationDatapoints: Array<{ Timestamp: Date; Average: number }>
}> {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - parseIdleTime(idleTime));
    const networkParams: AWS.CloudWatch.GetMetricStatisticsInput = {
        Namespace: 'AWS/EC2',
        MetricName: 'NetworkIn',
        Dimensions: [{Name: 'InstanceId', Value: instanceId}],
        StartTime: startTime,
        EndTime: endTime,
        Period: 300,
        Statistics: ['Sum']
    };
    const cpuParams: AWS.CloudWatch.GetMetricStatisticsInput = {
        Namespace: 'AWS/EC2',
        MetricName: 'CPUUtilization',
        Dimensions: [{Name: 'InstanceId', Value: instanceId}],
        StartTime: startTime,
        EndTime: endTime,
        Period: 300,
        Statistics: ['Average']
    };
    const [networkData, cpuData] = await Promise.all([
        cloudWatch.getMetricStatistics(networkParams).promise(),
        cloudWatch.getMetricStatistics(cpuParams).promise()
    ]);
    const networkDatapoints = networkData.Datapoints || [];
    const cpuDatapoints = cpuData.Datapoints || [];
    const isNetworkIdle = networkDatapoints.length > 5 && networkDatapoints.every(dp => dp.Sum === 0);
    const isCpuIdle = cpuDatapoints.length > 5 && cpuDatapoints.every(dp => (dp.Average || 0) < 10);
    const isIdle = isNetworkIdle && isCpuIdle;

    return {
        isIdle,
        networkInDatapoints: networkDatapoints.map(dp => ({Timestamp: dp.Timestamp!, Sum: dp.Sum!})),
        cpuUtilizationDatapoints: cpuDatapoints.map(dp => ({
            Timestamp: dp.Timestamp!,
            Average: dp.Average!
        })).sort((a, b) => a.Timestamp.getTime() - b.Timestamp.getTime())
    };
}

async function resolveDependencies(instanceId: string, isRDS: boolean, isCluster: boolean): Promise<void> {
    let tags;
    if (isRDS) {
        if (isCluster) {
            const cluster = (await rdsCluster.describeDBClusters({DBClusterIdentifier: instanceId}).promise()).DBClusters?.[0];
            const tagsResult = await rdsCluster.listTagsForResource({ResourceName: cluster?.DBClusterArn || ''}).promise();
            tags = tagsResult.TagList;
        } else {
            const instance = (await rds.describeDBInstances({DBInstanceIdentifier: instanceId}).promise()).DBInstances?.[0];
            if (instance?.DBInstanceArn) {
                const tagsResult = await rds.listTagsForResource({ResourceName: instance.DBInstanceArn}).promise();
                tags = tagsResult.TagList;
            } else {
                throw new Error('Unable to retrieve RDS instance ARN');
            }
        }
    } else {
        const instance = (await ec2.describeInstances({InstanceIds: [instanceId]}).promise()).Reservations?.[0]?.Instances?.[0];
        tags = instance?.Tags || [];
    }
    const dependsOnTag = tags?.find((tag: AWS.RDS.Tag) => tag.Key === DEPENDS_ON_TAG);
    if (dependsOnTag && dependsOnTag.Value) {
        const dependencies = dependsOnTag.Value.split(',');
        for (const dependency of dependencies) {
            const [resourceType, resourceId] = dependency.trim().split(':');
            switch (resourceType) {
                case 'ec2':
                    await changeInstanceState(resourceId, 'start', undefined, false, false);
                    break;
                case 'rds':
                    await changeInstanceState(resourceId, 'start', undefined, true, false);
                    break;
                case 'rds-cluster':
                    await changeInstanceState(resourceId, 'start', undefined, true, true);
                    break;
                case 'asg':
                    await changeAutoScalingGroupState(resourceId, 'start');
                    break;
                default:
                    console.warn(`Unknown dependency type: ${resourceType}`);
            }
        }
    }
}

async function changeInstanceState(instanceId: string, action: 'start' | 'stop', password?: string, isRDS: boolean = false, isCluster: boolean = false): Promise<void> {
    if (isRDS) {
        return changeRDSInstanceState(instanceId, action, password, isCluster);
    }
    const params: AWS.EC2.StartInstancesRequest = {
        InstanceIds: [instanceId]
    };
    const instance = (await ec2.describeInstances({InstanceIds: [instanceId]}).promise()).Reservations?.[0]?.Instances?.[0];
    const requiredPassword = getPasswordFromTags(instance?.Tags || [], action);
    if (!requiredPassword || requiredPassword !== password) {
        throw new Error('Invalid password');
    }


    if (action === 'start') {
        await resolveDependencies(instanceId, isRDS, isCluster);
        await ec2.startInstances(params).promise();
    } else {
        await ec2.stopInstances(params).promise();
    }
}

async function changeRDSInstanceState(instanceId: string, action: 'start' | 'stop', password?: string, isCluster: boolean = false): Promise<void> {
    let tags;
    if (isCluster) {
        const cluster = (await rdsCluster.describeDBClusters({DBClusterIdentifier: instanceId}).promise()).DBClusters?.[0];
        tags = await rdsCluster.listTagsForResource({ResourceName: cluster?.DBClusterArn || ''}).promise();
    } else {
        const instance = (await rds.describeDBInstances({DBInstanceIdentifier: instanceId}).promise()).DBInstances?.[0];
        if (instance?.DBInstanceArn) {
            tags = await rds.listTagsForResource({ResourceName: instance.DBInstanceArn}).promise();
        } else {
            throw new Error('Unable to retrieve RDS instance ARN');
        }
    }

    const tagList = tags?.TagList || [];
    const requiredPassword = getPasswordFromTags(tagList, action);
    if (!requiredPassword || requiredPassword !== password) {
        throw new Error('Invalid password');
    }

    if (action === 'start') {
        await resolveDependencies(instanceId, true, isCluster);
        if (isCluster) {
            await rdsCluster.startDBCluster({DBClusterIdentifier: instanceId}).promise();
        } else {
            await rds.startDBInstance({DBInstanceIdentifier: instanceId}).promise();
        }
    } else {
        if (isCluster) {
            await rdsCluster.stopDBCluster({DBClusterIdentifier: instanceId}).promise();
        } else {
            await rds.stopDBInstance({DBInstanceIdentifier: instanceId}).promise();
        }
    }
}


function parseIdleTime(idleTime: string): number {
    const value = parseInt(idleTime);
    const unit = idleTime.slice(-1).toLowerCase();
    switch (unit) {
        case 'm':
            return value * 60 * 1000;
        case 'h':
            return value * 60 * 60 * 1000;
        default:
            throw new Error('Invalid idle time format');
    }
}


export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: ''
            };
        } else if (event.httpMethod === 'GET') {
            const [ec2Instances, rdsInstances, asgGroups] = await Promise.all([
                listInstances(),
                listRDSInstances(),
                listAutoScalingGroups()
            ]);
            return {
                statusCode: 200,
                body: JSON.stringify({ec2: ec2Instances, rds: rdsInstances, asg: asgGroups}),
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/json'
                }
            };
        } else if (event.httpMethod === 'POST') {
            const body = event.body ? JSON.parse(event.body) : {};
            const {instanceId, password, action, isRDS, isASG, isCluster} = body;
            if (!instanceId || !password || !action || (isRDS === undefined && isASG === undefined) || (isRDS && isCluster === undefined)) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({error: 'instanceId, password, action, either isRDS or isASG, and isCluster (for RDS) are required'}),
                    headers: {...corsHeaders, 'Content-Type': 'application/json'}
                };
            }
            if (action !== 'start' && action !== 'stop') {
                return {
                    statusCode: 400,
                    body: JSON.stringify({error: 'Invalid action. Must be either "start" or "stop"'}),
                    headers: {...corsHeaders, 'Content-Type': 'application/json'}
                };
            }

            if (isASG) {
                await changeAutoScalingGroupState(instanceId, action, password);
            } else {
                await changeInstanceState(instanceId, action, password, isRDS, isCluster);
            }
            return {
                statusCode: 200,
                body: JSON.stringify({message: `${isASG ? 'Auto Scaling Group' : (isRDS ? (isCluster ? 'RDS Cluster' : 'RDS Instance') : 'EC2')} ${instanceId} ${action}ed successfully`}),
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/json'
                }
            };
        } else {
            return {
                statusCode: 405,
                body: JSON.stringify({error: 'Method not allowed'}),
                headers: {...corsHeaders, 'Content-Type': 'application/json'}
            };
        }
    } catch (error: unknown) {
        console.error('Error:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        return {
            statusCode: 500,
            body: JSON.stringify({error: errorMessage}),
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
            }
        };
    }
};