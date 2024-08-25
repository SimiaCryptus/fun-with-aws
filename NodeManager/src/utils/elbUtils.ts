import { elb } from '../index';
import { CloudWatch } from 'aws-sdk';
const cloudWatch = new CloudWatch();

 interface ELBStatus {
     noHandlersAvailable: boolean;
     hasIncomingRequests: boolean;
 }

 export async function checkELBStatus(loadBalancerArn: string): Promise<ELBStatus> {
       const targetGroups = await elb.describeTargetGroups({ LoadBalancerArn: loadBalancerArn }).promise();
       let noHandlersAvailable = true;
       let hasIncomingRequests = false;

       for (const tg of targetGroups.TargetGroups || []) {
          if (tg.TargetGroupArn) {
              const healthCheck = await elb.describeTargetHealth({ TargetGroupArn: tg.TargetGroupArn }).promise();
         
              if (healthCheck.TargetHealthDescriptions?.some(thd => thd.TargetHealth?.State === 'healthy')) {
                  noHandlersAvailable = false;
              }
           }

         const metrics = await cloudWatch.getMetricStatistics({
             Namespace: 'AWS/ApplicationELB',
             MetricName: 'RequestCount',
             Dimensions: [{ Name: 'LoadBalancer', Value: loadBalancerArn.split('/').pop()! }],
             StartTime: new Date(Date.now() - 5 * 60 * 1000),
             EndTime: new Date(),
             Period: 300,
             Statistics: ['Sum']
         }).promise();
         if (metrics.Datapoints && metrics.Datapoints.length > 0 && metrics.Datapoints[0].Sum! > 0) {
             hasIncomingRequests = true;
         }
       }

       return { noHandlersAvailable, hasIncomingRequests };
   }