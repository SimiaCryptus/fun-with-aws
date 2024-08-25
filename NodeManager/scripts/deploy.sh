#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

# Define variables
FUNCTION_NAME="AWSEc2NodeManager"
REGION="us-east-1"
ZIP_FILE="function.zip"

# Print start message
echo "Starting deploy process..."

# Create a ZIP file
echo "Creating ZIP file..."
cd dist
zip -r ../$ZIP_FILE .
cd ..
zip -r $ZIP_FILE node_modules

# Upload the ZIP file to Lambda
echo "Uploading function to AWS Lambda..."
aws lambda update-function-code --function-name $FUNCTION_NAME --zip-file fileb://$ZIP_FILE --region $REGION

# Clean up
echo "Cleaning up..."
rm $ZIP_FILE

echo "Build and deploy process completed successfully!"