# AWS Node Manager Application

## Overview

The AWS Node Manager Application is a powerful tool designed to automate and optimize the management of EC2 instances,
RDS instances, and Auto Scaling Groups in your AWS environment. By leveraging resource tags and AWS Lambda functions
written in TypeScript, this application provides intelligent control over your AWS resources, helping to reduce costs
and improve operational efficiency.

## Process Flow

### Main Lambda Handler Flow

  ```mermaid
  graph TD
    A[Lambda Handler Triggered] --> B[Manage EC2 Instances]
    B --> C[Manage RDS Resources]
    C --> D[Manage Auto Scaling Groups]
    D --> E[Monitor ELB and Activate Resources]
    E --> F[Return Response]
  ```

### Resource Management Flow

  ```mermaid
  graph TD
    A[Get Resources to Manage] --> B[For Each Resource]
    B --> C{Check Resource Type}
    C -->|EC2| D[Manage EC2 Instance]
    C -->|RDS| E[Manage RDS Resource]
    C -->|ASG| F[Manage Auto Scaling Group]
    D --> G[Apply Tags and Schedules]
    E --> G
    F --> G
    G --> H[Start/Stop/Terminate Based on Conditions]
    H --> I[Handle Dependencies]
    I --> J[Apply Rate Limiting]
  ```

### ELB Monitoring and Resource Activation Flow

  ```mermaid
  graph TD
    A[Monitor ELB] --> B{Check ELB Status}
    B -->|No Handlers & Incoming Requests| C[Activate Associated Resources]
    C --> D[Start Associated ASG]
    C --> E[Start Associated RDS]
    B -->|Handlers Available or No Requests| F[No Action Required]
  ```


 ## Key Features:

* Routinely scan EC2 instances, RDS instances, and Auto Scaling Groups for required changes in state based on tags
* Automatically start, stop, and terminate EC2 instances based on tags
* Automatically start and stop RDS instances based on tags
* Automatically start and stop Auto Scaling Groups based on tags
* Monitor Elastic Load Balancers (ELBs) and activate associated resources when needed
* Support cron-like scheduling for each instance
* Support "maximum running time" for each instance based on tags
* Support "network idle time" for each instance based on tags
* Support "CPU idle time" for EC2 instances based on tags
* Dependency management between EC2 instances, RDS instances, and Auto Scaling Groups
* Implemented using TypeScript AWS Lambda functions for improved code quality and maintainability
* Manage Auto Scaling groups based on tags and schedules
* Rate limiting to prevent API throttling
* Comprehensive error handling and logging
* AWS X-Ray integration for tracing and performance monitoring

## Project Structure

The project is organized as follows:

    ```
    NodeManager/
    ├── src/
    │   ├── index.ts              # Main Lambda handler and resource management logic
    │   └── utils/
    │       ├── cronUtils.ts      # Cron expression parsing and scheduling utilities
    │       ├── dependencyUtils.ts # Dependency management utilities
    │       ├── networkUtils.ts   # Network and CPU idle time checking utilities
    │       ├── elbUtils.ts       # ELB status checking utilities
    │       └── rateLimiter.ts    # Rate limiting implementation
    ├── tests/                    # Test files (to be implemented)
    ├── package.json              # Project dependencies and scripts
    ├── tsconfig.json             # TypeScript configuration
    └── README.md                 # Project documentation
    ```

## Architecture

The AWS Node Manager Application uses a serverless architecture with the following components:

* AWS Lambda: Executes the core logic for managing EC2 instances, RDS instances, and Auto Scaling groups
* Amazon CloudWatch Events: Triggers the Lambda function on a schedule
* Elastic Load Balancing (ELB): Monitored for incoming traffic and resource availability
* AWS SDK for JavaScript: Interacts with AWS services (EC2, RDS, Auto Scaling)
* Amazon CloudWatch Logs: Stores logs for monitoring and troubleshooting
* AWS X-Ray: Provides tracing and performance monitoring
* AWS IAM: Manages permissions and access control

