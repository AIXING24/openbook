// Read official analytics. CLI credentials stay in process memory and never in output.
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const execute=promisify(execFile);
let stdout;
try { ({stdout}=await execute('./node_modules/.bin/wrangler',['auth','token','--json','--config','wrangler.local.json'],{env:process.env,maxBuffer:100000})); }
catch {throw new Error('Official Wrangler authentication unavailable');}
let credentials;try {credentials=JSON.parse(stdout);}catch {throw new Error('Unexpected official credential response; withheld');}
if(!credentials.token)throw new Error('Bearer authentication required');
const config=JSON.parse(readFileSync(new URL('../wrangler.local.json',import.meta.url),'utf8'));
const headers={authorization:'Bearer '+credentials.token,'content-type':'application/json'};
const api=async (resource,body)=>{
 const response=await fetch('https://api.cloudflare.com/client/v4'+resource,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 return {status:response.status,data:await response.json()};
};
const end=new Date().toISOString(), start=JSON.parse(readFileSync(new URL('../cloud-recheck-v0.2.2.json',import.meta.url),'utf8')).startedAt;
const query=`query GetWorkersAnalytics($accountTag: string, $datetimeStart: string, $datetimeEnd: string, $scriptName: string) {
 viewer { accounts(filter:{accountTag:$accountTag}) { workersInvocationsAdaptive(limit:1000,filter:{scriptName:$scriptName,datetime_geq:$datetimeStart,datetime_leq:$datetimeEnd}) {
  sum { requests errors subrequests cpuTimeUs } max { cpuTime } quantiles { cpuTimeP50 cpuTimeP99 } dimensions { datetime scriptName status }
 } workersInvocationsScheduled(limit:100,filter:{scriptName:$scriptName,datetime_geq:$datetimeStart,datetime_leq:$datetimeEnd}) {
  cpuTimeUs cron datetime scheduledDatetime scriptName status
 } } } }`;
const analytics=await api('/graphql',{query,variables:{accountTag:config.account_id,datetimeStart:start,datetimeEnd:end,scriptName:config.name}});
const settings=await api('/accounts/'+config.account_id+'/workers/account-settings');
const database=await api('/accounts/'+config.account_id+'/d1/database/'+config.d1_databases[0].database_id);
const output={queriedAt:end,timeRange:{start,end},analytics,settings,database,units:'CPU microseconds, verified using official GraphQL schema; divide by 1000 for ms. Network elapsed is not CPU.'};
writeFileSync(new URL('../cloud-metrics-v0.2.2.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
const account=analytics.data.data?.viewer?.accounts?.[0];
const rows=account?.workersInvocationsAdaptive || [];
console.log(JSON.stringify({queriedAt:end,httpBuckets:rows.length,requests:rows.reduce((n,r)=>n+r.sum.requests,0),errors:rows.reduce((n,r)=>n+r.sum.errors,0),maxCpuMs:rows.length?Math.max(...rows.map(r=>r.max.cpuTime))/1000:null,scheduled:account?.workersInvocationsScheduled,analyticsErrors:analytics.data.errors,databaseBytes:database.data.result?.file_size}));
