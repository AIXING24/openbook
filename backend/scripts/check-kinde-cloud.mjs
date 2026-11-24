// Isolated cloud authentication acceptance; never prints identities or credentials.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
const config=JSON.parse(readFileSync(new URL('../wrangler.local.json',import.meta.url),'utf8'));
const secrets=JSON.parse(readFileSync(new URL('../.validation-secrets.json',import.meta.url),'utf8'));
let auth;try{auth=await promisify(execFile)('./node_modules/.bin/wrangler',['auth','token','--json','--config','wrangler.local.json'],{env:process.env});}catch{throw Error('Official CLI authorization unavailable; output withheld');}
const {token}=JSON.parse(auth.stdout),origin='https://gaintrace-batch-api.pages.dev';
const report={version:'auth v0.1.4',startedAt:new Date().toISOString(),origin,checks:[],liveOtpCompleted:false,phoneLoginProven:false,cpuVerified:false};
const record=(name,details={})=>report.checks.push({name,...details});
async function api(path,body){const r=await fetch('https://api.cloudflare.com/client/v4'+path,{headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const j=await r.json();assert.equal(r.status,200,'Official API status');assert.equal(j.success,true,'Official API success');return j.result;}
async function request(path,status,options={},endpoint=origin){const r=await fetch(endpoint+path,{redirect:'manual',...options,signal:AbortSignal.timeout(30000)});assert.equal(r.status,status,path);return r;}
const project=await api('/accounts/'+config.account_id+'/pages/projects/gaintrace-batch-api');
const production=project.deployment_configs.production;
assert.equal(project.production_branch,'dev/gaintrace-backend');assert.equal(production.d1_databases.DB.id,config.d1_databases[0].database_id);
for(const name of ['TEST_ADMIN_TOKEN','TEST_ALICE_TOKEN','TEST_BOB_TOKEN','AUTH_ALLOWED_EMAILS'])assert.equal(production.env_vars[name].type,'secret_text');
assert.equal(production.env_vars.AUTH_MODE.value,'kinde-test-only');assert.equal(production.env_vars.AUTH_API_ORIGIN.value,origin);
report.deployment={id:project.canonical_deployment.id,url:project.canonical_deployment.url,commit:project.canonical_deployment.deployment_trigger.metadata.commit_hash};
record('Official isolated configuration',{existingSecretsPreserved:true,allowlistPrivate:true,d1BindingUnchanged:true});
assert.match(await (await request('/',200)).text(),/GainTrace 访问正常/);
assert.match(await (await request('/auth/test',200)).text(),/GainTrace 邮箱登录验证/);
for(const path of ['/auth/email-session.mjs','/auth/test-client.mjs']){const r=await request(path,200);assert.match(r.headers.get('content-type'),/(javascript|ecmascript)/);assert.ok((await r.text()).length>500);}
record('Connection page, login page and module assets',{status:200});
await request('/api/session/me',401);await request('/state',401);await request('/validation/status',401);
await request('/api/session/me',401,{headers:{authorization:'Bearer '+secrets.TEST_ALICE_TOKEN}});
await request('/state',401,{headers:{authorization:'Bearer '+randomBytes(32).toString('base64url')}});
for(const role of ['ALICE','BOB']){const r=await request('/state',200,{headers:{authorization:'Bearer '+secrets['TEST_'+role+'_TOKEN']}});assert.ok((await r.json()).state.trades.length>0);}
record('Anonymous denial and mock/session credential separation',{unauthorizedStatus:401,existingMockAccountsAccessible:true});
await request('/auth/test',403,{},report.deployment.url);await request('/api/session/me',403,{},report.deployment.url);
record('Deployment alias rejects authentication',{status:403});
await request('/auth/complete',400);
const denied=await request('/auth/kinde/callback?state=invalid&code=invalid',303);
assert.equal(denied.headers.get('location'),origin+'/auth/test#gt_error=login-rejected');
assert.match(denied.headers.get('set-cookie'),/Max-Age=0/);
await request('/api/session/exchange',403,{method:'POST',headers:{origin:'https://example.com','content-type':'application/json'},body:'{}'});
await request('/api/session/exchange',400,{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'});
const fake={code:randomBytes(32).toString('base64url'),state:randomBytes(32).toString('base64url'),verifier:randomBytes(32).toString('base64url')};
await request('/api/session/exchange',401,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(fake)});
record('Invalid callback, foreign Origin and fake exchanges rejected');
const state=randomBytes(32).toString('base64url'),challenge=randomBytes(32).toString('base64url');
const started=await request('/auth/complete?'+new URLSearchParams({state,challenge}),303);
const location=new URL(started.headers.get('location'));
assert.equal(location.origin,'https://gaintrace.kinde.com');assert.equal(location.pathname,'/oauth2/auth');assert.equal(location.searchParams.get('redirect_uri'),origin+'/auth/kinde/callback');assert.equal(location.searchParams.get('code_challenge_method'),'S256');
const cookie=started.headers.get('set-cookie');assert.match(cookie,/^__Host-gaintrace-kinde=/);for(const flag of ['Secure','HttpOnly','SameSite=Lax','Path=/','Max-Age=600'])assert.ok(cookie.includes(flag));
// Remove only the synthetic transaction created by this acceptance probe.
const deleted=await api('/accounts/'+config.account_id+'/d1/database/'+config.d1_databases[0].database_id+'/query',{sql:'DELETE FROM gt_kinde_logins WHERE oauth_state=? AND client_state=?',params:[location.searchParams.get('state'),state]});
assert.equal(deleted[0].meta.changes,1);
record('Cloud S256 redirect and secure browser binding',{syntheticTransactionRemoved:true});
const schedules=await api('/accounts/'+config.account_id+'/workers/scripts/'+config.name+'/schedules');assert.deepEqual(schedules.schedules??schedules,[]);
record('Temporary Cron remains disabled',{schedules:[]});
const counts=await api('/accounts/'+config.account_id+'/d1/database/'+config.d1_databases[0].database_id+'/query',{sql:'SELECT (SELECT count(*) FROM gt_auth_users) users,(SELECT count(*) FROM gt_auth_identities) identities,(SELECT count(*) FROM gt_auth_sessions WHERE expires_at>?) active_sessions',params:[Date.now()]});
report.identityCounts=counts[0].results[0];report.completedAt=new Date().toISOString();
writeFileSync(new URL('../kinde-cloud-verification-v0.1.4.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
