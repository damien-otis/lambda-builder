#!/usr/bin/env node

const fs = require('fs');
const glob = require('glob');

const yargs = require('yargs');
const argv = yargs.argv;

const Promise = require('bluebird');

const path = require('path');
const chokidar = require('chokidar');

const atob = require('atob');
const cc = require("node-console-colors");

const basePath = path.resolve(process.cwd())
// console.log("basePath:",basePath,'\n');

const Zip = require('node-zip');
const deepmerge = require('deepmerge');

const { buildLambda, makeZip } = require('./LambdaBuilder/lambdaBuilder/buildLambda.js');

const lambdaBuilderDir = path.dirname(fs.realpathSync(__filename));

const packageJSON = require('./package.json');
console.log(`${cc._fg_white}${cc._bg_blue}Lambda Builder v${packageJSON.version}${cc._reset}`);

//const pkg = require(`${lambdaFolder}${path.sep}package.json`);
// console.log('>>lambdaBuilderDir:',lambdaBuilderDir);
//--------------------------------------------------------------------------------------------------------------

//if (!argv.FOLDER) {
//	console.log("Please specify --FOLDER input argument of folder containling Lambda functions to watch for updates.");
//	process.exit();
//}

let lambdaFolder = '';
if (process.env.INIT_CWD){
	lambdaFolder = path.resolve(path.normalize(process.env.INIT_CWD.replace(/^\"|"$/g,'')));
} else {
	lambdaFolder = path.resolve(path.normalize(process.cwd().replace(/^\"|"$/g,'')));
}

// console.log("LAMBDAFOLDER",lambdaFolder)

const buildFolder = `${lambdaFolder}/.build`;
fs.stat(buildFolder, (err, stats)=>{
	if (err) {
		createBuildFolder()
	} else if (!stats.isDirectory()) {
		createBuildFolder()
	}
	function createBuildFolder(){
		fs.mkdirSync(buildFolder);
	}
});

//--------------------------------------------------------------------------------------------------------------

var config;
var configFile = path.normalize(`${lambdaFolder}${path.sep}lambda-builder-config.json`);
try{
	config = JSON.parse(fs.readFileSync(configFile), 'utf8');

	if (argv.REGION) {
		config.region = argv.REGION;
	} else {
		console.log(" > Please use --REGION= to set AWS Lambda region\n");
	}
	if (argv.BUCKET) {
		config.lambdaS3Bucket = argv.BUCKET;
	} else {
		console.log(" > Please use --BUCKET= to set AWS S3 bucket that lambda build into. The your default AWS profile must have full access there.\n");
	}
	if (argv.AWSPROFILE) {
		config.profile = argv.AWSPROFILE;
	} else {
		console.log(" > Please use --BUCKET= to set AWS S3 bucket that lambda build into. The your default AWS profile must have full access there.\n");
	}
	if (argv.DEPLOY === 'true'){
		config.environment = "";
	} else {
		if (argv.ENVIRONMENT && !argv.DEPLOY){
			config.environment = argv.ENVIRONMENT;
		} else {
			console.log("--ENVIRONMENT is required")
			process.exit()
		}
	}

	if (!config.region || !config.lambdaS3Bucket){
		process.exit();
	}

	if (argv.REGION || argv.BUCKET || argv.ENVIRONMENT){
		fs.writeFileSync(configFile, JSON.stringify(config,null,4), 'utf8');
	}

}catch(e){
	console.log("\nCould not read config file", configFile,", attempting to create a new one...");
	if (!argv.REGION) {
		console.log(" > Please use --REGION= to set AWS Lambda region\n");
	}
	if (!argv.BUCKET) {
		console.log(" > Please use --BUCKET= to set AWS S3 bucket that lambda build into. The your default AWS profile must have full access there.\n");
	}

	if (!argv.REGION || !argv.BUCKET) {
		process.exit();
	}
	config = {
		region			: argv.REGION,
		environment		: argv.ENVIRONMENT || '',
		lambdaS3Bucket	: argv.BUCKET
	}
	fs.writeFileSync(configFile, JSON.stringify(config, null, 4), 'utf8');
	console.log("\nCreated new config file",configFile);
}

global.lambdaS3Bucket = config.lambdaS3Bucket;

console.log("\nLambda Builder Config:",JSON.stringify(config,null,4));

