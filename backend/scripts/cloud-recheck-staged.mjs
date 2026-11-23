// v0.3.0 specialized recheck. Keeps existing active mock ledgers and prior evidence.
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {fixture,old} from '../../prototypes/cloudflare-migration/runtime.mjs';
import {packImport} from '../import-format.mjs';
import {configureValidationDns} from '../../prototypes/cloudflare-migration/cloud-transport.mjs';
const secrets=JSON.parse(readFileSync(new URL('../.validation-secrets.json',import.meta.url),'utf8'));
const endpoint='https://gaintrace-batch-validation.aixing24-gaintrace.workers.dev';
const dns=await configureValidationDns(new URL(endpoint).hostname);
const report={version:'backend v0.3.0',endpoint,dns,startedAt:new Date().toISOString(),stages:[],calls:[]};let stage;
const call=async(role,path,body)=>{
 const startedAt=new Date().toISOString();const response=await fetch(endpoint+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+(secrets['TEST_'+role+'_TOKEN']||'NO-ACCESS'),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
 const data=await response.json();report.calls.push({stage:stage?.name,path:path.split('?')[0],status:response.status,startedAt,endedAt:new Date().toISOString()});assert.equal(response.status,200);return data;
};
const persist=()=>writeFileSync(new URL('../cloud-recheck-v0.3.0.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
const phase=async(name,fn)=>{stage={name,startedAt:new Date().toISOString()};report.stages.push(stage);console.log(JSON.stringify({stage:name,status:'running'}));await fn();stage.endedAt=new Date().toISOString();stage.passed=true;persist();console.log(JSON.stringify(stage));};
try{
 await phase('optimized-first-invocations',async()=>{assert.equal((await call('ADMIN','/validation/status')).version,'backend v0.3.0');});
 await phase('optimized-staged-1000-50-without-overwriting-active',async()=>{
  const before=await call('ALICE','/state'),backup=await fixture();backup.lastBackup=Date.now();const packed=await packImport(backup,old.prepareImport(backup));const start=await call('ALICE','/import/start',packed.manifest);stage.importId=start.id;
  for(let n=start.nextPart;n<packed.texts.length;n++){await call('ALICE','/import/part',{id:start.id,number:n,text:packed.texts[n]});if(n%20===19){persist();console.log(JSON.stringify({stage:stage.name,parts:n+1,total:packed.texts.length}));}}
  for(let i=0;i<packed.texts.length+2;i++){const result=await call('ALICE','/import/verify',{id:start.id});if(i%20===19){persist();console.log(JSON.stringify({stage:stage.name,validated:i+1}));}if(result.verified)break;if(i===packed.texts.length+1)throw Error('Validation did not finish');}const after=await call('ALICE','/state');assert.deepEqual(after.state,before.state);assert.equal(after.generation,before.generation);stage.parts=packed.texts.length;stage.activeLedgerUnchanged=true;
 });
 await phase('optimized-bounded-1000-trade-replay',async()=>{
  const a=await call('ALICE','/state'),date='2026-11-16';await call('ADMIN','/validation/seed',{date,symbols:[...new Set(a.state.trades.map(t=>t.tc))],price:115});let processed=0,fragments=0;
  for(let i=0;i<200;i++){const r=await call('ADMIN','/validation/step',{account:'alice',date});fragments++;if(r.phase==='apply')processed+=r.processed;if(i%20===19){persist();console.log(JSON.stringify({stage:stage.name,fragments}));}if(r.status==='confirmed')break;if(r.status==='pending')throw Error('Unexpected pending data');}
  const point=(await call('ALICE','/state')).confirmedHistory.find(p=>p.date===date),ts=Date.parse(date+'T23:59:00+08:00');const expected=old.PnlHistory.buildSnapshot(a.state.trades,Object.fromEntries(a.state.trades.map(t=>[t.tc,{px:115,ts}])),{USDCNY:7,HKDCNY:0.9,ts},{now:ts,startedAt:ts}).snapshot;
  for(const c of ['CNY','USD','HKD'])for(const k of ['realized','unrealized'])assert.ok(Math.abs(point.amounts[c][k]-expected.amounts[c][k])<1e-6);stage.fragments=fragments;stage.processedTrades=processed;assert.equal(processed,1000);
 });
 await phase('optimized-read-and-operation-retry',async()=>{
  const a=await call('ALICE','/state'),trades=a.state.trades;const b={id:'cloud-v02-lost-response',kind:'upsert-trade',expectedRevision:a.revision,trade:trades.find(t=>t.id==='cloud-v02-extra')};const first=await call('ALICE','/operation',b);const retry=await call('ALICE','/operation',b);assert.equal(retry.duplicate,true);assert.equal(retry.revision,first.revision);
  for(let i=0;i<10;i++){const fresh=await call('ALICE','/state');assert.equal(fresh.state.trades.length,trades.length);}
 });
 await phase('prepare-current-version-cron',async()=>{for(const account of ['alice','bob']){for(let i=0;i<30;i++){const r=await call('ADMIN','/validation/step',{account,date:'2026-11-24'});if(['confirmed','already-confirmed','finalizing'].includes(r.status))break;}}});
 report.completedAt=new Date().toISOString();report.passed=true;persist();console.log(JSON.stringify({passed:true,stages:report.stages.length,calls:report.calls.length}));
}catch(error){report.failedAt=new Date().toISOString();report.failure=error.message.slice(0,200);persist();throw error;}
