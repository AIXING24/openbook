import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const config=JSON.parse(readFileSync(new URL('../wrangler.local.json',import.meta.url),'utf8'));
const file=new URL('../cloud-mock-calendar-v0.3.4.json',import.meta.url);
const report=JSON.parse(readFileSync(file,'utf8'));
assert.equal(report.confirmed,true);assert.equal(report.temporaryCronRemoved,true);
let credentials;
try{credentials=await promisify(execFile)('./node_modules/.bin/wrangler',['auth','token','--json','--config','wrangler.local.json'],{env:process.env});}catch{throw Error('Official authorization unavailable; output withheld');}
const {token}=JSON.parse(credentials.stdout);
const query=`query($accountTag:string,$start:string,$end:string,$scriptName:string){viewer{accounts(filter:{accountTag:$accountTag}){workersInvocationsScheduled(limit:100,filter:{scriptName:$scriptName,datetime_geq:$start,datetime_leq:$end}){cpuTimeUs cron datetime scheduledDatetime scriptName status}}}}`;
const finalMinute=Math.floor(Math.max(...report.points.map(point=>Date.parse(point.generatedAt)))/60000)*60000;
for(let attempt=0;attempt<4;attempt++){
  const response=await fetch('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({query,variables:{accountTag:config.account_id,start:report.startedAt,end:report.cleanupAt,scriptName:config.name}}),signal:AbortSignal.timeout(30000)});
  const data=await response.json();assert.equal(response.status,200);assert.ok(!data.errors,'Official scheduled analytics unavailable');
  const samples=data.data.viewer.accounts[0].workersInvocationsScheduled;
  const coversFinalConfirmationMinute=samples.some(sample=>Date.parse(sample.datetime)>=finalMinute);
  report.cpu={queriedAt:new Date().toISOString(),timeRange:{start:report.startedAt,end:report.cleanupAt},units:'Official scheduled invocation cpuTimeUs, microseconds',samples,maxObservedMs:samples.length?Math.max(...samples.map(sample=>sample.cpuTimeUs))/1000:null,allObservedWithin10ms:samples.length>0&&samples.every(sample=>sample.cpuTimeUs<10000),allObservedSuccessful:samples.length>0&&samples.every(sample=>sample.status==='success'),coversFinalConfirmationMinute,freeCpuHeadroomProven:false,limitations:'Only returned scheduled samples in this fixed small mock-ledger window. Final confirmation minute is represented; missing samples, larger ledgers and universal cold-start headroom are not proven.'};
  writeFileSync(file,JSON.stringify(report,null,2)+'\n');
  if(coversFinalConfirmationMinute)break;
  if(attempt<3)await new Promise(resolve=>setTimeout(resolve,60000));
}
console.log(JSON.stringify({...report.cpu,samples:undefined,sampleCount:report.cpu.samples.length},null,2));