//--------------------------------------------------------------------------------------------------------------
//Match the nodejs version running locally if no version is specified in the configs

const nodever = argv.NODEVER || process.version;
const majver = parseInt(nodever.split('.')[0].replace(/[^0-9]/g,''), 10);
if (majver&1 === 1) {
	console.log(`Node version ${nodever} is not supported, only LTS releases are supported by AWS Lambda`);
	process.exit()
}
const supportedNodeVer = `nodejs${majver}.x`;
console.log('supportedNodeVer:', supportedNodeVer);

//-----------------------------------------------------------------------------------
console.log("AWSPROFILE:",argv.AWSPROFILE)
const AWS = require('aws-sdk');
AWS.config.credentials = new AWS.SharedIniFileCredentials({profile: argv.AWSPROFILE || 'default'}); // {profile: config.profile}
const lambda = new AWS.Lambda({region: config.region});
const s3 = new AWS.S3({region: config.region});
const sts = new AWS.STS();
const iam = new AWS.IAM();

//-----------------------------------------------------------------------------------
/*
getCurrentAccountId().then(data=>{
	console.log("data",data)
});
*/
//-----------------------------------------------------------------------------------

doesLambdaExist('lambdaBuilder').catch(err=>{
	//Package lambdaBuilder locally and deploy to AWS...
	console.log("lambdaBuilder is not deployed, attempting to build and deploy it now...");
	buildLambdaBuilder();
}).then(()=>{
	startWatching()
});

//-----------------------------------------------------------------------------------

function getLambdaName(filePath){
	if (filePath.toLowerCase().indexOf('lambdabuilder')!==-1){
		return 'lambdaBuilder'
	}
	const filePathBase = filePath.split(path.sep).slice(0,-1).join(path.sep);
	let lambdaPathBase = watchedFolders.filter(watchedFolder=>filePathBase.indexOf(watchedFolder)!==-1)[0];
	if (lambdaPathBase === undefined){
		lambdaPathBase = watchedFolders.filter(watchedFolder=>path.normalize(filePath).indexOf(watchedFolder)!==-1)[0];
	}
	var env = config.environment ? config.environment + '_' : '';
	return env+(lambdaPathBase.split(path.sep).slice(-1));
}

function getLambdaFolder(file){
	const filePathBase = file.split(path.sep).slice(0,-1).join(path.sep);
	const lambdaPathBase = watchedFolders.filter(watchedFolder=>filePathBase.indexOf(watchedFolder)!==-1)[0];
	return lambdaPathBase;
}
//-----------------------------------------------------------------------------------
/*
glob(`${lambdaFolder}/*`+`*`+'/package.json`,{nodir:true, ignore:[`${lambdaFolder}/*`+`*`+`/node_modules/*`+`*`+`/`+`*`]}, (err,files) => {

	files.forEach(o=>{
		var lambdaName = getLambdaName(o);
		var zipFile = path.normalize(`${lambdaFolder}/.build/${lambdaName}.zip`);

		fs.stat(zipFile, (err, stats)=>{
			if (err) {
				console.log("No ZIP file:",zipFile);
			} else if (!stats.isFile()) {

			}
		});
	});
});
*/

//-----------------------------------------------------------------------------------
//Watch project files for changes (minus package.json), if file changed then update the Zip file in the local build folder and deploy to Lambda.
const watchedFolders = [];

function startWatching(){
	glob(`${lambdaFolder}/**/package.json`,{nodir:true, ignore:[`${lambdaFolder}/**/node_modules/**/*`]}, (err,files) => {

		files.forEach(o=>{
			var thisFile = path.normalize(o);
			const lambdaPath = thisFile.split(path.sep).slice(0,-1).join(path.sep);
		console.log(`Lambda: `, lambdaPath)
			watchedFolders.push(lambdaPath)
		});

		//-----------------------------------------------------------------------------------

		const watchFiles = chokidar.watch(watchedFolders, {
			ignored: [/node_modules/, /package.json/, /package-lock.json/],//We handle package.json below
			usePolling: true,
			depth: 2,
		});

		//	Watch package.json files for changes. If package.json changes then make ZIP of project files (without node_modules) and send
		//	to lambdaBuilder to install node_modules on AWS and then deploy to Lambda.
		var watchPackage = chokidar.watch(watchedFolders.map(o=>{
			return `${o}${path.sep}package.json`
		}), {
			ignored: /node_modules/,
			usePolling: true,
			depth: 2,
		})
		
		//-----------------------------------------------------------------------------------

		watchFiles.on('ready', ()=>{
			watchFiles.on('add',	(file)=>updateFile(file,'add'));
			watchFiles.on('change', (file)=>updateFile(file,'change'));
			watchFiles.on('unlink', (file)=>updateFile(file,'unlink'));
		});

		watchPackage.on('ready', ()=>{
			watchPackage.on('add',		(file)=>installModules(file,'add'));
			watchPackage.on('change',	(file)=>installModules(file,'change'));
			watchPackage.on('unlink',	(file)=>installModules(file,'unlink'));
		});
	});
}

