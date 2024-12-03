# "lambda-builder1"

This program works as a "livereload" for Lambda functions. It watches local Lambdas folder for changes, and if a change is made
then it will create a new .ZIP file, upload to S3 and deploy it to a Lambda function. If it's the first time the Lambda is being
deployed it will install node modules inside a Lambda running on AWS Linux, so that the deployment package has any modules that need
to be compiled to run in the execution environment. For subsequent updates to source code, a new .ZIP file is not built - the file
is updated in the local copy of the Lambda .ZIP file in the .build folder and the changes are uploaded to S3 and deployed, which is faster. If the package.json file is updated with new dependencies, then the builder is run again in AWS Linux and a new .ZIP is created with new node_modules built, and then the new .ZIP file is deployed to your Lambda function.

# Install:

	npm install -g lambda-builder

After installing, change the directory to the folder where your lambdas are stored.

#Expected folder structure:

		some-disk\
			folder-containing-lambda-functions\
				lambda-function-1\
					index.js
					package.json
				lambda-function-2\
					index.js
					package.json

# AWS Permissions:

You will need to supply the AWS Region, an IAM role that has S3 access, and an S3 Bucket that you control. The compiled Lambda .ZIP files will be stored in the S3 bucket. The bucket should not be pulbic.
The "default" AWS profile should have privledges to create IAM Roles if the LambdaBuilder lambda is not yet installed and the IAM roles needed have not been created, and the IAM role should also be able to create Lambda functions.

# Usage:

lambda-builder --FOLDER=D:\some-project-folder\folder-containing-lambda-functions --REGION=us-west-1 --PROFILE=LambdaBuildIAMUser --BUCKET=lambda-builder-bucket --ROLE=LambdaBuilderExecuteRole --ENVIRONMENT=(required)

--ENVIRONMENT specifies a prefix for the name of the Lambda. This is so multiple people can create Lambdas for the same repository in the same AWS account. You can use --ENVIRONMENT=dev for developing or --ENVIRONMENT=prod for deploying your lambdas to "production". How you use this is up to you.

Deploying without an environment namespace prefix requires using --DEPLOY=true which removes the --ENVIRONMENT input requirement and deploys lambdas without any namespace prefix.

--FOLDER should be a local path to a folder, which contains folders, that contain lambda functions (see Expected folder structure above).

--REGION is the region where the lambda runs.

--PROFILE is the profile in the local .aws/credentials file that is used to send .ZIP files to S3 and run the LambdaBuilder inside AWS Lambda. It should have S3 full privledges, Lambda full privledges.

--ROLE is the execution role the Lambdas will use to run. This can also be specified inside the package.json file for each lambda.

This script will also create a '.build' folder at folder-containing-lambda-functions\.build for the local .ZIP deployment files. You could decide to add .build to your .gitignore file.
