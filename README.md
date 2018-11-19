"# lambda-builder"

Install:

	npme install -g lambda-builder

Syntax to run:

	(Change the director to the folder where your lambdas are stored).

	Then run:
		
		lambda-builder 

You will be prompted for the AWS Region an S3 Bucket that you control. The Lambda .ZIP files will be stored there. The bucket should not be pulbic.
The "default" AWS command line profile should have privledges to create IAM Roles, and Lambda functions.

First time run on a new Lambda project:

	node index.js --FOLDER=D:\some-project-folder\folder-containing-lambda-functions --REGION=us-west-1 --PROFILE=LambdaBuildIAMUser --BUCKET=ylopo-lambda-build --ROLE=arn:aws:iam::123456789012:user/LambdaExecuteRole --ENVIRONMENT=(optional)


	FOLDER should be a local path to a folder that contains folders that contain lambda functions.

		Example folder structure:

			some-disk\
				folder-containing-lambda-functions\
					lambda-function-1\
						index.js
						package.json
					lambda-function-2\
						index.js
						package.json

	This script will also create a '.build' folder at some-project-folder\.build for the local .ZIP deployment files.

	REGION is the region where the lambda runs.

	PROFILE is the profile in the local .aws/credentials file that is used to send .ZIP files to S3 and run the LambdaBuilder inside AWS Lambda.
		Should have S3 full privledges, Lambda full privledges

	ROLE is the execution role the Lambdas will use to run. This can also be specified inside the package.json file.

	ENVIRONMENT is optional and can be used to specify different versions of the Lambda, usually to be used for 'production' and 'staging' and 'dev'.


This program works as a "livereload" for Lambda functions. It watches local Lambdas folder for changes, and if a change is made
then it will create a new .ZIP file, upload to S3 and deploy it to a Lambda function. If it's the first time the Lambda is being
deployed it will install node modules inside a Lambda running on AWS Linux, so that the deployment package has any modules that need
to be compiled to run in the execution environment. For subsequent updats to source code, a new .ZIP file is not built - the file
is updated in the local copy of the Lambda deployment .ZIP and the changes are uploaded to S3 and deployed which is faster.

If a package.json file is changed then it means new dependencies are probably installed, the deployment package will be rebuilt
inside AWS and then deployed.