//-----------------------------------------------------------------------------------
var last_update = "";
var last_update_tmr;

function updateFile(file, action) {
	if (last_update === file){
		return
	}
	last_update = file;
	if (last_update_tmr){clearTimeout(last_update_tmr)}
	last_update_tmr = setTimeout(()=>{
		last_update = "";
		last_update_tmr = undefined;
	}, 250);

	console.log("------------------------------------------------------------------");
	console.log("updateFile",file,action);

	var lambdaName = getLambdaName(file);
	var lambdaFolder = getLambdaFolder(file);
	console.log("Updating:",lambdaName)

	var zipFile = path.normalize(`./.build${path.sep}${lambdaName}.zip`);

	fs.stat(zipFile, (err, stats)=>{
		if (err) {
			console.log("No ZIP file:",zipFile);
			installModules(file, action);
			return;
		} else if (!stats.isFile()) {
			console.log("No ZIP file:",zipFile);
			installModules(file, action);
			return;
		} else {
			updateZipFile()
		}
	});

	function updateZipFile(){
		var zipData = fs.readFileSync(zipFile, 'binary');
		var zip = new Zip(zipData, {base64: false, checkCRC32: true});

		var filePath = file.split(path.normalize(`${lambdaFolder}${path.sep}`))[1];

		var fileData = fs.readFileSync(file);

		zip.file(filePath, fileData)

		var zipUpdate = zip.generate({base64:false, compression:'DEFLATE'});
		fs.writeFileSync(zipFile, zipUpdate, 'binary');

		let params = {
			Body:  Buffer.from(zipUpdate, 'binary'),
			Bucket: config.lambdaS3Bucket,
			Key: `${lambdaName}.zip`,
			ContentType: 'application/zip'
		};

		s3.putObject(params, function(err, data) {
			if (err) {
				console.log(err, err.stack); // an error occurred
			}

			var thisLambdaFolder = getLambdaFolder(file);

			doesLambdaExist(lambdaName).then(data=>{
				updateLambda(thisLambdaFolder)
			}).catch(err=>{
				console.log("Lambda does not exist?",err.statusCode)
				doCreateLambda();
				function doCreateLambda(roleArn){
					createLambda(thisLambdaFolder, roleArn)
						.then(()=>{
							console.log("Created Lambda:",lambdaName)
						})
						.catch((err)=>{
							console.log("Retry create lambda...", err)
							setTimeout(()=>{
								doCreateLambda(roleArn)
							}, 1000);
						});
				}
			})
		});
	}
}

//-----------------------------------------------------------------------------------

