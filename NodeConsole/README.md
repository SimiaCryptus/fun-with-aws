# AWS Start Instances Lambda

## Overview

This project contains a self-contained AWS Lambda function designed to manage EC2 instances, RDS instances, and Auto
Scaling Groups. It provides a simple HTTP API to list, start, and stop these resources.

## Features

* Self-contained Lambda function to manage AWS EC2 instances, RDS instances, and Auto Scaling Groups
* Lambda HTTP endpoint to interact with AWS resources:
    * GET - List all manageable EC2 instances, RDS instances, and Auto Scaling Groups
    * POST - Start or stop a specific EC2 instance, RDS instance, or Auto Scaling Group
* Password protection for start/stop actions
* Idle metrics for EC2 instances
* Support for resource dependencies

## Prerequisites

* AWS account
* AWS CLI configured with appropriate permissions
* Node.js (version 20.x or later recommended)
* npm (Node Package Manager)
* TypeScript
* AWS SDK for JavaScript
* AWS X-Ray SDK for Node.js

## Setup

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Configure AWS credentials (if not already done)
4. Set up environment variables:
    * `AWS_REGION`: The AWS region where your resources are located (default is 'us-east-1')

## Building

To build the TypeScript code:

  ```
  npm run build
  ```

This will compile the TypeScript files into JavaScript in the `dist` directory.

## Deployment

To deploy the Lambda function:

1. Build the project (see Building section)
2. Zip the function code:
    ```
    zip -r function.zip dist node_modules package.json
    ```
3. Deploy using AWS CLI:
    ```
    aws lambda create-function --function-name ManageAWSResourcesLambda --runtime nodejs20.x --handler dist/index.handler
      --role <YOUR_LAMBDA_ROLE_ARN> --zip-file fileb://function.zip
    ```

Note: Make sure to replace `<YOUR_LAMBDA_ROLE_ARN>` with the actual ARN of the IAM role for your Lambda function.

## Usage

Once deployed, you can interact with the Lambda function via its HTTP endpoint:

* GET request: Lists all manageable EC2 instances, RDS instances, and Auto Scaling Groups
* POST request: Starts or stops a specific EC2 instance, RDS instance, or Auto Scaling Group

  Example POST request:
   ```
   POST /
   Content-Type: application/json
   {
    "instanceId": "i-1234567890abcdef0",
    "password": "your_password",
    "action": "start",
    "isRDS": false,
    "isASG": false
   }
   ```

   Response:

    ```json
    {
     "message": "EC2 i-1234567890abcdef0 started successfully"
    }
    ```

## Error Handling

The Lambda function includes error handling for various scenarios:

* Invalid input parameters
* Invalid passwords
* Resource not found
* AWS API errors
  Error responses will include an appropriate HTTP status code and an error message in the response body.

## Security

Ensure that the Lambda function has the necessary IAM permissions to describe, start, and stop EC2 instances, RDS
instances, and Auto Scaling Groups. The function uses password protection for start/stop actions, which should be
configured using AWS tags on the resources.
It's recommended to use AWS API Gateway with appropriate authentication and authorization to secure access to the Lambda
function.

## Tags

The following tags are used to control access and behavior:

* `Stop-Start-Password`: Combined password for both start and stop actions
* `Start-Password`: Password for start action only
* `Stop-Password`: Password for stop action only
* `depends-on`: Indicates dependencies for start/stop order
* `to-be-started`: Used internally to manage start order for resources with dependencies

## Monitoring and Logging

The Lambda function uses AWS X-Ray for tracing. Make sure to enable X-Ray tracing for your Lambda function in the AWS
Console or via AWS CLI.
Logs are sent to CloudWatch Logs. You can view these logs in the AWS Console or using the AWS CLI.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.