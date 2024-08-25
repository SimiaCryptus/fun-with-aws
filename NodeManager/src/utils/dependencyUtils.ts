import {Set} from 'immutable';
import {
    autoscaling,
    ec2,
    rds,
    startDependentAutoScalingGroup,
    startDependentEC2Instance,
    startDependentRDSInstance
} from '../index';

export async function startDependency(arn: string, visited: Set<string>) {
    if (visited.has(arn)) {
        console.warn(`Circular dependency detected for ARN: ${arn}. Skipping to prevent infinite loop.`);
        return;
    }
    visited = visited.add(arn);
    if (arn.startsWith('arn:aws:rds:')) {
        await startDependentRDSInstance(arn, visited);
    } else if (arn.startsWith('arn:aws:ec2:')) {
        await startDependentEC2Instance(arn, visited);
    } else if (arn.startsWith('arn:aws:autoscaling:')) {
        await startDependentAutoScalingGroup(arn, visited);
    } else {
        console.warn(`Invalid ARN format for dependency: ${arn}`);
    }
}

export async function hasDependencies(resourceId: string): Promise<boolean> {
    const ec2Dependencies = await checkEC2Dependencies(resourceId);
    const rdsDependencies = await checkRDSDependencies(resourceId);
    const asgDependencies = await checkASGDependencies(resourceId);
    return ec2Dependencies || rdsDependencies || asgDependencies;
}

async function checkEC2Dependencies(instanceId: string): Promise<boolean> {
    const params = {
        Filters: [
            {Name: 'tag:depends-on', Values: [`arn:aws:ec2:*:*:instance/${instanceId}`]},
            {Name: 'instance-state-name', Values: ['running']}
        ]
    };
    const data = await ec2.describeInstances(params).promise();
    return (data.Reservations?.length ?? 0) > 0;
}

async function checkRDSDependencies(instanceId: string): Promise<boolean> {
    const [instanceData, clusterData] = await Promise.all([
        rds.describeDBInstances().promise(),
        rds.describeDBClusters().promise()
    ]);
    const dependentInstances = instanceData.DBInstances?.filter(instance =>
        instance.TagList?.some(tag =>
            tag.Key === 'depends-on' && tag.Value === `arn:aws:ec2:*:*:instance/${instanceId}`
        )
    ) || [];
    const dependentClusters = clusterData.DBClusters?.filter(cluster =>
        cluster.TagList?.some(tag =>
            tag.Key === 'depends-on' && tag.Value === `arn:aws:ec2:*:*:instance/${instanceId}`
        )
    ) || [];
    return dependentInstances.length > 0 || dependentClusters.length > 0;
}

async function checkASGDependencies(instanceId: string): Promise<boolean> {
    const params = {
        Filters: [
            {Name: 'tag:depends-on', Values: [`arn:aws:ec2:*:*:instance/${instanceId}`]}
        ]
    };
    const data = await autoscaling.describeAutoScalingGroups(params).promise();
    return (data.AutoScalingGroups?.length ?? 0) > 0;
}