function installModules(file, action){
	
	var lambdaName = getLambdaName(file);

	console.log("Building:",lambdaName);

	var zip = new Zip();

	var zipFiles = [];
	const folder = getLambdaFolder(file);
	var thisGlob = `${folder}${path.sep}**${path.sep}*`;
	var ignoreModules = `${folder}${path.sep}node_modules${path.sep}**${path.sep}*`;

	glob(thisGlob, {nodir:true, ignore:[ignoreModules]}, (err,files) => {
		files.forEach(o=>{
			if (o.indexOf('node_modules')!==-1){return}
			var filename = path.normalize(o).split(path.sep).pop();

			zipFiles.push(new Promise((resolve, reject)=>{
				fs.readFile(o, 'utf8', (err, data)=>{
					if (err){
						console.log("error reading file:",o);
						return
					}

					if (path.normalize(o).split(path.sep).pop() === 'package.json') {
						var fixPackage = JSON.parse(data);
						if (fixPackage && fixPackage.dependencies && fixPackage.dependencies['aws-sdk']){
							delete fixPackage.dependencies['aws-sdk'];
							fixPackage.lambdaS3Bucket = config.lambdaS3Bucket;
							data = JSON.stringify(fixPackage,null,4);
						}
					}

					zip.file(filename, data);
					resolve();
				});

			}))
		});

		Promise.all(zipFiles).then(()=>{

			var data = zip.generate({base64:true, compression:'DEFLATE'});

			runLambdaBuilder(lambdaName, data, (err, packagedZip)=>{
				if (err){
					console.log("Error building lambda", err);
					return;
				}
				console.log("Lambda build complete.")
				
				s3.getObject(JSON.parse(packagedZip), function(err, data) {
					if (err) {
						console.log('s3.getObject error:',err);
						return
					} else {
						fs.writeFileSync(path.normalize(`${lambdaFolder}${path.sep}.build${path.sep}${lambdaName}.zip`), data.Body, 'binary');
					}

					doesLambdaExist(lambdaName).then(()=>{
						updateLambda(getLambdaFolder(file));
					}).catch(err=>{
						createLambda(getLambdaFolder(file))
					});

				});

			});
		})

	});
}

//-----------------------------------------------------------------------------------
//Can't use API Gateway for this, because it has a mandatory 30-second timeout, and
//running this lambda requires a 5 minute timeout due to the NPM install.
function runLambdaBuilder(name, data, callback) {

	doesLambdaExist('lambdaBuilder').then(exists=>{

		var postData = {
			name: name,
			data: data
		}

		var params = {
			FunctionName: "lambdaBuilder",
			InvocationType: "RequestResponse",
			LogType: "Tail",
			Payload: JSON.stringify(postData)
		};

		lambda.invoke(params, function(err, data) {
			if (err) {
				console.log("runLambdaBuilder Error:",err);
				return
			}
			if (data.LogResult && argv.DEBUG){
				console.log("\nLogResult:\n",atob(data.LogResult))
			}
			callback(null, data.Payload);
		});

	}).catch(err=>{
		console.log("lambdaBuilder does not exist, create in region",config.region);
	//	createLambda('./Builder/lambdaBuilder')
	})

}

//-----------------------------------------------------------------------------------

function doesLambdaExist(lambdaName) {
	return new Promise((resolve, reject)=>{
		var params = {
		  FunctionName: lambdaName,
		  //Qualifier: 'STRING_VALUE'
		};
		lambda.getFunctionConfiguration(params, function(err, data) {
			if (err) {
				reject(err)
			} else {
				resolve(data)
			}
		});
	});
}

//-----------------------------------------------------------------------------------

function getLambdaPackageConfig(thisLambdaFolder) {
	var packageJsonFile = path.normalize(`${thisLambdaFolder}${path.sep}package.json`);

	var packageConfig = {};
	var stats = fs.statSync(packageJsonFile);
	if (!stats.isFile()) {
		console.log("No package.json file:",packageJsonFile);
	} else {
		var pkgfile = fs.readFileSync(packageJsonFile, 'utf8');
		packageConfig = JSON.parse(pkgfile).lambdaConfig;
	}

	return packageConfig || {}
}

//-----------------------------------------------------------------------------------

function createLambda(thisLambdaFolder, roleOverride) {
	return new Promise((resolve, reject)=>{
		var lambdaName = getLambdaName(thisLambdaFolder);

		console.log("createLambda:",lambdaName);

		var params = {
			Code: { /* required */
				S3Bucket: config.lambdaS3Bucket,
				S3Key: `${lambdaName}.zip`
			},
			FunctionName	: lambdaName, /* required */
			Handler				: "index.handler", /* required */
			Role					: roleOverride || '', 					/* required */
			Runtime				: supportedNodeVer || "nodejs12.x",	/* required */
			Timeout				: 900, //Max is 900
			MemorySize		: 512, // Max is 3008MB
			Description		: ""
		};

		var packageConfig = getLambdaPackageConfig(thisLambdaFolder);
		params = deepmerge.all([params, packageConfig || {}]);

		if (!params.Role) {
			console.log("No role specified, using LambdaExecute Role...");
			createLambdaExecuteRole().then(roleArn=>{
				console.log("ROLE ARN:",roleArn)				
				params.Role = roleArn;
				createLambdaFunction();
			});
		} else {
			createLambdaFunction();
		}

		//--------------------------------------------------------------------
		function createLambdaFunction(){
			console.log("createLambdaFunction...")

			lambda.createFunction(params, function(err, data) {
				if (err) {
					console.log('>>>>>>>>>>>>createLambdaFunction error', err, err.stack, JSON.stringify(params,null,4))
					reject(params.Role);
					return
				}
				console.log("Lambda created.")
				resolve()
			});
		}
		//--------------------------------------------------------------------

	});
}

