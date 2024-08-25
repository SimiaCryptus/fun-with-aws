# WebSocket Chat Room Application

## Project Overview

This project implements a real-time chat room application using WebSockets. It consists of a Lambda function that
handles WebSocket connections and a client-side HTML/JavaScript implementation for the chat interface.
The application uses a serverless architecture with AWS Lambda and API Gateway, and stores connected client information
in a PostgreSQL database.

## Features

* Real-time chat functionality using WebSockets
* Support for multiple chat rooms (topics)
* Serverless architecture using AWS Lambda and API Gateway
* PostgreSQL database for storing connected clients
* Real-time message broadcasting
* TypeScript-based development for improved code quality

## Prerequisites

* Node.js (>= 14.0.0)
* AWS CLI configured with appropriate permissions
* AWS account with access to Lambda, API Gateway, and RDS
* PostgreSQL database instance (RDS recommended)

## Installation

1. Clone the repository:

 ```
 git clone <repository-url>
 cd <project-directory>
 ```

2. Install dependencies:

 ```
 npm install
 ```

3. Set up the PostgreSQL database:
    - Create a new PostgreSQL database instance (if not already done)

## Configuration

1. Set up environment variables:

* `DB_HOST`: RDS database host
* `DB_KEY`: AWS Secrets Manager key for database credentials
* `LAMBDA_FUNCTION_ARN`: ARN of the Lambda function
* `APP_ID`: API Gateway app ID
* `AWS_REGION`: AWS region

2. Configure AWS CLI with your credentials.
3. Update the `config.json` file with your specific AWS resource identifiers and other configuration options.

## Usage

To run the chat application locally for development:

1. Start the development server:

 ```
 npm start
 ```

2. Open `test.html` in a web browser to access the chat interface.
3. To join a specific chat room, use the URL parameter `?room=<room_name>` when opening `test.html`.

## Development

The main Lambda function code is in `src/index.ts`.
Use `npm run build` to compile TypeScript to JavaScript.
Use `npm run type-check` to check for TypeScript errors.

* Use `npm run lint` to run ESLint for code style checking.

## Deployment

To deploy the Lambda function:

1. Build the project:

 ```
 npm run build
 ```

2. Run the deployment script:

 ```
 npm run deploy
 ```

This will package the function and update it on AWS Lambda.
For detailed AWS setup instructions, refer to the `notes.md` file, which contains AWS CLI commands for setting up the
API Gateway and Lambda function.

## Testing

1. Run unit tests:

 ```
 npm test
 ```

2. For manual testing, use the `test.html` file in a web browser.

3. To check the WebSocket configuration, run:

 ```
 check_websocket_config.bat
 ```

4. For Unix-based systems, use:

```
./check_websocket_config.sh
```

## WebSocket Protocol

Refer to `websocket-protocol.md` for detailed information about the WebSocket communication protocol used in this
application. This document outlines the message formats, actions, and communication flow between the client and server.

## File Structure

* `src/index.ts`: Main Lambda function code
* `test.html`: Client-side chat interface for testing
* `scripts/deploy.sh`: Deployment script
* `check_websocket_config.bat`: Script to check WebSocket configuration
* `check_websocket_config.sh`: Unix version of the WebSocket configuration check script
* `websocket-protocol.md`: WebSocket protocol documentation
* `notes.md`: AWS setup instructions and CLI commands
* `config.json`: Configuration file for AWS resource identifiers

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

