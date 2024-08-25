#!/bin/bash

# AWS Node Manager Installation Script

# Build and package the Lambda function
echo "Building and packaging Lambda function..."
cd dist && zip -r ../function.zip . && cd ..
zip -r function.zip node_modules

# Set variables
LAMBDA_FUNCTION_NAME="AWSEc2NodeManager"
LAMBDA_ROLE_NAME="AWSEc2NodeManagerRole"
LAMBDA_HANDLER="index.handler"
LAMBDA_RUNTIME="nodejs20.x"
LAMBDA_TIMEOUT=300
LAMBDA_MEMORY=256
EVENTBRIDGE_RULE_NAME="AWSEc2NodeManagerTrigger"
REGION="us-east-1"  # Change this to your preferred region

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
  echo "AWS CLI is not installed. Please install it and configure your credentials."
  exit 1
fi

# Create IAM role for Lambda
echo "Creating IAM role..."
ROLE_ARN=$(aws iam get-role --role-name $LAMBDA_ROLE_NAME --query 'Role.Arn' --output text 2>/dev/null)
if [ -z "$ROLE_ARN" ]; then
  ROLE_ARN=$(aws iam create-role --role-name $LAMBDA_ROLE_NAME --assume-role-policy-document '{"Version": "2012-10-17","Statement": [{"Effect": "Allow","Principal": {"Service": "lambda.amazonaws.com"},"Action": "sts:AssumeRole"}]}' --query 'Role.Arn' --output text)
  if [ -z "$ROLE_ARN" ]; then
    echo "Failed to create IAM role. Exiting."
    exit 1
  fi
  echo "IAM Role created successfully."
else
  echo "IAM Role already exists."
fi
echo "IAM Role ARN: $ROLE_ARN"

 # Attach necessary policies to the role
aws iam attach-role-policy --role-name $LAMBDA_ROLE_NAME --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole 2>/dev/null
aws iam attach-role-policy --role-name $LAMBDA_ROLE_NAME --policy-arn arn:aws:iam::aws:policy/AmazonEC2FullAccess 2>/dev/null
echo "Policies attached to the role."

 # Wait for role to be created
echo "Waiting for IAM role to be fully propagated..."
sleep 15

# Create Lambda function
echo "Creating Lambda function..."
if [ -z "$ROLE_ARN" ]; then
  echo "ROLE_ARN is empty. Cannot create Lambda function. Exiting."
  exit 1
fi

aws lambda create-function \
  --function-name $LAMBDA_FUNCTION_NAME \
  --runtime $LAMBDA_RUNTIME \
  --role $ROLE_ARN \
  --handler $LAMBDA_HANDLER \
  --timeout $LAMBDA_TIMEOUT \
  --memory-size $LAMBDA_MEMORY \
  --zip-file fileb://function.zip \
  --region $REGION

# Create EventBridge rule to trigger Lambda every 5 minutes
echo "Creating EventBridge rule..."
RULE_ARN=$(aws events put-rule \
  --name $EVENTBRIDGE_RULE_NAME \
  --schedule-expression "rate(5 minutes)" \
  --state ENABLED \
  --region $REGION \
  --query 'RuleArn' --output text)

# Add permission for EventBridge to invoke Lambda
echo "Adding Lambda permission for EventBridge..."
aws lambda add-permission \
  --function-name $LAMBDA_FUNCTION_NAME \
  --statement-id EventBridgeInvoke \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn $RULE_ARN \
  --region $REGION

# Set Lambda as target for EventBridge rule
echo "Setting Lambda as target for EventBridge rule..."
LAMBDA_ARN=$(aws lambda get-function --function-name $LAMBDA_FUNCTION_NAME --query 'Configuration.FunctionArn' --output text --region $REGION)
aws events put-targets \
  --rule $EVENTBRIDGE_RULE_NAME \
  --targets "Id"="1","Arn"="$LAMBDA_ARN" \
  --region $REGION

echo "Installation completed successfully!"