## Architecture Diagram

  ```mermaid
  graph TD
    A[CloudWatch Events] -->|Triggers| B[AWS Lambda]
    B -->|Manages| C[EC2 Instances]
    B -->|Manages| D[RDS Instances]
    B -->|Manages| E[Auto Scaling Groups]
    B -->|Monitors| F[Elastic Load Balancers]
    B -->|Logs to| G[CloudWatch Logs]
    B -->|Traced by| H[AWS X-Ray]
    I[IAM] -->|Provides Permissions| B
    J[AWS SDK] -->|Used by| B
  ```

## Key Components

1. Resource Managers: Implement the `ResourceManager` interface for EC2, RDS, and Auto Scaling groups.
2. Tag-based Management: Use AWS resource tags to control behavior and scheduling.
3. Dependency Management: Handle dependencies between EC2 instances, RDS instances, and Auto Scaling Groups using
   the `depends-on` tag.
4. Rate Limiting: Implement a `RateLimiter` to prevent API throttling.
5. Error Handling: Comprehensive error catching and logging for robustness.
6. Performance Monitoring: Use AWS X-Ray for tracing and performance insights.
7. ELB Monitoring: Check ELB status and activate associated resources when needed.
8. Scheduling: Utilize cron-like syntax for flexible resource scheduling.

## Prerequisites

Before you begin, ensure you have the following:

* An AWS account with appropriate permissions
* Node.js (version 14.x or later) and npm installed
* TypeScript installed globally (`npm install -g typescript`)
* AWS CLI configured with your credentials
* Basic knowledge of AWS services (EC2, RDS, Auto Scaling) and TypeScript

## Detailed Features

### 1. Tag-based Instance Management

* Scan EC2 instances, RDS instances, and Auto Scaling Groups at regular intervals to check for required state changes
* Use predefined tags to control instance behavior:
  * `AutoStart`: Automatically start instances at specified times
  * `AutoStop`: Automatically stop instances at specified times
  * `AutoTerminate`: Automatically terminate EC2 instances based on conditions (not applicable to RDS)
  * `to-be-started`: Flag an instance to be started in the next execution

### 2. Cron-like Scheduling

* Define custom schedules for each instance using cron-like syntax
* Applicable to EC2 instances, RDS instances, and Auto Scaling groups
* Supports complex schedules like monthly or yearly patterns
* Example: `start-schedule: 0 8 * * 1-5` (Start instance at 8 AM on weekdays)
* Example: `stop-schedule: 0 18 * * 1-5` (Stop instance at 6 PM on weekdays)

### 3. Maximum Running Time

* Set a maximum allowed running time for EC2 instances using tags
* Automatically stop or terminate EC2 instances that exceed the specified time limit
* Example: `max-runtime: 4h` (Stop the instance after 4 hours of continuous runtime)

### 4. Network Idle Time

* Monitor network activity on EC2 instances
* Automatically stop or terminate EC2 instances that have been idle for a specified period
* Helps optimize costs by stopping unused resources
* Example: `idle-stop-time: 30m` (Stop the instance after 30 minutes of network inactivity)

### 5. CPU Idle Time

* Monitor CPU activity on EC2 instances
* Automatically stop EC2 instances that have been idle for a specified period
* Example: `cpu-idle-stop-time: 1h` (Stop the instance after 1 hour of CPU inactivity)

### 6. Dependency Management

* Define dependencies between instances using tags
* Ensure dependent instances are started before the main instance
* Supports dependencies between EC2 instances, RDS instances, and Auto Scaling Groups
* Ensures proper startup sequence for complex architectures
* Example: `depends-on: arn:aws:rds:region:account-id:db:instance-id` (EC2 instance depends on RDS instance)

### 7. TypeScript AWS Lambda Functions

* Implements core functionality using AWS Lambda functions
* Leverages TypeScript for improved code quality and maintainability
* Easily deploy using serverless architecture with low TCO

### 8. To-Be-Started Flag

* Use a `to-be-started` tag to indicate that an instance should be started in the next execution
* Automatically remove the `to-be-started` tag after starting the instance
* Useful for managing instances and Auto Scaling Groups that depend on other resources

### 9. Auto Scaling Group (ASG) Management

