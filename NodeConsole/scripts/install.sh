#!/bin/bash

# AWS Node Manager Installation Script

# Build and package the Lambda function
echo "Building and packaging Lambda function..."
cd dist && zip -r ../function.zip . && cd ..
zip -r function.zip node_modules

# Set variables
LAMBDA_FUNCTION_NAME="AWSEc2NodeConsole"
LAMBDA_ROLE_NAME="AWSEc2NodeConsoleRole"
LAMBDA_HANDLER="index.handler"
LAMBDA_RUNTIME="nodejs20.x"
LAMBDA_TIMEOUT=300
LAMBDA_MEMORY=256
REGION="us-east-1"  # Change this to your preferred region

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
echo "AWS CLI is not installed. Please install it and configure your credentials."
exit 1
fi
# Function to get role ARN
get_role_arn() {
aws iam get-role --role-name $LAMBDA_ROLE_NAME --query 'Role.Arn' --output text
}
# Create IAM role
echo "Creating IAM role..."
ROLE_ARN=$(get_role_arn)
if [ -z "$ROLE_ARN" ]; then
  ROLE_ARN=$(aws iam create-role --role-name $LAMBDA_ROLE_NAME --assume-role-policy-document '{"Version": "2012-10-17","Statement": [{ "Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}]}' --query 'Role.Arn' --output text)
echo "IAM role created: $ROLE_ARN"
else
  echo "IAM role already exists: $ROLE_ARN"
fi
# Attach necessary policies to the role
echo "Attaching policies to IAM role..."
aws iam attach-role-policy --role-name $LAMBDA_ROLE_NAME --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam attach-role-policy --role-name $LAMBDA_ROLE_NAME --policy-arn arn:aws:iam::aws:policy/AmazonEC2FullAccess
# Wait for role to be created
echo "Waiting for IAM role to be fully propagated..."
sleep 30
# Create Lambda function
echo "Creating Lambda function..."
EXISTING_FUNCTION=$(aws lambda get-function --function-name "$LAMBDA_FUNCTION_NAME" --region "$REGION" --query 'Configuration.FunctionArn' --output text 2>/dev/null)
if [ -n "$EXISTING_FUNCTION" ]; then
  echo "Lambda function $LAMBDA_FUNCTION_NAME already exists. Updating function code..."
  LAMBDA_ARN=$(aws lambda update-function-code \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --zip-file fileb://function.zip \
    --region "$REGION" \
    --query 'FunctionArn' \
    --output text)
else
  echo "Creating new Lambda function..."
  LAMBDA_ARN=$(aws lambda create-function \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --runtime "$LAMBDA_RUNTIME" \
    --role "$ROLE_ARN" \
    --handler "$LAMBDA_HANDLER" \
    --timeout $LAMBDA_TIMEOUT \
    --memory-size $LAMBDA_MEMORY \
    --zip-file fileb://function.zip \
    --region "$REGION" \
    --query 'FunctionArn' \
    --output text)
fi
if [ -z "$LAMBDA_ARN" ]; then
  echo "Failed to create Lambda function. Check the error message above for details."
  echo "Ensure that the IAM role has been fully propagated before retrying."
  exit 1
fi
echo "Lambda function created or updated: $LAMBDA_ARN"

# Create API Gateway
echo "Creating API Gateway..."
EXISTING_API_ID=$(aws apigateway get-rest-apis --region $REGION --query "items[?name=='${LAMBDA_FUNCTION_NAME}API'].id" --output text)
if [ -z "$EXISTING_API_ID" ]; then
  echo "Creating new API Gateway..."
  API_ID=$(aws apigateway create-rest-api --name "${LAMBDA_FUNCTION_NAME}API" --region $REGION --query 'id' --output text)
else
  echo "API Gateway already exists. Updating configuration..."
  API_ID=$EXISTING_API_ID
fi

ROOT_RESOURCE_ID=$(aws apigateway get-resources --rest-api-id $API_ID --region $REGION --query 'items[0].id' --output text)

 # Create resource
