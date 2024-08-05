#!/usr/bin/env node

const fs = require('fs');
const glob = require('glob');

const yargs = require('yargs');
const argv = yargs.argv;

const Promise = require('bluebird');

const path = require('path');
const chokidar = require('chokidar');

const atob = require('atob');

const basePath = path.resolve(process.cwd())
console.log("basePath:",basePath,'\n');

const Zip = require('node-zip');
const deepmerge = require('deepmerge');

const cc = require('node-console-colors');

const { buildLambda, makeZip } = require('./LambdaBuilder/lambdaBuilder/buildLambda.js');
//--------------------------------------------------------------------------------------------------------------
//Match the nodejs version running locally if no version is specified in the configs
var lambdaNodeVersions = [
	'nodejs', 'nodejs', 'nodejs', 'nodejs', // v0.x - v3.x
	'nodejs4.3', 'nodejs4.3', 	// v4.x - 5.x
	'nodejs6.10', 'nodejs6.10', // v6.x - 7.x
	'nodejs8.10', 'nodejs8.10',	// v8.x = 9.x
	'nodejs10.x', 'nodejs10.x',
	'nodejs12.x', 'nodejs12.x',
	'nodejs14.x', 'nodejs14.x',
	'nodejs16.x', 'nodejs16.x',
	'nodejs18.x', 'nodejs18.x',
	'nodejs20.x', 'nodejs20.x',
	
];

var nodever = process.version;
var majver = parseInt(nodever.split('.')[0].replace(/[^0-9]/g,''), 10);
var supportedNodeVer = lambdaNodeVersions[majver];


const lambdaBuilderDir = path.dirname(fs.realpathSync(__filename));

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

// var configFile = path.normalize(`${lambdaFolder}${path.sep}lambda-builder-config.json`);
// try{
// 	config = JSON.parse(fs.readFileSync(configFile), 'utf8');

// }catch(e){
// 	console.log("\nCould not read config file", configFile,", attempting to create a new one...");
// 	if (!argv.REGION) {
// 		console.log(" > Please use --REGION= to set AWS Lambda region\n");
// 	}
// 	if (!argv.BUCKET) {
// 		console.log(" > Please use --BUCKET= to set AWS S3 bucket that lambda build into. The your default AWS profile must have full access there.\n");
// 	}

// 	if (!argv.REGION || !argv.BUCKET) {
// 		process.exit();
// 	}
// 	config = {
// 		region			: argv.REGION,
// 		environment		: argv.ENVIRONMENT || '',
// 		lambdaS3Bucket	: argv.BUCKET
// 	}
// 	fs.writeFileSync(configFile, JSON.stringify(config, null, 4), 'utf8');
// 	console.log("\nCreated new config file",configFile);
// }

const config = {};
let stopRun = false;

if (argv.REGION) {
	config.region = argv.REGION;
} else {
	console.log(" > Please use --REGION= to set AWS Lambda region\n");
	stopRun = true;
}

if (argv.AWSPROFILE) {
	config.awsProfile = argv.AWSPROFILE;
} else {
	console.log(" > Please use --AWSPROFILE= to set AWS Lambda execution role for the 'LambdaBuilder' Lambda function.\n");
	stopRun = true;
}

if (argv.BUCKET) {
	config.lambdaS3Bucket = argv.BUCKET;
} else {
	console.log(" > Please use --BUCKET= to set AWS S3 bucket that lambda build into.Your 'LambdaBuilder' execution role must have read and write access there.\n");
	stopRun = true;
}

if (argv.ENV !== undefined && argv.ENVIRONMENT === undefined){
	argv.ENVIRONMENT = argv.ENV;
}
if (argv.ENVIRONMENT !== undefined && config.environment !== ''){
	config.environment = argv.ENVIRONMENT;
}
if ((config.environment === undefined || config.environment === '') && argv.DEPLOY === undefined){
	console.log("--ENV or --ENVIRONMENT is not set, quitting.");
	stopRun = true;
}

if (argv.DEPLOY !== undefined){
	config.environment = config.environment = '';
}

if (stopRun){
	process.exit();
}

// if (argv.REGION || argv.BUCKET || argv.ENVIRONMENT){
// 	fs.writeFileSync(configFile, JSON.stringify(config,null,4), 'utf8');
// }


global.lambdaS3Bucket = config.lambdaS3Bucket;

console.log("Lambda Builder Config:",JSON.stringify(config,null,4));

//-----------------------------------------------------------------------------------
//console.log("AWSPROFILE:",argv.AWSPROFILE)

const AWS = require('aws-sdk');
require('aws-sdk/lib/maintenance_mode_message').suppress = true; 
AWS.config.credentials = new AWS.SharedIniFileCredentials({profile: config.awsProfile || 'default'}); // {profile: config.profile}
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