* Manage Auto Scaling groups based on tags and schedules
* Automatically start and stop Auto Scaling groups at specified times
* Use the same scheduling syntax as EC2 and RDS instances
* Support dependency management for Auto Scaling Groups
* Adjust desired capacity and minimum size based on schedules
* Optimize costs by scaling down during off-hours

### 10. ELB Monitoring and Resource Activation

* Monitor Elastic Load Balancers for incoming traffic and resource availability
* Automatically activate associated Auto Scaling Groups when ELB has incoming requests but no available handlers
* Start associated RDS instances when needed
* Helps ensure application availability while optimizing resource usage

### 10. Error Handling and Logging

* Comprehensive error handling to ensure robustness
* Detailed logging of all actions and errors for easy troubleshooting
* Use of AWS X-Ray for tracing and performance monitoring

### 11. Rate Limiting

* Implement a `RateLimiter` to prevent API throttling
* Ensure smooth operation even with a large number of resources to manage
* Configurable concurrency limits

### 12. Performance Optimization

* Use of async/await for efficient asynchronous operations
* Parallel processing of resources where possible
* Batch processing of resources to minimize Lambda execution time

## Getting Started

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/your-repo/aws-node-manager.git
   cd aws-node-manager
   ```
2. Install dependencies:
   ```
   npm install
   ```
3. Configure the application:
  * Copy `config.example.json` to `config.json`
  * Update the configuration with your AWS region and other settings
4. Build the application:
   ```
   npm run build
   ```
5. Deploy to AWS:
    ```
    npm run deploy
    ```

### Development

To run the application locally for development:

1. Set up AWS credentials in your environment or AWS credentials file.
2. Run the application in watch mode:
   ```
   npm run dev
   ```

This will start the TypeScript compiler in watch mode and run the Lambda function locally using the AWS SAM CLI.

### Environment Variables

The application uses the following environment variables:

* `DEFAULT_ASG_DESIRED_CAPACITY`: Default desired capacity for Auto Scaling groups (default: "1")
* `DEFAULT_ASG_MIN_SIZE`: Default minimum size for Auto Scaling groups (default: "1")
* `AWS_REGION`: The AWS region (set automatically by Lambda)
* `AWS_ACCOUNT_ID`: Your AWS account ID (set automatically by Lambda)
* `LOG_LEVEL`: Set the logging level (e.g., "debug", "info", "warn", "error")

## Usage

1. Tag your EC2 and RDS instances with the appropriate tags to control their behavior.
2. The application will automatically manage your instances based on the defined tags and schedules.
3. Tag your Auto Scaling groups to manage their scaling behavior automatically.
4. Monitor the application logs in AWS CloudWatch for detailed information about instance management actions.
5. Use AWS Cost Explorer to track cost savings achieved by the Node Manager.

### Usage Examples

Here are some examples of how to tag your AWS resources to use the AWS Node Manager Application:

1. Automatic start and stop on weekdays (applicable to EC2, RDS, and Auto Scaling Groups):
   ```
   AutoStart: true
   AutoStop: true
   start-schedule: 0 8 * * 1-5
   stop-schedule: 0 18 * * 1-5
   ```
   This will start the resource at 8 AM and stop it at 6 PM on weekdays.
2. Maximum running time of 4 hours (EC2 only):
   ```
   AutoStop: true
   max-runtime: 4h
   ```
   This will automatically stop the EC2 instance after it has been running for 4 hours.
3. Stop instance after 30 minutes of network inactivity (EC2 only):
   ```
   AutoStop: true
   idle-stop-time: 30m
   network-idle-threshold: 1024
   ```
   This will stop the EC2 instance if there's less than 1024 bytes of network activity for 30 minutes.
4. Terminate instance after 7 days (EC2 only):
   ```
   AutoTerminate: true
   max-runtime: 168h
   ```
   This will automatically terminate the EC2 instance after it has been running for 7 days (168 hours).
5. Complex schedule (start on Monday, stop on Friday):
   ```
   AutoStart: true
   AutoStop: true
   start-schedule: 0 9 * * MON
   stop-schedule: 0 18 * * FRI
   ```
   This will start the resource at 9 AM on Monday and stop it at 6 PM on Friday.
6. Resource dependency:
   ```
   AutoStart: true
   AutoStop: true
   depends-on: arn:aws:rds:us-west-2:123456789012:db:mydb
   ```
   This will ensure the dependent resource (in this case, an RDS instance) is started before the tagged resource.
7. CPU idle time (EC2 only):
   ```
   AutoStop: true
   cpu-idle-stop-time: 1h
   cpu-idle-threshold: 10
   ```
   This will stop the EC2 instance if the CPU utilization is below 10% for 1 hour.
8. Flag a resource to be started in the next execution:
   ```
    to-be-started: true
   ```
   This will start the resource in the next execution of the Lambda function.
9. Associate resources with an ELB:
   ```
   AssociatedELB: arn:aws:elasticloadbalancing:us-west-2:123456789012:loadbalancer/app/my-load-balancer/1234567890abcdef
   ```
   This tag can be applied to Auto Scaling Groups and RDS instances. When the ELB has incoming traffic but no available
   handlers,
   the Node Manager will automatically start these associated resources.

## Testing

To run the tests:

    ```
    npm test
    ```

This will run all unit tests using Jest.

## Deployment

To deploy the application to AWS:

1. Ensure you have the AWS SAM CLI installed and configured.
2. Run the deployment script:
   ```
   npm run deploy
   ```

This will package and deploy the Lambda function and associated resources to your AWS account.

## Monitoring and Troubleshooting

* The application logs detailed information about its actions in AWS CloudWatch Logs.
* You can monitor the execution time and success/failure status of each Lambda invocation.
* For troubleshooting, check the CloudWatch Logs for any error messages or unexpected behavior.
* Use AWS X-Ray to trace requests and identify performance bottlenecks.
* Set up CloudWatch Alarms to get notified of any issues or unexpected behavior.

## Best Practices

* Use descriptive tags to easily identify the purpose of each instance
* Regularly review and update your instance tags to ensure optimal resource management
* Monitor CloudWatch Logs and set up alerts for any unexpected behavior
* Use AWS Cost Explorer to track the cost savings achieved by the Node Manager
* Implement a tagging strategy across your organization for consistent resource management

## Security Considerations

* Ensure that the IAM role associated with the Lambda function has the minimum required permissions
* Use AWS Key Management Service (KMS) to encrypt sensitive data in transit and at rest
* Regularly audit and rotate AWS access keys
* Implement VPC endpoints to keep traffic between AWS services within the AWS network
* Use AWS CloudTrail to monitor and log API calls made by the Node Manager

## Performance Considerations

* Use the `RateLimiter` to prevent API throttling when managing a large number of resources
* Consider increasing the Lambda function's memory and timeout settings for better performance
* Use AWS X-Ray to identify and optimize slow-performing parts of the application
* Implement efficient ELB monitoring to minimize unnecessary resource activations
* Implement caching mechanisms for frequently accessed data to reduce API calls

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Setup

1. Fork the repository and clone your fork
2. Install dependencies: `npm install`
3. Make your changes and add tests if applicable
4. Run tests: `npm test`
5. Submit a pull request with a clear description of your changes
6. Ensure your code follows the project's coding standards and practices

## Testing

1. Unit tests: `npm run test:unit`
2. Integration tests: `npm run test:integration`
3. End-to-end tests: `npm run test:e2e`
4. Ensure all tests pass before submitting a pull request.

## Versioning

We use [SemVer](http://semver.org/) for versioning. For the versions available, see
the [tags on this repository](https://github.com/your-repo/aws-node-manager/tags).

For release notes and changelog, please check the [CHANGELOG.md](CHANGELOG.md) file.

## Support

If you encounter any issues or have questions, please file an issue on the GitHub repository.

## Roadmap

* Add support for additional AWS resources (e.g., ECS, EMR, etc.)
* Enhance dependency management to support more complex scenarios
* Add support for custom metrics and advanced scheduling options
* Implement more sophisticated ELB monitoring and resource activation strategies