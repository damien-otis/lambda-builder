const cc = require('node-console-colors');

/*
const fs = require('fs');
const path = require('path');

const packageFile = `${process.cwd()}${path.sep}package.json`;
console.log("packageFile",packageFile);

var packageEdit = JSON.parse(fs.readFileSync(packageFile, 'utf8'));

packageEdit.globalInstalledPath = process.cwd();

fs.writeFileSync(packageFile, JSON.stringify(packageEdit,null,4),'utf8');

const postInstallBuilder = require('./index.js');

*/
console.log(`
\n\n${cc.fg_yellow}
\tRun this command to set up lambda-builder:\n
\t\tlambda-builder --REGION=[your region] --BUCKET=[S3 bucket to store lambda build files]
${cc.reset}\n\n
`);