EXISTING_RESOURCE_ID=$(aws apigateway get-resources --rest-api-id $API_ID --region $REGION --query "items[?path=='/instances'].id" --output text)
if [ -z "$EXISTING_RESOURCE_ID" ]; then
  RESOURCE_ID=$(aws apigateway create-resource --rest-api-id $API_ID --parent-id $ROOT_RESOURCE_ID --path-part "instances" --region $REGION --query 'id' --output text)
else
  RESOURCE_ID=$EXISTING_RESOURCE_ID
fi

# Create GET method
aws apigateway put-method --rest-api-id $API_ID --resource-id $RESOURCE_ID --http-method GET --authorization-type "NONE" --region $REGION || true
# Create POST method
aws apigateway put-method --rest-api-id $API_ID --resource-id $RESOURCE_ID --http-method POST --authorization-type "NONE" --region $REGION || true
# Set up Lambda integration for GET
aws apigateway put-integration --rest-api-id $API_ID --resource-id $RESOURCE_ID --http-method GET --type AWS_PROXY --integration-http-method POST --uri arn:aws:apigateway:$REGION:lambda:path/2015-03-31/functions/arn:aws:lambda:$REGION:$(aws sts get-caller-identity --query 'Account' --output text):function:$LAMBDA_FUNCTION_NAME/invocations --region $REGION
# Set up Lambda integration for POST
aws apigateway put-integration --rest-api-id $API_ID --resource-id $RESOURCE_ID --http-method POST --type AWS_PROXY --integration-http-method POST --uri arn:aws:apigateway:$REGION:lambda:path/2015-03-31/functions/arn:aws:lambda:$REGION:$(aws sts get-caller-identity --query 'Account' --output text):function:$LAMBDA_FUNCTION_NAME/invocations --region $REGION
# Enable CORS
echo "Enabling CORS..."
# Enable CORS for GET, POST, and OPTIONS methods
for METHOD in GET POST OPTIONS
do
  # Add method if it doesn't exist
  aws apigateway put-method --rest-api-id $API_ID --resource-id $RESOURCE_ID --http-method $METHOD --authorization-type NONE --region $REGION || true
  # Set up integration
  if [ "$METHOD" = "OPTIONS" ]; then
    aws apigateway put-integration --rest-api-id $API_ID --resource-id $RESOURCE_ID --http-method $METHOD --type MOCK --request-templates '{"application/json": "{\"statusCode\": 200}"}' --region $REGION
  else
    aws apigateway put-integration --rest-api-id $API_ID --resource-id $RESOURCE_ID --http-method $METHOD --type AWS_PROXY --integration-http-method POST --uri arn:aws:apigateway:$REGION:lambda:path/2015-03-31/functions/$LAMBDA_ARN/invocations --region $REGION
  fi
  # Set up method response
  aws apigateway put-method-response --rest-api-id $API_ID --resource-id $RESOURCE_ID --http-method $METHOD --status-code 200 \
    --response-parameters "{\"method.response.header.Access-Control-Allow-Headers\":true,\"method.response.header.Access-Control-Allow-Methods\":true,\"method.response.header.Access-Control-Allow-Origin\":true}" \
    --region $REGION || true
  # Set up integration response
  aws apigateway put-integration-response --rest-api-id $API_ID --resource-id $RESOURCE_ID --http-method $METHOD --status-code 200 \
    --response-parameters "{\"method.response.header.Access-Control-Allow-Headers\":\"'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'\",\"method.response.header.Access-Control-Allow-Methods\":\"'GET,POST,OPTIONS'\",\"method.response.header.Access-Control-Allow-Origin\":\"'*'\"}" \
    --region $REGION || true
done

# Deploy API
aws apigateway create-deployment --rest-api-id $API_ID --stage-name prod --region $REGION
# Update Lambda function to add permission for API Gateway
aws lambda add-permission \
  --function-name $LAMBDA_FUNCTION_NAME \
  --statement-id apigateway-test-2 \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$REGION:$(aws sts get-caller-identity --query 'Account' --output text):$API_ID/*/*/instances" \
  --region $REGION

echo "Installation complete. API Gateway URL: https://$API_ID.execute-api.$REGION.amazonaws.com/prod/instances"