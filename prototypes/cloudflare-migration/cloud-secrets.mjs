import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
const secrets=readFileSync(new URL('./.validation-secrets.json',import.meta.url),'utf8');
const child=spawn('./node_modules/.bin/wrangler',['secret','bulk','--config','wrangler.local.json'],{cwd:new URL('.',import.meta.url),env:process.env,stdio:['pipe','inherit','inherit']});
child.stdin.end(secrets);
child.on('exit',code=>process.exit(code??1));
