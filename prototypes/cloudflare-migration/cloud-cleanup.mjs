import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const config=JSON.parse(readFileSync('wrangler.local.json','utf8'));
if(config.triggers.crons.length)throw new Error('Local test Cron not cleared');
let auth;try{auth=await promisify(execFile)('./node_modules/.bin/wrangler',['auth','token','--json','--config','wrangler.local.json'],{env:process.env});}catch{throw new Error('Official credential unavailable');}
const {token}=JSON.parse(auth.stdout);
const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+config.account_id+'/workers/scripts/'+config.name+'/schedules',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
const data=await response.json();
const schedules=data.result?.schedules ?? data.result;
const cleared=response.ok && Array.isArray(schedules) && schedules.length===0;
const result={checkedAt:new Date().toISOString(),worker:config.name,status:response.status,remoteSchedules:schedules,temporaryCronRemoved:cleared,workerAndSyntheticDatabaseRetained:true,errors:data.errors};
writeFileSync('cloud-cleanup-results.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
if(!cleared)process.exitCode=1;
