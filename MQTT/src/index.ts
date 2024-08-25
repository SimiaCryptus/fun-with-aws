// noinspection SqlResolve

import * as AWS from 'aws-sdk';
import {AWSError} from 'aws-sdk';
import * as AWSXRay from 'aws-xray-sdk-core';
import {Pool, PoolClient} from 'pg';
import {APIGatewayEventRequestContext, APIGatewayProxyEvent, APIGatewayProxyResult} from 'aws-lambda';

const XRayAWS = AWSXRay.captureAWS(AWS);

// Environment variables
const DB_HOST = process.env.DB_HOST || 'apps-simiacrypt-us.cluster-ckhbwauobdwe.us-east-1.rds.amazonaws.com';
const DB_KEY = process.env.DB_KEY || 'arn:aws:secretsmanager:us-east-1:470240306861:secret:rds!cluster-2068049d-7d46-402b-b2c6-aff3bde9553d-SHe1Bs';
const LAMBDA_FUNCTION_ARN = process.env.LAMBDA_FUNCTION_ARN || 'arn:aws:lambda:us-east-1:470240306861:function:SkyenetMQTTFunction';
const VERBOSE = process.env.VERBOSE === 'true';
const DB_CONNECTION_TIMEOUT = 5000; // 5 seconds
const DB_QUERY_TIMEOUT = 5000; // 5 seconds
const OPERATION_TIMEOUT = 5000; // 5 seconds
const LAMBDA_TIMEOUT = 60000; // 60 seconds

const appId = process.env.APP_ID || 'bndslpwzjk';

interface ExtendedAPIGatewayEventRequestContext extends APIGatewayEventRequestContext {
    connectionId?: string;
    routeKey?: string;
}

interface MessageBody {
    action: string;
    topic: string;
    message: any;
}

interface DbCredentials {
    username: string;
    password: string;
}

interface BroadcastResult {
    connectionId: string;
    success: boolean;
    error?: any;
}

const apigwManagementApi = new XRayAWS.ApiGatewayManagementApi({
    endpoint: process.env.APIGW_ENDPOINT || `https://${appId}.execute-api.${process.env.AWS_REGION}.amazonaws.com/dev`,
    region: process.env.AWS_REGION
});

const secretsManager = new XRayAWS.SecretsManager({
    endpoint: process.env.SECRETS_MANAGER_ENDPOINT || 'https://secretsmanager.us-east-1.amazonaws.com',
    region: process.env.AWS_REGION
});

const sts = new XRayAWS.STS({
    region: process.env.AWS_REGION,
    endpoint: process.env.STS_ENDPOINT || 'https://sts.us-east-1.amazonaws.com'
});

const lambda = new XRayAWS.Lambda({
    region: process.env.AWS_REGION,
    endpoint: process.env.LAMBDA_ENDPOINT || 'https://lambda.us-east-1.amazonaws.com'
});

console.log('API Gateway Management API configured with:', {
    endpoint: process.env.APIGW_ENDPOINT || `https://${appId}.execute-api.${process.env.AWS_REGION}.amazonaws.com/dev`,
    region: process.env.AWS_REGION
});

async function logIamRoleInfo(): Promise<void> {
    try {
        const data = await Promise.race([
            sts.getCallerIdentity().promise(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('IAM role info retrieval timeout')), OPERATION_TIMEOUT))
        ]);
        if (data && typeof data === 'object' && 'Arn' in data) {
            console.log('Current IAM role:', data.Arn);
        } else {
            console.log('Unexpected data structure:', data);
        }
        console.log('Lambda Function ARN:', LAMBDA_FUNCTION_ARN);
    } catch (error) {
        console.error('Error getting IAM role info:', error instanceof Error ? error.message : String(error));
    }
}

async function checkLambdaPermissions(): Promise<void> {
    try {
        const data = await lambda.getPolicy({FunctionName: LAMBDA_FUNCTION_ARN}).promise();
        if (data.Policy) {
            console.log('Lambda function policy:', JSON.parse(data.Policy));
        } else {
            console.log('No policy found for Lambda function');
        }
    } catch (error) {
        console.error('Error checking Lambda permissions:', error instanceof Error ? error.message : String(error));
    }
}

async function getDbCredentials(): Promise<DbCredentials> {
    if (VERBOSE) console.time('getDbCredentials');
    try {
        const data = await Promise.race([
            secretsManager.getSecretValue({SecretId: DB_KEY}).promise(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('DB credentials retrieval timeout')), OPERATION_TIMEOUT))
        ]);
        if (VERBOSE) console.log('DB credentials retrieved successfully');
        if (data && typeof data === 'object' && 'SecretString' in data && typeof data.SecretString === 'string') {
            return JSON.parse(data.SecretString) as DbCredentials;
        } else {
            throw new Error('SecretString is undefined');
        }
    } catch (error) {
        console.error('Error retrieving DB credentials:', error instanceof Error ? error.message : String(error));
        throw error;
    } finally {
        if (VERBOSE) console.timeEnd('getDbCredentials');
    }
}

