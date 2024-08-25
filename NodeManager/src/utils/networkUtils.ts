import {CloudWatch} from 'aws-sdk';

const cloudWatch = new CloudWatch();

export async function checkRDSIdleTime(resourceId: string, isCluster: boolean, idleTime: string, idleConnectionThreshold: number = 0): Promise<boolean> {
    console.log(`Checking RDS idle time for ${isCluster ? 'cluster' : 'instance'} ${resourceId} with idle time ${idleTime}`);
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - parseIdleTime(idleTime));
    console.log(`Start time: ${startTime.toISOString()}, End time: ${endTime.toISOString()}`);
    const params: CloudWatch.GetMetricStatisticsInput = {
        Namespace: 'AWS/RDS',
        MetricName: 'DatabaseConnections',
        Dimensions: [{
            Name: isCluster ? 'DBClusterIdentifier' : 'DBInstanceIdentifier',
            Value: resourceId
        }],
        StartTime: startTime,
        EndTime: endTime,
        Period: 300,
        Statistics: ['Maximum']
    };
    console.log('Fetching CloudWatch metrics for RDS connections...');
    const data = await cloudWatch.getMetricStatistics(params).promise();
    const datapoints = data.Datapoints || [];
    console.log(`Received ${datapoints.length} datapoints from CloudWatch for RDS connections`);
    const isIdle = datapoints.length > 2 && datapoints.filter(dp => (dp.Maximum || 0) <= idleConnectionThreshold).length >= 1;
    console.log(`RDS ${isCluster ? 'cluster' : 'instance'} ${resourceId} is ${isIdle ? 'idle' : 'not idle'}`);
    return isIdle;
}

export async function checkCPUIdleTime(instanceId: string, idleTime: string, cpuIdleThreshold: number = 10): Promise<boolean> {
    console.log(`Checking CPU idle time for instance ${instanceId} with idle time ${idleTime}`);
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - parseIdleTime(idleTime));
    console.log(`Start time: ${startTime.toISOString()}, End time: ${endTime.toISOString()}`);
    const params: CloudWatch.GetMetricStatisticsInput = {
        Namespace: 'AWS/EC2',
        MetricName: 'CPUUtilization',
        Dimensions: [{Name: 'InstanceId', Value: instanceId}],
        StartTime: startTime,
        EndTime: endTime,
        Period: 300,
        Statistics: ['Average']
    };
    console.log('Fetching CloudWatch metrics for CPU...');
    const data = await cloudWatch.getMetricStatistics(params).promise();
    const datapoints = data.Datapoints || [];
    console.log(`Received ${datapoints.length} datapoints from CloudWatch for CPU`);
    const isIdle = datapoints.length > 5 && datapoints.every(dp => (dp.Average || 0) < cpuIdleThreshold);
    console.log(`Instance ${instanceId} CPU is ${isIdle ? 'idle' : 'not idle'}`);
    return isIdle;
}


export async function checkNetworkIdleTime(instanceId: string, idleTime: string, networkIdleThreshold: number = 0): Promise<boolean> {
    console.log(`Checking network idle time for instance ${instanceId} with idle time ${idleTime}`);
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - parseIdleTime(idleTime));
    console.log(`Start time: ${startTime.toISOString()}, End time: ${endTime.toISOString()}`);
    const params: CloudWatch.GetMetricStatisticsInput = {
        Namespace: 'AWS/EC2',
        MetricName: 'NetworkIn',
        Dimensions: [{Name: 'InstanceId', Value: instanceId}],
        StartTime: startTime,
        EndTime: endTime,
        Period: 300,
        Statistics: ['Sum']
    };
    console.log('Fetching CloudWatch metrics for network...');
    const data = await cloudWatch.getMetricStatistics(params).promise();
    const datapoints = data.Datapoints || [];
    console.log(`Received ${datapoints.length} datapoints from CloudWatch`);
    const isIdle = datapoints.length > 5 && datapoints.every(dp => (dp.Sum || 0) <= networkIdleThreshold);
    console.log(`Instance ${instanceId} is ${isIdle ? 'idle' : 'not idle'}`);
    return isIdle;
}

function parseIdleTime(idleTime: string): number {
    console.log(`Parsing idle time: ${idleTime}`);
    const value = parseInt(idleTime.slice(0, -1));
    const unit = idleTime.slice(-1).toLowerCase();
    switch (unit) {
        case 'm':
            console.log(`Parsed idle time: ${value} minutes`);
            return value * 60 * 1000;
        case 'h':
            console.log(`Parsed idle time: ${value} hours`);
            return value * 60 * 60 * 1000;
        default:
            console.error(`Invalid idle time format: ${idleTime}`);
            throw new Error('Invalid idle time format');
    }
}