/*
	This lambda is for installing node modules within an AWS Lambda environment.

	Accepts a form POST with a .ZIP file encoded as base64 in the body, and a 'name' querystring parameter.

	Unzips the .ZIP file to a temp folder, runs npm install, and then Zips the results into a file.

	Returns a .ZIP file encoded as base64 data in the response body.

*/
const { buildLambda } = require('buildLambda');

exports.handler = (event, context, callback) => {
	buildLambda(event.data, event.name, (err, zipData)=>{
		if (err){
			console.log(err);
			callback(err)
			return;
		}
		callback(null, zipData);
	});
}
