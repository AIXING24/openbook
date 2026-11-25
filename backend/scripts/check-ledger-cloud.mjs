import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
const config=JSON.parse(readFileSync(new URL('../wrangler.local.json',import.meta.url),'utf8'));
const secrets=JSON.parse(readFileSync(new URL('../.validation-secrets.json',import.meta.url),'utf8'));
let credentials;
try{credentials=await promisify(execFile)('./node_modules/.bin/wrangler',['auth','token','--json','--config','wrangler.local.json'],{env:process.env});}catch{throw Error('Official authorization unavailable; output withheld');}
const {token}=JSON.parse(credentials.stdout),origin='https://gaintrace-batch-api.pages.dev';
const report={version:'client v0.2.0 / backend v0.3.3',startedAt:new Date().toISOString(),origin,checks:[],realAuthenticatedLedgerFlowProven:false,cpuVerified:false};
const record=(name,details={})=>report.checks.push({name,...details});
async function official(path,body){
  const response=await fetch('https://api.cloudflare.com/client/v4'+path,{headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const result=await response.json();assert.equal(response.status,200,'Official API status');assert.equal(result.success,true,'Official API success');return result.result;
}
async function request(path,status,options={},endpoint=origin){const response=await fetch(endpoint+path,{redirect:'manual',...options,signal:AbortSignal.timeout(20000)});assert.equal(response.status,status,path);return response;}
const project=await official('/accounts/'+config.account_id+'/pages/projects/gaintrace-batch-api');
assert.equal(project.production_branch,'dev/gaintrace-backend');assert.equal(project.deployment_configs.production.d1_databases.DB.id,config.d1_databases[0].database_id);
for(const name of ['TEST_ADMIN_TOKEN','TEST_ALICE_TOKEN','TEST_BOB_TOKEN','AUTH_ALLOWED_EMAILS'])assert.equal(project.deployment_configs.production.env_vars[name].type,'secret_text');
assert.equal(project.deployment_configs.production.env_vars.AUTH_MODE.value,'kinde-test-only');assert.equal(project.deployment_configs.production.env_vars.AUTH_API_ORIGIN.value,origin);
report.deployment={id:project.canonical_deployment.id,url:project.canonical_deployment.url,commit:project.canonical_deployment.deployment_trigger.metadata.commit_hash,createdAt:project.canonical_deployment.created_on};
record('Existing isolated project, private allowlist and D1 binding preserved');
const html=await (await request('/auth/test',200)).text();assert.match(html,/GainTrace 云账本验证/);assert.match(html,/client v0.2.0/);assert.match(html,/\/auth\/ledger-client.mjs/);
const moduleResponse=await request('/auth/ledger-client.mjs',200);assert.match(moduleResponse.headers.get('content-type'),/(javascript|ecmascript)/);assert.equal(moduleResponse.headers.get('cache-control'),'no-store');
const moduleText=await moduleResponse.text();assert.ok(moduleText.length>10000);assert.ok(!moduleText.includes('preview.example.test'));assert.ok(!moduleText.includes('local-ui-preview-owner'));
record('Canonical page and final client module available; local preview absent');
for(const path of ['/api/ledger/meta','/api/ledger/trades','/api/ledger/history']){
  const denied=await request(path,401);assert.equal(denied.headers.get('cache-control'),'no-store');
  for(const value of [secrets.TEST_ALICE_TOKEN,secrets.TEST_BOB_TOKEN,randomBytes(32).toString('base64url')])await request(path,401,{headers:{authorization:'Bearer '+value}});
}
await request('/api/ledger/operation',401,{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'});
await request('/api/ledger/validation/seed',404,{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'});
record('Anonymous, fake sessions, legacy mock credentials and admin route access denied');
for(const path of ['/auth/test','/auth/ledger-client.mjs','/api/ledger/meta'])await request(path,403,{},report.deployment.url);
record('Deployment aliases cannot receive authentication or ledger traffic');
for(const role of ['ALICE','BOB']){
  const response=await request('/trades?after=-1',200,{headers:{authorization:'Bearer '+secrets['TEST_'+role+'_TOKEN']}});const data=await response.json();assert.ok(data.trades.length>0&&data.trades.length<=20);
}
record('Original two mock ledgers remain accessible with original credentials');
const schedules=await official('/accounts/'+config.account_id+'/workers/scripts/'+config.name+'/schedules');assert.deepEqual(schedules.schedules??schedules,[]);record('Temporary scheduled tasks remain disabled');
const counts=await official('/accounts/'+config.account_id+'/d1/database/'+config.d1_databases[0].database_id+'/query',{sql:"SELECT (SELECT count(*) FROM gt_auth_users) users,(SELECT count(*) FROM gt_auth_identities) identities,(SELECT count(*) FROM gt_auth_sessions WHERE expires_at>?) active_sessions,(SELECT count(*) FROM gt_accounts WHERE id LIKE 'email:%' AND generation IS NOT NULL) email_ledgers,(SELECT count(*) FROM gt_trades WHERE account LIKE 'email:%') email_ledger_trades",params:[Date.now()]});
report.counts=counts[0].results[0];report.completedAt=new Date().toISOString();
writeFileSync(new URL('../ledger-cloud-basics-v0.2.0.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
