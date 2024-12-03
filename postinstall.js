const cc = require('node-console-colors');

console.log(`
\n\n${cc.fg_yellow}
\tRun this command to set up lambda-builder:\n
\t\tlambda-builder --REGION=[your region] --BUCKET=[S3 bucket to store lambda build files]
${cc.reset}\n\n
`);

