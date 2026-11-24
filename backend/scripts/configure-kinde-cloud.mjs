import {readFileSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
// Configure only the authorized mock Pages project. Secrets never enter output.
const config=JSON.parse(readFileSync('wrangler.local.json','utf8'));
const candidate=JSON.parse(readFileSync('wrangler.kinde.local.json','utf8'));
let auth;try{auth=await promisify(execFile)('./node_modules/.bin/wrangler',['auth','token','--json','--config','wrangler.local.json'],{env:process.env});}catch{throw Error('Official CLI authorization unavailable; output withheld');}
const {token}=JSON.parse(auth.stdout);
const endpoint='https://api.cloudflare.com/client/v4/accounts/'+config.account_id+'/pages/projects/gaintrace-batch-api';
async function call(method,body){const r=await fetch(endpoint,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const j=await r.json();if(!r.ok||!j.success)throw Error('Pages configuration request failed: '+r.status);return j.result;}
const current=await call('GET');
if(current.production_branch!=='dev/gaintrace-backend')throw Error('Unexpected production branch');
const envVars={...current.deployment_configs.production.env_vars};
const originalSecrets=JSON.parse(readFileSync('.validation-secrets.json','utf8'));
// API reads redact secret values; restore the known local values, never PATCH redactions.
for(const name of ['TEST_ADMIN_TOKEN','TEST_ALICE_TOKEN','TEST_BOB_TOKEN']){
  const value=originalSecrets[name];if(typeof value!=='string'||value.length<32)throw Error('Original local test credential missing');
  envVars[name]={type:'secret_text',value};
}
for(const [name,value] of Object.entries(candidate.vars))envVars[name]={type:'plain_text',value};
let emails;try{emails=JSON.parse(process.env.AUTH_ALLOWED_EMAILS);}catch{throw Error('Private AUTH_ALLOWED_EMAILS JSON array required');}
if(!Array.isArray(emails)||!emails.length||emails.length>50||emails.some(e=>typeof e!=='string'||e.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))throw Error('Invalid private email allowlist');
envVars.AUTH_ALLOWED_EMAILS={type:'secret_text',value:JSON.stringify(emails)};
for(const name of ['TEST_ADMIN_TOKEN','TEST_ALICE_TOKEN','TEST_BOB_TOKEN'])if(envVars[name]?.type!=='secret_text')throw Error('Existing secret missing');
await call('PATCH',{deployment_configs:{production:{env_vars:envVars}}});
const verified=await call('GET');
for(const [name,value] of Object.entries(candidate.vars))if(verified.deployment_configs.production.env_vars[name]?.value!==value)throw Error('Configuration mismatch');
if(verified.deployment_configs.production.env_vars.AUTH_ALLOWED_EMAILS?.type!=='secret_text')throw Error('Allowlist not private');
if(verified.deployment_configs.production.d1_databases.DB.id!==config.d1_databases[0].database_id)throw Error('DB binding changed');
console.log(JSON.stringify({configured:true,mode:candidate.vars.AUTH_MODE,allowlistSecret:true,existingSecretsPreserved:true,d1BindingUnchanged:true}));
