import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const config=JSON.parse(readFileSync(new URL('../wrangler.local.json',import.meta.url),'utf8'));
const basics=JSON.parse(readFileSync(new URL('../ledger-cloud-basics-v0.2.0.json',import.meta.url),'utf8'));
let credentials;
try{credentials=await promisify(execFile)('./node_modules/.bin/wrangler',['auth','token','--json','--config','wrangler.local.json'],{env:process.env});}catch{throw Error('Official authorization unavailable; output withheld');}
const {token}=JSON.parse(credentials.stdout),checkedAt=new Date().toISOString();
async function official(path,body){
  const response=await fetch('https://api.cloudflare.com/client/v4'+path,{headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const result=await response.json();assert.equal(response.status,200,'Official API status');assert.equal(result.success,true,'Official API success');return result.result;
}
const project=await official('/accounts/'+config.account_id+'/pages/projects/gaintrace-batch-api');
assert.equal(project.canonical_deployment.id,basics.deployment.id,'Runtime deployment changed');
const sql=`SELECT
 (SELECT count(*) FROM gt_accounts WHERE id LIKE 'email:%' AND generation IS NOT NULL) email_ledgers,
 (SELECT count(*) FROM gt_accounts a WHERE a.id LIKE 'email:%' AND a.generation IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gt_auth_users u WHERE a.id='email:'||u.id)) orphan_ledgers,
 (SELECT count(*) FROM gt_trades t JOIN gt_accounts a ON a.id=t.account AND a.generation=t.generation WHERE a.id LIKE 'email:%') active_mock_trades,
 (SELECT count(*) FROM gt_trades t JOIN gt_accounts a ON a.id=t.account AND a.generation=t.generation WHERE a.id LIKE 'email:%' AND (t.tc NOT IN ('us100001','us100002') OR json_extract(t.payload,'$.broker') IS NOT 'Mock HSBC')) non_mock_trades,
 (SELECT count(*) FROM gt_operations WHERE account LIKE 'email:%') committed_operations,
 (SELECT min(revision) FROM gt_accounts WHERE id LIKE 'email:%' AND generation IS NOT NULL) minimum_revision,
 (SELECT count(*) FROM gt_auth_sessions WHERE expires_at>?) active_sessions`;
const rows=await official('/accounts/'+config.account_id+'/d1/database/'+config.d1_databases[0].database_id+'/query',{sql,params:[Date.now()]});
const counts=rows[0].results[0];
assert.equal(counts.email_ledgers,1);assert.equal(counts.orphan_ledgers,0);assert.equal(counts.non_mock_trades,0);
assert.ok(counts.active_mock_trades>=5);assert.ok(counts.committed_operations>=1);assert.ok(counts.minimum_revision>=2);
const end=new Date().toISOString(),scriptName='pages-worker--24757550-production';
const query=`query($accountTag:string,$start:string,$end:string){__type(name:"AccountPagesFunctionsInvocationsAdaptiveGroupsQuantiles"){fields{name description}}viewer{accounts(filter:{accountTag:$accountTag}){pagesFunctionsInvocationsAdaptiveGroups(limit:1000,filter:{datetime_geq:$start,datetime_leq:$end,scriptName:"${scriptName}"}){dimensions{datetimeMinute scriptName status}sum{requests errors}quantiles{cpuTimeP50 cpuTimeP99 cpuTimeP999}}}}}`;
const response=await fetch('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({query,variables:{accountTag:config.account_id,start:basics.startedAt,end}}),signal:AbortSignal.timeout(30000)});
const data=await response.json();assert.equal(response.status,200);assert.ok(!data.errors,'Official analytics unavailable');
const units=data.data.__type.fields.find(field=>field.name==='cpuTimeP99').description;assert.match(units,/microseconds/);
const buckets=data.data.viewer.accounts[0].pagesFunctionsInvocationsAdaptiveGroups;
const report={version:'client v0.2.0 / backend v0.3.3',checkedAt,deployment:basics.deployment,userConfirmedLoginImportAndSave:true,realAuthenticatedLedgerFlowProven:true,logoutVerified:false,counts,cpu:{timeRange:{start:basics.startedAt,end},scriptName,units,rows:buckets,requests:buckets.reduce((total,row)=>total+row.sum.requests,0),runtimeErrors:buckets.reduce((total,row)=>total+row.sum.errors,0),highestBucketP99Ms:buckets.length?Math.max(...buckets.map(row=>row.quantiles.cpuTimeP99))/1000:null,currentObservedBucketsWithin10ms:buckets.length>0&&buckets.every(row=>row.quantiles.cpuTimeP99<10000),freeCpuHeadroomProven:false,limitations:'Current deployment only. Adaptive minute-bucket quantiles include background probes and do not identify individual request paths or exact maxima. This reused user is not a new-user or universal cold-start proof.'}};
writeFileSync(new URL('../ledger-cloud-flow-v0.2.0.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,cpu:{...report.cpu,rows:undefined}},null,2));
