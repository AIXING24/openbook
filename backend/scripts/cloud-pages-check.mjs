// Read-only acceptance of the alternative hostname; never edits the synthetic ledger.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {configureValidationDns} from '../../prototypes/cloudflare-migration/cloud-transport.mjs';
const endpoint='https://gaintrace-batch-api.pages.dev';
const secrets=JSON.parse(readFileSync(new URL('../.validation-secrets.json',import.meta.url),'utf8'));
const config=JSON.parse(readFileSync(new URL('../wrangler.local.json',import.meta.url),'utf8'));
const report={version:'backend v0.3.2',startedAt:new Date().toISOString(),endpoint,readOnly:true,checks:[],phoneAccessProven:false};
const record=(name,details={})=>report.checks.push({name,...details});
const request=async(path,role,expected=200)=>{
  const r=await fetch(endpoint+path,{headers:role?{authorization:'Bearer '+secrets['TEST_'+role+'_TOKEN']}:{},signal:AbortSignal.timeout(30000)});
  assert.equal(r.status,expected,path);return r;
};
const root=await request('/');assert.match(await root.text(),/GainTrace 访问正常/);
record('Public connection page',{status:200,dns:'system-dns'});
await request('/state',null,401);await request('/validation/status',null,401);await request('/validation/status','ALICE',401);
record('Account and admin authorization enforced',{unauthorizedStatus:401});
const status=await (await request('/validation/status','ADMIN')).json();assert.equal(status.version,report.version);
record('Deployed backend version',{version:status.version});
const states={};
for(const role of ['ALICE','BOB']){
  const state=states[role]=await (await request('/state',role)).json();
  const trades=[];let after=-1;
  for(let n=0;n<100;n++){
    const page=await (await request('/trades?after='+after,role)).json();assert.equal(page.revision,state.revision);
    assert.ok(page.trades.length<=20);if(!page.trades.length)break;
    assert.ok(page.next>after);trades.push(...page.trades);after=page.next;
    if(n===99)throw Error('Pagination did not finish');
  }
  assert.deepEqual(trades,state.state.trades);
  record('Ledger pagination '+role,{revision:state.revision,trades:trades.length,history:state.confirmedHistory.length});
}
assert.notDeepEqual(states.ALICE.state.trades,states.BOB.state.trades);
record('Distinct synthetic accounts');
const worker='https://gaintrace-batch-validation.aixing24-gaintrace.workers.dev';
const previousDnsFlag=process.env.GAINTRACE_USE_DOH;process.env.GAINTRACE_USE_DOH='1';
const dns=await configureValidationDns(new URL(worker).hostname);
if(previousDnsFlag===undefined)delete process.env.GAINTRACE_USE_DOH;else process.env.GAINTRACE_USE_DOH=previousDnsFlag;
for(const role of ['ALICE','BOB']){
  const r=await fetch(worker+'/state',{headers:{authorization:'Bearer '+secrets['TEST_'+role+'_TOKEN']},signal:AbortSignal.timeout(30000)});
  assert.equal(r.status,200);assert.deepEqual(await r.json(),states[role]);
}
record('Pages and Worker share identical synthetic D1 state',{workerDns:dns.mode});
let auth;try{auth=await promisify(execFile)('./node_modules/.bin/wrangler',['auth','token','--json','--config','wrangler.local.json'],{env:process.env});}catch{throw Error('Official credential unavailable');}
const {token}=JSON.parse(auth.stdout);
const api=async(path)=>{
  const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+config.account_id+path,{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
  const data=await r.json();assert.equal(r.status,200);assert.equal(data.success,true);return data.result;
};
const project=await api('/pages/projects/gaintrace-batch-api');
assert.equal(project.subdomain,'gaintrace-batch-api.pages.dev');assert.equal(project.production_branch,'dev/gaintrace-backend');
const production=project.deployment_configs.production;
assert.equal(production.d1_databases.DB.id,config.d1_databases[0].database_id);
assert.equal(production.env_vars.VALIDATION_MODE.value,'mock-only');
for(const name of Object.keys(secrets))assert.equal(production.env_vars[name].type,'secret_text');
record('Official Pages production configuration',{subdomain:project.subdomain,productionBranch:project.production_branch,deploymentId:project.canonical_deployment.id,deploymentUrl:project.canonical_deployment.url,d1Binding:'DB',mode:'mock-only',secretCount:Object.keys(secrets).length});
const scheduleResult=await api('/workers/scripts/'+config.name+'/schedules');
const schedules=scheduleResult.schedules??scheduleResult;assert.deepEqual(schedules,[]);
record('Temporary Cron remains disabled',{schedules});
report.completedAt=new Date().toISOString();
writeFileSync('cloud-pages-verification-v0.3.2.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