//-----------------------------------------------------------------------------------

function updateLambda(thisLambdaFolder) {

	var lambdaName = getLambdaName(thisLambdaFolder);

	//var packageConfig = getLambdaPackageConfig(thisLambdaFolder);

	var params = {
		FunctionName: lambdaName, /* required */
		DryRun: false,
		Publish:false,
		S3Bucket: config.lambdaS3Bucket,
		S3Key: `${lambdaName}.zip`
	};
	lambda.updateFunctionCode(params, function(err, data) {
		if (err) {
			console.log(">>>updateLambda", err, err.stack)
		} else {
			console.log("Lambda updated.");
		}
	});

}

//---------------------------------------------------------------------------------------------------
//Get the account id of the current AWS command line user (default profile in .aws/credentials file)
/*
function getCurrentAccountId(){
	return new Promise((resolve, reject)=>{
		sts.getCallerIdentity({},function(err, data) {
			if (err) {
				console.log(err, err.stack);
				return reject(err)
			}
			resolve(data.Account);
		});
	})
}
*/
//-----------------------------------------------------------------------------------
function buildLambdaBuilder(){

	console.log("buildLambdaBuilder...");

	let params = {
  	Bucket: config.lambdaS3Bucket
 	};
 	s3.headBucket(params, (err, data) => {
  	if (err){
			console.log("lambdaBuilder bucket does not exist, attempting to create it:", params.Bucket)
		//	console.log(err, err.stack); // an error occurred
			s3.createBucket(params, (err, data) => {
				if (err){
					console.log("Could not create lambdaBuilder bucket:", params.Bucket)
					console.error(err)
				} else {
					startBuild()
				}
			})
		} else {
			startBuild()
		}
	});

	
	function startBuild(){
		makeZip(path.resolve(`${lambdaBuilderDir}${path.sep}LambdaBuilder${path.sep}lambdaBuilder`), (zipData)=>{
			buildLambda(zipData, 'lambdaBuilder', (err, installedLambda)=>{

				let params = {
					Body:  Buffer.from(installedLambda, 'base64'),
					Bucket: config.lambdaS3Bucket,
					Key: `lambdaBuilder.zip`,
					ContentType: 'application/zip'
				};

				s3.putObject(params, function(err, data) {
					if (err) {
						console.log(err, err.stack); // an error occurred
					}

					createLambdaBuilderRole().then(roleArn=>{
						setTimeout(()=>{createLambdaBuilderLambda(roleArn)},5000);
					})
				});

			})
		}, [`node_modules/**/*`]);
	}

}

//-----------------------------------------------------------------------------------
// FAILS WITH "The role defined for the function cannot be assumed by Lambda." ON FIRST TRY TO CREATE LAMBDABUILDER ROLE
function createLambdaBuilderLambda(roleArn){
	const lambdaBuilderPath = path.resolve(`${lambdaBuilderDir}${path.sep}LambdaBuilder${path.sep}lambdaBuilder`);
	createLambda(lambdaBuilderPath, roleArn)
	.then(()=>{
		console.log("LambdaBuilder created, ready to work.")
	}).catch(roleArn => {
		//console.log(">>>ERR:",err)
		console.log("Retry create lambda...")
		setTimeout(()=>{createLambdaBuilderLambda(roleArn)}, 1000);
	});
}

//-----------------------------------------------------------------------------------

function getRoles(cb, roles, marker) {
	if (roles === undefined){
		roles = [];
	}
	var params = {
	  Marker: marker,
	  MaxItems: 100,
	  PathPrefix: '/'
	};
	iam.listRoles(params, function(err, data) {
		if (err) {
	  		console.log('>>>>>>>>>listRoles',err, err.stack); // an error occurred
	  		cb(err);
	  		return
		}

		roles = roles.concat(data.Roles);

	  	if (data.IsTruncated){
	  		getRoles(cb, roles, data.Marker);
	  	} else {
	  		cb(null, roles);
	  	}
	});
}

