const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execSync  } = require('child_process');

const Promise = require('bluebird');
const Duplex = require('stream').Duplex;
const Zip = require('node-zip');
const unzip = require('unzipper');
const glob = require('glob');
const rimraf = require('rimraf');

const yargs = require('yargs');
const argv = yargs.argv;

const tmp_folder = os.tmpdir ? os.tmpdir() : os.tmpDir();
const isLambda = (process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined);

const packageJSON = require('./package.json');


const AWS = require('aws-sdk');
if (!isLambda){
	AWS.config.credentials = new AWS.SharedIniFileCredentials({profile: argv.AWSPROFILE || 'default'}); // {profile: config.profile}
}
const s3 = new AWS.S3();

// --------------------------------------------------------------------------------------------------------
module.exports = {
	buildLambda,
	makeZip
};

function buildLambda(zipData, name, callback){
	var data = Buffer.from(zipData, 'base64');
	var stream = bufferToStream(data);

	var lambdaFolder = `${tmp_folder}${path.sep}${name}`;

	console.log("lambdaFolder:",lambdaFolder);

	rimraf(`${lambdaFolder}`, {}, ()=>{

		startProcess(`mkdir ${lambdaFolder}`, ()=>{

			console.log("Extracting...");

			stream.pipe(unzip.Extract({path: lambdaFolder}).on('close',function(){

//exec('ls -lAF', (e,x)=>{console.log("Extracted files...",e||x)}, {cwd:lambdaFolder, env: process.env})

				console.log("Installing...");

				process.env.HOME = lambdaFolder;
				process.env.NPM_CONFIG_CACHE = '/tmp/.npm';
			
				startProcess(`npm install`, (result)=>{ // --no-progress

//exec('ls -lAF '+path.join(lambdaFolder , 'node_modules'), (e,x)=>{console.log("installed files...",e||x)}, {cwd:path.join(lambdaFolder , 'node_modules'), env: process.env})

					console.log("Zipping...");

					makeZip(lambdaFolder, (packagedZip) => {
console.log("zip done")						
console.log("isLambda?", isLambda);

						if (isLambda) {
							let params = {
								Body:  Buffer.from(packagedZip,'base64'),
								Bucket: packageJSON.lambdaS3Bucket,
								Key: `${name}.zip`,
								ContentType: 'application/zip'
							};
							console.log("buildLambda PARAMS",params);
							s3.putObject(params, function(err, data) {
								if (err) {
									console.log(err, err.stack); // an error occurred
								} else {
									console.log(`\n\nSaved to S3: ${packageJSON.lambdaS3Bucket}/${name}.zip`);           // successful response
								}

								rimraf(`${lambdaFolder}`, {}, ()=>{
									callback(null, {Bucket: packageJSON.lambdaS3Bucket, Key:`${name}.zip`});
								});
							});
						} else {
							callback(null, packagedZip);
						}
					});
				},{
					cwd: lambdaFolder,
					env: process.env,
					maxBuffer: 1024 * 1024
				});
			}));
		},{
			cwd: tmp_folder
		});
	});

}

// --------------------------------------------------------------------------------------------------------

function makeZip(folder, callback, ignore){

	folder = folder.replace(/\\/ig,'/');

	var zip = new Zip();

	var globpath = (`${folder}/**/*`);
	var options = {};
	if (ignore) {
		options.ignore = ignore;
	}
	console.log("makeZip globpath", globpath)
	glob(globpath, options, async (err,files)=>{
console.log("glob files", files)
		if (err){
			return callback(err);
		}

		if (files.length === 0){
			console.log("No files to zip?")
			return callback();
		}

		await Promise.map(files, o => {
			console.log("zip file" , o)
			return new Promise((resolve, reject)=>{
				var filename = o.split(`${folder}/`)[1];

				fs.stat(o, (err, stats)=>{
					if (err){
						return resolve();
					}

					if (stats.isFile()){
							fs.readFile(o, 'utf8', (err, data)=>{
								if (err){
									console.log("error reading file:",o, err);
									return
								}
								if (folder.indexOf('/lambdaBuilder')!==-1 && filename ==='package.json'){
									var modifyPackage = JSON.parse(data);
									modifyPackage.lambdaS3Bucket = packageJSON.lambdaS3Bucket || global.lambdaS3Bucket;
									data = JSON.stringify(modifyPackage,null,4);
								}
								zip.file(filename, data);
								resolve();
							});
					} else {
						resolve();
					}
				})
			});
		},{
			concurrency: 10
		}).then(()=>{
			var data = zip.generate({base64:true, compression:'DEFLATE'});
			if (callback) {
				callback(data)
			}
		}).catch(e=>{
			if (callback) {
				callback(e)
			}
		})

	});
}

// --------------------------------------------------------------------------------------------------------

function bufferToStream(buffer) {
  let stream = new Duplex();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

// --------------------------------------------------------------------------------------------------------

function startProcess(command, callback, options){
	
	var currentProc = exec(command, options);

	currentProc.stdout.on('data', (data) => {
		console.log('\n',data.replace(/[\r\n]/g,''))
	});

	currentProc.stderr.on('data', (data) => {
		console.log(`\nCommand:${command}\n  Err:${data}`);
	});

	currentProc.on('data', (data) => {
		console.log('\n',data.replace(/[\r\n]/g,''))
	});
	currentProc.on('error', (error) => {
		console.log("process error", error);
	})

	currentProc.on('close', (err, data) => {
//		console.log(data);
		if (err){
			console.log("exec close error", err);
		}
		console.log("\n",command,"PROCESS CLOSED")
		if (callback) {callback(data)};
	});
}