let pool: Pool;

async function getDbPool(): Promise<Pool> {
    if (VERBOSE) console.time('getDbClient');
    try {
        const credentials = await getDbCredentials();
        if (!credentials) throw new Error('Failed to retrieve DB credentials');
        if (VERBOSE) console.log('Creating DB client with host:', DB_HOST);
        if (!pool) {
            pool = new Pool({
                host: DB_HOST,
                port: 5432,
                database: 'postgres',
                user: credentials.username,
                password: credentials.password,
                connectionTimeoutMillis: DB_CONNECTION_TIMEOUT,
                query_timeout: DB_QUERY_TIMEOUT,
                max: 20,
                idleTimeoutMillis: 10000
            });
        }
        if (VERBOSE) console.log('Successfully connected to the database');
        return pool;
    } catch (error) {
        console.error('Failed to connect to the database:', error instanceof Error ? error.message : String(error));
        throw error;
    } finally {
        if (VERBOSE) console.timeEnd('getDbClient');
    }
}

async function ensureTableExists(client: PoolClient): Promise<void> {
    const startTime = Date.now();
    try {
        await Promise.race([
            client.query(`
                CREATE TABLE IF NOT EXISTS connected_clients
                (
                    connection_id TEXT PRIMARY KEY,
                    topic         TEXT,
                    last_seen     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `),
            client.query(`
                CREATE INDEX IF NOT EXISTS idx_connected_clients_connection_id
                    ON connected_clients (connection_id)
            `),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Ensure table exists timeout')), DB_QUERY_TIMEOUT))
        ]);
        if (VERBOSE) console.log('Table existence ensured');
    } finally {
        if (VERBOSE) console.log(`ensureTableExists: ${Date.now() - startTime}ms`);
    }
}


async function broadcastMessage(client: PoolClient, message: any, topic: string): Promise<BroadcastResult[]> {
    try {
        const {rows} = await client.query('SELECT connection_id FROM connected_clients WHERE topic = $1', [topic]);
        if (VERBOSE) console.log(`Broadcasting message to ${rows.length} clients in topic: ${topic}`);
        const postCalls = rows.map(async (row) => {
            try {
                console.log(`Attempting to post to connection: ${row.connection_id}`);
                console.log('API Gateway Endpoint:', process.env.APIGW_ENDPOINT);
                console.log('AWS Region:', process.env.AWS_REGION);
                console.log('Full API Gateway Management API configuration:', JSON.stringify(apigwManagementApi.config, null, 2));
                try {
                    await (apigwManagementApi.postToConnection({
                        ConnectionId: row.connection_id,
                        Data: JSON.stringify(message)
                    }) as AWS.Request<{}, AWSError>).promise();
                } catch (error) {
                    if (error instanceof Error && error.name === 'NetworkingError') {
                        console.error('Network error when posting to connection. Ensure VPC endpoints are correctly configured.');
                        throw error;
                    }
                    throw error;
                }
                if (VERBOSE) console.log(`Message sent successfully to connection: ${row.connection_id}`);
                return {connectionId: row.connection_id, success: true};
            } catch (e: any) {
                console.error(`Error posting to connection ${row.connection_id}:`, e);
                console.error('Full error object:', JSON.stringify(e, null, 2));
                console.error('Stack trace:', e.stack);
                if (e instanceof Error) {
                    console.error('Error message:', e.message);
                }
                if (e instanceof Error && 'statusCode' in e &&
                    typeof (e as unknown as { statusCode: number }).statusCode === 'number' &&
                    (e as unknown as { statusCode: number }).statusCode === 410) {
                    await client.query('DELETE FROM connected_clients WHERE connection_id = $1', [row.connection_id]);
                } else {
                    console.log(`Error posting to connection ${row.connection_id}`, e);
                }
                return {connectionId: row.connection_id, success: false, error: e};
            }
        });
        return await Promise.all(postCalls);
    } catch (error) {
        if (error instanceof Error) {
            if (error instanceof Error) {
                console.error('Error in handler:', error.message);
                console.error('Stack trace:', error.stack);
            } else {
                console.error('Error in handler:', String(error));
            }
        } else {
            console.error('Error in handler:', String(error));
        }
        throw error;
    }
}

