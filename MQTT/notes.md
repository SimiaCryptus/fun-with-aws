
# API Gateway Setup

## 1. Create WebSocket API

```
aws apigatewayv2 create-api --name "SkyenetSocketAPI" --protocol-type WEBSOCKET --route-selection-expression '$request.body.action'
```

```json
{
  "ApiEndpoint": "wss://bndslpwzjk.execute-api.us-east-1.amazonaws.com",
  "ApiId": "bndslpwzjk",
  "ApiKeySelectionExpression": "$request.header.x-api-key",
  "CreatedDate": "2024-07-18T00:19:07+00:00",
  "DisableExecuteApiEndpoint": false,
  "Name": "SkyenetSocketAPI",
  "ProtocolType": "WEBSOCKET",
  "RouteSelectionExpression": "$request.body.action"
}
```

## 2. Create Routes

```
aws apigatewayv2 create-route --api-id bndslpwzjk --route-key '$connect'
aws apigatewayv2 create-route --api-id bndslpwzjk --route-key '$disconnect'
aws apigatewayv2 create-route --api-id bndslpwzjk --route-key '$default'
```

# Route creation results:

```json
{
  "ApiKeyRequired": false,
  "AuthorizationType": "NONE",
  "RouteId": "auxq4r8",
  "RouteKey": "$connect"
}
```

```json
{
  "ApiKeyRequired": false,
  "AuthorizationType": "NONE",
  "RouteId": "3nqc1bm",
  "RouteKey": "$disconnect"
}

```

```json
{
  "ApiKeyRequired": false,
  "AuthorizationType": "NONE",
  "RouteId": "ld8eng9",
  "RouteKey": "$default"
}
```

# Lambda Function Setup

## 1. Create Lambda Function

```
aws lambda create-function --function-name SkyenetMQTTFunction --zip-file fileb://function.zip --handler index.handler --runtime nodejs20.x --role arn:aws:iam::470240306861:role/SkyenetMQTTRole --environment Variables='{IOT_ENDPOINT=a2txysk7u2ddtv-ats.iot.us-east-1.amazonaws.com}'
```

# Lambda function creation result:

```json
{
  "FunctionName": "SkyenetMQTTFunction",
  "FunctionArn": "arn:aws:lambda:us-east-1:470240306861:function:SkyenetMQTTFunction",
  "Runtime": "nodejs20.x",
  "Role": "arn:aws:iam::470240306861:role/SkyenetMQTTRole",
  "Handler": "index.handler",
  "Environment": {
    "Variables": {
    }
  }
}
```

# API Gateway Integration

## 1. Create Integration

```
aws apigatewayv2 create-integration --api-id bndslpwzjk --integration-type AWS_PROXY --integration-uri arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:470240306861:function:SkyenetMQTTFunction/invocations --integration-method POST
```

# Integration creation result:

```json
{
  "ConnectionType": "INTERNET",
  "IntegrationId": "m8vwtdp",
  "IntegrationMethod": "POST",
  "IntegrationType": "AWS_PROXY",
  "IntegrationUri": "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:470240306861:function:SkyenetMQTTFunction/invocations",
  "PassthroughBehavior": "WHEN_NO_MATCH",
  "PayloadFormatVersion": "1.0",
  "TimeoutInMillis": 29000
}
```

## 2. Update Routes with Integration

```
aws apigatewayv2 update-route --api-id bndslpwzjk --route-key '$connect' --target 'integrations/m8vwtdp' --route-id auxq4r8
aws apigatewayv2 update-route --api-id bndslpwzjk --route-key '$disconnect' --target 'integrations/m8vwtdp' --route-id 3nqc1bm
aws apigatewayv2 update-route --api-id bndslpwzjk --route-key '$default' --target 'integrations/m8vwtdp' --route-id ld8eng9
```

# Route update results:

```json
{
  "ApiKeyRequired": false,
  "AuthorizationType": "NONE",
  "RouteId": "auxq4r8",
  "RouteKey": "$connect",
  "Target": "integrations/m8vwtdp"
}
```

```json
{
  "ApiKeyRequired": false,
  "AuthorizationType": "NONE",
  "RouteId": "3nqc1bm",
  "RouteKey": "$disconnect",
  "Target": "integrations/m8vwtdp"
}
```

```json
{
  "ApiKeyRequired": false,
  "AuthorizationType": "NONE",
  "RouteId": "ld8eng9",
  "RouteKey": "$default",
  "Target": "integrations/m8vwtdp"
}
```

```
aws apigatewayv2 create-stage --api-id bndslpwzjk --stage-name dev --auto-deploy
```

```
aws lambda update-function-configuration --function-name SkyenetMQTTFunction --environment "Variables={IOT_ENDPOINT=a2txysk7u2ddtv-ats.iot.us-east-1.amazonaws.com,APIGW_ENDPOINT=bndslpwzjk.execute-api.us-east-1.amazonaws.com/dev}"
```
