@echo off
setlocal enabledelayedexpansion

echo Checking WebSocket API Gateway and Lambda Configuration...
echo.

 REM Set your AWS region and API ID
 set AWS_REGION=us-east-1
 set API_ID=bndslpwzjk
set LAMBDA_ARN=arn:aws:lambda:us-east-1:470240306861:function:SkyenetMQTTFunction
set LAMBDA_NAME=SkyenetMQTTFunction

 REM Check API Gateway
 echo Checking API Gateway...
aws apigatewayv2 get-api --api-id %API_ID% --region %AWS_REGION%
echo.

REM Check Routes
echo Checking Routes...
aws apigatewayv2 get-routes --api-id %API_ID% --region %AWS_REGION%
echo.

REM Check Integrations
echo Checking Integrations...
aws apigatewayv2 get-integrations --api-id %API_ID% --region %AWS_REGION%
echo.

 REM Check Lambda Function
 echo Checking Lambda Function...
 echo Lambda Function Name: !LAMBDA_NAME!
 echo Lambda Function ARN: %LAMBDA_ARN%
 aws lambda get-function --function-name %LAMBDA_NAME% --region %AWS_REGION%
 echo.
echo Checking VPC Configuration...
aws lambda get-function-configuration --function-name %LAMBDA_NAME% --query "VpcConfig" --output json --region %AWS_REGION%
echo.


 REM Check Lambda Permissions
 echo Checking Lambda Permissions...
aws lambda get-policy --function-name %LAMBDA_NAME% --region %AWS_REGION% 2>nul
 if errorlevel 1 (
     echo No policy found for the Lambda function.
     echo Attempting to add permission...
    aws lambda add-permission --function-name %LAMBDA_NAME% --statement-id apigateway-access --action lambda:InvokeFunction --principal apigateway.amazonaws.com --source-arn "arn:aws:execute-api:%AWS_REGION%:470240306861:%API_ID%/*/*" --region %AWS_REGION%
 )
echo Adding execute-api:ManageConnections permission...
aws iam put-role-policy --role-name SkyenetMQTTRole --policy-name WebSocketManageConnections --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"execute-api:ManageConnections\",\"execute-api:Invoke\"],\"Resource\":\"arn:aws:execute-api:%AWS_REGION%:470240306861:%API_ID%/*/*/*\"},{\"Effect\":\"Allow\",\"Action\":[\"execute-api:ManageConnections\"],\"Resource\":\"arn:aws:execute-api:%AWS_REGION%:470240306861:%API_ID%/@connections/*\"}]}" --region %AWS_REGION%
aws iam attach-role-policy --role-name SkyenetMQTTRole --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole --region %AWS_REGION%
echo Adding VPC access permissions...
aws iam attach-role-policy --role-name SkyenetMQTTRole --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole --region %AWS_REGION%
echo.

echo Checking Lambda Environment Variables...
aws lambda get-function-configuration --function-name %LAMBDA_NAME% --query "Environment.Variables" --region %AWS_REGION% 2>nul || echo No environment variables found for the Lambda function.
echo.

REM Check VPC Endpoints
echo Checking VPC Endpoints...
aws ec2 describe-vpc-endpoints --filters "Name=vpc-id,Values=vpc-0df79482b6988cec2" --query "VpcEndpoints[*].{ServiceName:ServiceName,VpcEndpointId:VpcEndpointId,State:State}" --output table --region %AWS_REGION%
echo.

 REM Check CloudWatch Logs
 echo Checking recent CloudWatch Logs for Lambda function...
aws logs filter-log-events --log-group-name /aws/lambda/%LAMBDA_NAME% --start-time %DATE:~10,4%%DATE:~4,2%%DATE:~7,2%000000 --region %AWS_REGION% --query "events[*].message" --output text 2>nul
 if errorlevel 1 (
      echo No recent logs found or log group does not exist.
      echo Attempting to create log group...
    aws logs create-log-group --log-group-name /aws/lambda/%LAMBDA_NAME% --region %AWS_REGION%
 )
 echo.