function getLambdaName(filePath, noEnv, lambdaFolderOverride){
	if (filePath.toLowerCase().indexOf('lambdabuilder')!==-1){
		return 'lambdaBuilder'
	}

	var env = (config.environment && (noEnv != true)) ? config.environment + '_' : '';
	//var lambdaName = env+(path.normalize(filePath).split(lambdaFolderOverride || lambdaFolder)[1].replace(/^\\|\//,'').split(path.sep)[0]);;
	
	var lambdaName = env + (filePath.split(path.sep).reduce((a,o)=>{
    if (o.indexOf('.')===-1){return o}
    return a
	},''))

	//console.log("getLambdaName>>>>>>>>>>>>>>>", filePath, noEnv, lambdaFolderOverride, lambdaName)

	return lambdaName
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

function startWatching(){
	glob(`${lambdaFolder}/**/package.json`,{nodir:true, ignore:[`${lambdaFolder}/**/node_modules/**/*`]}, (err,files) => {

		var watchedFolders = files.map(o=>{
			var thisFile = path.normalize(o);
			var lambdaName = thisFile.split(lambdaFolder)[1].replace(/^\\|\//,'').split(path.sep)[0];
			//console.log(`Lambda: ${lambdaFolder}${path.sep}${lambdaName}`)
			return `${lambdaFolder}${path.sep}${lambdaName}`
		});

		watchedFolders = watchedFolders.filter((o,i)=>{
			return i === 0 || watchedFolders.indexOf(o) === i;//de-duplicate
		});

		console.log('\nwatchedFolders\n',watchedFolders.map(o=>` ${o}`).join('\n '));

		const watchFiles = chokidar.watch(watchedFolders, {
			ignored: [/node_modules/, /package.json/, /package-lock.json/],
			usePolling: false,
			depth: 99,
		})

		// console.log(cc.set('fg_yellow',"start watchers..."))

		watchFiles.on('ready', (evt, data)=>{
			console.log(cc.set('fg_green',"\nReady, Watching files."));
			watchFiles.on('add',	(file)=>{file=path.resolve(file);return updateFile(file,'add')});
			watchFiles.on('change', (file)=>{file=path.resolve(file);return updateFile(file,'change')});
			watchFiles.on('unlink', (file)=>{file=path.resolve(file);return updateFile(file,'unlink')});
			//watchFiles.on('all', (evt, file)=>{console.log('watchfile', evt, path.normalize(file))});
		});

		//-----------------------------------------------------------------------------------
		//	Watch package.json files for changes. If package.json changes then make ZIP of project files (without node_modules) and send
		//	to lambdaBuilder to install node_modules on AWS and then deploy to Lambda.
		var watchPackage = chokidar.watch(files, {
			ignored: /node_modules/,
			usePolling: false,
			depth: 99,
		})

		watchPackage.on('ready', (evt, data)=>{
			//console.log(cc.set('fg_green',"Watching package.json files"),watchedFolders,  evt, data)
			watchPackage.on('add',		(file)=>{file=path.resolve(file);return installModules(file,'add')});
			watchPackage.on('change',	(file)=>{file=path.resolve(file);return installModules(file,'change')});
			watchPackage.on('unlink',	(file)=>{file=path.resolve(file);return installModules(file,'unlink')});
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
	}, 1250);

	console.log("updateFile",file,action);

	var lambdaName = getLambdaName(file);

	console.log("------------------------------------------------------------------");
	console.log("Updating:",lambdaName)

	var zipFile = path.normalize(`${lambdaFolder}${path.sep}.build${path.sep}${lambdaName}.zip`);

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
		var filePath = file.split(path.sep).pop();
		console.log('filePath',filePath, action)
		if (action === 'unlink'){
			try{
				zip.remove(filePath);
			}catch(e){
				console.log("could not remove file:", file);
			}
		} else {
			try{
					var fileData = fs.readFileSync(file);
					zip.file(filePath, fileData)
			}catch(e){
				console.log("could not zip file:", file);
			}
		}
		
		var zipUpdate = zip.generate({base64:false, compression:'DEFLATE'});

		fs.writeFileSync(zipFile, zipUpdate, 'binary');
		let params = {
			Body:  new Buffer(zipUpdate, 'binary'),
			Bucket: config.lambdaS3Bucket,
			Key: `${lambdaName}.zip`,
			ContentType: 'application/zip'
		};

		s3.putObject(params, function(err, data) {
			if (err) {
				console.log(err, err.stack); // an error occurred
			}

			
			//var thisLambdaFolder = path.normalize(`${lambdaFolder}${path.sep}${getLambdaName(file, true)}`);
			var thisLambdaFolder = file.substr(0,file.lastIndexOf(path.sep))
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
						.catch((roleArn)=>{
							console.log("Retry create lambda...")
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
	console.log("------------------------------------------------------------------");

	var lambdaName = getLambdaName(file);
	var lambdaNameEnv = getLambdaName(file, true);

	console.log("Rebuilding:",lambdaName);

	var zip = new Zip();

	var zipFiles = [];
	var thisLambdaFolder = file.split(lambdaFolder)[1];
	console.log('thisLambdaFolder',thisLambdaFolder)
	thisLambdaFolder = thisLambdaFolder.substr(0,thisLambdaFolder.lastIndexOf(path.sep));

	var thisGlob = `${lambdaFolder}${path.sep}${thisLambdaFolder}${path.sep}**${path.sep}*`;
	var ignoreModules = `${lambdaFolder}${path.sep}${thisLambdaFolder}${path.sep}node_modules${path.sep}**${path.sep}*`;

	glob(thisGlob, {nodir:true, ignore:[ignoreModules]}, (err,files) => {

		files.forEach(o=>{
			if (o.indexOf('node_modules')!==-1){return}
			var filename = path.normalize(o).split(path.sep).pop();

			zipFiles.push(new Promise((resolve, reject)=>{
console.log(o)
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

				console.log("Lambda rebuild complete.")
				
				s3.getObject(JSON.parse(packagedZip), function(err, data) {
					if (err) {
						console.log('s3.getObject error:',err);
						return
					} else {
						fs.writeFileSync(path.normalize(`${lambdaFolder}${path.sep}.build${path.sep}${lambdaName}.zip`), data.Body, 'binary');
					}

					doesLambdaExist(lambdaName).then(()=>{
						var thisLambdaFolder = file.substr(0,file.lastIndexOf(path.sep))
						updateLambda(thisLambdaFolder);
					}).catch(err=>{
						var thisLambdaFolder = file.substr(0,file.lastIndexOf(path.sep))
						createLambda(thisLambdaFolder);
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
console.log("runLambdaBuilder", name)
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
			if (data.LogResult){
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
function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

//-----------------------------------------------------------------------------------
var does_lambda_exist = false;
function doesLambdaExist(lambdaName) {

	return new Promise(async (resolve, reject)=>{

		if (does_lambda_exist){
			while (does_lambda_exist){
				console.log("Waiting for doesLambdaExist to finish...");
				await sleep(1000);
			}
		}

		if (lambda_updating){
			console.log("Lambda is updating, waiting... doesLambdaExist");
			while (lambda_updating){
				console.log("Waiting for lambda to finish updating...");
				await sleep(1000);
			}
		}
		does_lambda_exist = true;
		var params = {
		  FunctionName: lambdaName,
		  //Qualifier: 'STRING_VALUE'
		};
		lambda.getFunctionConfiguration(params, function(err, data) {
			does_lambda_exist = false;
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
console.log('packageJsonFile',packageJsonFile)
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

console.log('>>>>>>>CREATELAMBDA>>>>>>>>>', thisLambdaFolder)//, "Y",createLambda.caller.toString())

		var lambdaName = getLambdaName(thisLambdaFolder);

		console.log("createLambda:",lambdaName, thisLambdaFolder);

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
// console.log("ROLE ARN:",roleArn)				
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
					console.log(err, err.stack, JSON.stringify(params,null,4))
					reject(params.Role);
					return
				}
				resolve()
			});
		}
		//--------------------------------------------------------------------

	});
}

//-----------------------------------------------------------------------------------
var lambda_updating = false;
var lambda_update_tmr = undefined;

async function updateLambda(thisLambdaFolder) {
	console.log("Lambda is updating, waiting...");
	if (lambda_updating){
		if (lambda_update_tmr){clearTimeout(lambda_update_tmr)}
		lambda_update_tmr = setTimeout(()=>{
			updateLambda(thisLambdaFolder)
		}, 1000);
		return
	}
	if (lambda_update_tmr){
		clearTimeout(lambda_update_tmr)
		lambda_update_tmr = undefined;
	}

	lambda_updating = true;
// console.log('>>>>>>>UPDATELAMBDA>>>>>>>>>', thisLambdaFolder)//, "Y",createLambda.caller.toString())
	var lambdaName = getLambdaName(thisLambdaFolder);

	//var packageConfig = getLambdaPackageConfig(thisLambdaFolder);

	var params = {
		FunctionName: lambdaName, /* required */
		DryRun: false,
		Publish:false,
		S3Bucket: config.lambdaS3Bucket,
		S3Key: `${lambdaName}.zip`
	};
	lambda.updateFunctionCode(params, async function(err, data) {
		lambda_updating = false;
		if (err) {
			if (err.statusCode === 409){
				await sleep(1000);
				updateLambda(thisLambdaFolder);
			} else {
				console.log(">>>>>>>>>>>>>>>>>>>lambda.updateFunctionCode", err)
			}
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
					Body:  new Buffer(installedLambda, 'base64'),
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
	  MaxItems: 100,
	  PathPrefix: '/'
	};
	if (marker){
		params.Marker = marker;
	}
	iam.listRoles(params, function(err, data) {
		if (err) {
	  		//console.log(err, err.stack); // an error occurred
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
				}).then(resolve).catch(e=>{
					console.log("createLambdaExecuteRole Error creating LambdaExecute role:",e)
					reject(e)
				});
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