async function checkVpcEndpointConnectivity(): Promise<void> {
    try {
        await (apigwManagementApi.getConnection({ConnectionId: 'test'}) as AWS.Request<AWS.ApiGatewayManagementApi.GetConnectionResponse, AWS.AWSError>).promise();
        console.log('VPC Endpoint connectivity check successful');
    } catch (error: any) {
        if (error.code === 'GoneException') {
            console.log('VPC Endpoint connectivity check successful (GoneException is expected for non-existent connection)');
        } else {
            console.error('VPC Endpoint connectivity check failed:', error);
        }
    }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('Event:', JSON.stringify(event, null, 2));
    console.log('Lambda function ARN:', LAMBDA_FUNCTION_ARN);
    await logIamRoleInfo().catch(console.error);
    await checkLambdaPermissions().catch(console.error);
    await checkVpcEndpointConnectivity().catch(console.error);
    const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Lambda function timeout')), LAMBDA_TIMEOUT)
    );
    return Promise.race([
        handleEvent(event),
        timeoutPromise
    ]);
};

async function handleEvent(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    if (!event.requestContext) {
        console.error('Event request context is undefined');
        return {statusCode: 400, body: JSON.stringify({error: 'Invalid event structure'})};
    }
    if (VERBOSE) console.log('Received event:', JSON.stringify(event, null, 2));
    if (VERBOSE) console.log('Environment variables:', JSON.stringify(process.env, null, 2));


    const connectionId = (event.requestContext as ExtendedAPIGatewayEventRequestContext).connectionId;
    const routeKey = (event.requestContext as ExtendedAPIGatewayEventRequestContext).routeKey;
    const pool = await getDbPool();
    let client: PoolClient | null = null;
    try {
        client = await pool.connect();
        if (VERBOSE) console.time('ensureTableExists');
        await ensureTableExists(client);
        if (VERBOSE) console.timeEnd('ensureTableExists');
        if (!connectionId) {
            console.error('ConnectionId is undefined');
            return {statusCode: 400, body: JSON.stringify({error: 'ConnectionId is missing'})};
        }


        if (routeKey === '$connect') {
            console.log('Handling $connect');
            try {
                console.time('insertConnection');
                await client.query('INSERT INTO connected_clients (connection_id) VALUES ($1)', [connectionId]);
                console.timeEnd('insertConnection');
                if (VERBOSE) console.log('Connection successful for:', connectionId);
                return {
                    statusCode: 200,
                    body: JSON.stringify({
                        action: 'connect',
                        payload: {
                            message: 'Connected successfully'
                        }
                    })
                };
            } catch (error) {
                console.error('Connection error for:', connectionId, error);
                return {
                    statusCode: 500,
                    body: JSON.stringify({
                        action: 'connect',
                        payload: {
                            message: 'Failed to connect',
                            error
                        }
                    })
                };
            }
        } else if (routeKey === '$disconnect') {
            if (VERBOSE) console.log('Handling $disconnect for:', connectionId);
            if (VERBOSE) console.time('deleteConnection');
            await client.query('DELETE FROM connected_clients WHERE connection_id = $1', [connectionId]);
            if (VERBOSE) console.timeEnd('deleteConnection');
            return {
                statusCode: 200,
                body: JSON.stringify({
                    action: 'disconnect',
                    payload: {
                        message: 'Disconnected successfully'
                    }
                })
            };
        } else if (routeKey === '$default') {
            if (VERBOSE) console.log('Handling $default for:', connectionId);
            const body: MessageBody = JSON.parse(event.body || '{}');
            const {action, topic, message} = body;
            if (action === 'subscribe' && topic) {
                if (VERBOSE) console.log(`Subscribing ${connectionId} to topic: ${topic}`);
                try {
                    await client.query('UPDATE connected_clients SET topic = $1 WHERE connection_id = $2', [topic, connectionId]);
                } catch (error) {
                    console.error('Error subscribing:', error);
                    return {
                        statusCode: 500,
                        body: JSON.stringify({
                            action: 'subscribe',
                            payload: {
                                message: 'Failed to subscribe to topic',
                                error: (error as Error).toString()
                            }
                        })
                    };
                }
                if (VERBOSE) console.log(`Sending subscribed message to ${connectionId}`);
                let connections = (await client.query<{
                    connection_id: string
                }>('SELECT connection_id FROM connected_clients WHERE topic = $1', [topic])).rows;
                try {
                    if (VERBOSE) console.log(`Attempting to post to connection: ${connectionId} in topic: ${topic} with connections:`, connections);
                    try {
                        await (apigwManagementApi.postToConnection({
                            ConnectionId: connectionId,
                            Data: JSON.stringify({
                                action: 'subscribed',
                                payload: {
                                    message: 'Subscribed successfully',
                                    topic,
                                    connections: connections
                                }
                            })
                        }) as AWS.Request<{}, AWS.AWSError>).promise();
                        if (VERBOSE) console.log(`Successfully posted to connection: ${connectionId}`);
                    } catch (error) {
                        console.error(`Error posting to connection ${connectionId}:`, JSON.stringify(error as Error, null, 2));
                        console.error('Full error object:', error);
                        if (error instanceof Error && 'statusCode' in error && error.statusCode === 410) {
                            console.log(`Connection ${connectionId} is gone, removing from database`);
                            await client.query('DELETE FROM connected_clients WHERE connection_id = $1', [connectionId]);
                        } else if (error instanceof Error && 'code' in error && error.code === 'ForbiddenException') {
                            console.error('ForbiddenException: This might be due to VPC endpoint restrictions or insufficient IAM permissions.');
                            console.error('API Gateway Endpoint:', process.env.APIGW_ENDPOINT);
                            console.error('Lambda Function ARN:', process.env.LAMBDA_FUNCTION_ARN);
                        }
                        throw error;
                    }
                } catch (error) {
                    console.error('Error in subscribe action:', JSON.stringify(error, (key, value) => {
                        if (key === 'issuerCertificate') {
                            return '[Circular]';
                        }
                        if (typeof value === 'object' && value !== null) {
                            if (Object.prototype.hasOwnProperty.call(value, 'issuerCertificate')) {
                                value.issuerCertificate = '[Circular]';
                            }
                        }
                        return value;
                    }, 2));
                    throw error;
                }
                if (VERBOSE) console.log(`Broadcasting playerJoined message for ${connectionId} in topic: ${topic}`);
                await broadcastMessage(client, {action: 'playerJoined', connectionId, topic}, topic);
                return {
                    statusCode: 200,
                    body: JSON.stringify({
                        action: 'subscribed',
                        payload: {
                            topic,
                            message: 'Subscribed successfully',
                            connections: connections
                        }

                    })
                };
            } else if (action === 'publish' && topic) {
                try {
                    if (VERBOSE) console.log(`Publishing message from ${connectionId} to topic: ${topic}`);
                    // Broadcast the message to all connected clients
                    let results = await broadcastMessage(client, {
                        ...message,
                        topic,
                        sender: connectionId
                    }, topic);
                    return {
                        statusCode: 200,
                        body: JSON.stringify({
                            payload: {
                                originalMessage: message,
                                message: 'Message broadcasted successfully',
                                connections: results
                            },
                            action: 'broadcast',
                        })
                    };
                } catch (err) {
                    console.error('Error in publish:', JSON.stringify(err, null, 2));
                    return {
                        statusCode: 500,
                        body: JSON.stringify({
                            action: 'broadcast',
                            payload: {
                                message: 'Failed to broadcast message: ' + (err as Error).toString(),
                                error: err,
                                originalMessage: message,
                            }
                        })
                    };
                }
            } else {
                if (VERBOSE) console.log(`Invalid action received: ${action}`);
                return {statusCode: 400, body: JSON.stringify({error: 'Invalid action'})};
            }
        } else {
            return {statusCode: 400, body: JSON.stringify({error: 'Invalid route key'})};
        }
    } catch (error) {
        console.error('Error in handleEvent:', error);
        console.error('Full error object:', JSON.stringify(error, (key, value) => {
            if (key === 'issuerCertificate') {
                return '[Circular]';
            }
            if (typeof value === 'object' && value !== null) {
                if (Object.prototype.hasOwnProperty.call(value, 'issuerCertificate')) {
                    value.issuerCertificate = '[Circular]';
                }
            }
            return value;
        }, 2));
        return {
            statusCode: 500,
            body: JSON.stringify({
                action: 'error',
                payload: {
                    message: 'Internal server error',
                    error: JSON.stringify(error, null, 2)
                }
            })
        };
    } finally {
        if (client !== null) {
            client.release();
        }
    }
}
   const [rdsInstanceData, rdsClusterData] = await Promise.all([
       rds.describeDBInstances().promise(),
       rds.describeDBClusters().promise()
   ]);
   const activeRDSInstances = (rdsInstanceData.DBInstances || [])
       .filter(db => db.DBInstanceStatus === 'available' && 
           db.TagList?.some(tag => tag.Key === 'depends-on' && tag.Value === resourceArn));
   const activeRDSClusters = (rdsClusterData.DBClusters || [])
       .filter(cluster => cluster.Status === 'available' && 
           cluster.TagList?.some(tag => tag.Key === 'depends-on' && tag.Value === resourceArn));