//-------------------------------------------------------------------------------------------------

function createLambdaBuilderRole(){
	return new Promise((resolve, reject)=>{
		getRoles((err, roles)=>{
			if (roles && roles.length > 0) {
				var hasRole = roles.reduce((a,o)=>{return o.RoleName === 'lambdaBuilder' ? o : a},undefined);
				if (hasRole){
					resolve(hasRole.Arn);
				} else {
					createRole("lambdaBuilder", "Build node_modules inside AWS Lambda, and deploy Lambda functions", {
						"Version": "2012-10-17",
						"Statement": [
							{
								"Action": [
									"s3:DeleteObject",
									"s3:GetObject",
									"s3:ListBucket",
									"s3:PutObject"
								],
								"Effect": "Allow",
								"Resource": [
									"arn:aws:s3:::*/*",
									`arn:aws:s3:::${config.lambdaS3Bucket}`
								]
							},
					/*    {
								"Sid": "Stmt1542396160033",
								"Action": [
									"lambda:CreateFunction",
									"lambda:ListFunctions",
									"lambda:DeleteFunction",
									"lambda:GetFunction",
									"lambda:PublishVersion",
									"lambda:UpdateFunctionCode",
									"lambda:UpdateFunctionConfiguration"
								],
								"Effect": "Allow",
								"Resource": `arn:aws:lambda:us-west-1:${accountId}:function:*`
							},
							*/
							{
								"Resource": "*",
								"Action": [
									"logs:*"
								],
								"Effect": "Allow"
							}
						]
					}).then(resolve).catch(reject);
				}
			}
		});
	});
}

//-------------------------------------------------------------------------------------------------

function createLambdaExecuteRole(){
	return new Promise((resolve, reject)=>{
		getRoles((err, roles)=>{
			if (roles && roles.length > 0) {
				var hasRole = roles.reduce((a,o)=>{return o.RoleName === 'LambdaExecute' ? o : a},undefined);
				if (hasRole){
					resolve(hasRole.Arn);
				} else {
					createRole("LambdaExecute", "Allows Lambda functions to call AWS services on your behalf.", {
						"Version": "2012-10-17",
						"Statement": [
								{
										"Effect": "Allow",
										"Action": [
												"s3:PutAccountPublicAccessBlock",
												"s3:GetAccountPublicAccessBlock",
												"s3:ListAllMyBuckets",
												"s3:HeadBucket"
										],
										"Resource": "*"
								},
								{
										"Effect": "Allow",
										"Action": "s3:*",
										"Resource": "arn:aws:s3:::*"
								},
								{
										"Effect": "Allow",
										"Action": "s3:*",
										"Resource": "arn:aws:s3:::*/*"
								}
						]
				}).then(resolve).catch(reject);
				}
			}
		});
	});
}

//-------------------------------------------------------------------------------------------------

function createRole(RoleName, Description, lambdaBuilderRolePolicy){
	return new Promise((resolve, reject)=>{
		/*
	getCurrentAccountId().catch(err=>{
		console.log(err);
		console.log("Problem using the default AWS profile. Exiting");
		process.exit();
	}).then(accountId=>{
	*/

		const lambdaBuilderPolicy = {
			"Version": "2012-10-17",
			"Statement": [
				{
					"Effect": "Allow",
					"Principal": {
						"Service": "lambda.amazonaws.com"
					},
					"Action": "sts:AssumeRole"
				}
			]
		}

		var params = {
			AssumeRolePolicyDocument: JSON.stringify(lambdaBuilderPolicy),
			Path: "/",
			RoleName: RoleName,
			Description: Description
		 };

		 iam.createRole(params, function(err, roleData) {
			if (err) {
					 console.log(err, err.stack); // an error occurred
					 return reject(err);
			}

			const policyDocument = JSON.stringify(lambdaBuilderRolePolicy,null,4);

			var policyParams = {
				PolicyDocument: policyDocument,
				PolicyName: RoleName,
				RoleName: RoleName
			}

			iam.putRolePolicy(policyParams, (err, rolePolicyData)=>{
				if (err){
					console.log(err)
					return reject()
				}
				resolve(roleData.Role.Arn)
			})
		});
		//	});

	});
};
