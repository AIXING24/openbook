// Real cloud mock verification. Never reads browser financial storage.
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {fixture,old} from '../../prototypes/cloudflare-migration/runtime.mjs';
import {packImport} from '../import-format.mjs';
import {configureValidationDns} from '../../prototypes/cloudflare-migration/cloud-transport.mjs';
const secrets=JSON.parse(readFileSync(new URL('../.validation-secrets.json',import.meta.url),'utf8'));
const endpoint='https://gaintrace-batch-validation.aixing24-gaintrace.workers.dev';
const dns=await configureValidationDns(new URL(endpoint).hostname);
const output={version:'backend v0.2.0',endpoint,dns,startedAt:new Date().toISOString(),stages:[],calls:[]};
let stage;
const call=async(role,path,body)=>{
 const startedAt=new Date().toISOString();let r;
 try{r=await fetch(endpoint+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+(secrets['TEST_'+role.toUpperCase()+'_TOKEN']||'NO-ACCESS'),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});}catch{throw Error('Cloud connection failed: '+path);}
 let value;try{value=await r.json();}catch{throw Error('Invalid cloud JSON: '+path);}
 output.calls.push({stage:stage?.name,path:path.split('?')[0],status:r.status,startedAt,endedAt:new Date().toISOString()});
 return {status:r.status,body:value};
};
const check=async(name,fn)=>{stage={name,startedAt:new Date().toISOString()};output.stages.push(stage);console.log(JSON.stringify({stage:name,status:'running'}));await fn();stage.endedAt=new Date().toISOString();stage.passed=true;writeFileSync(new URL('../cloud-verification-v0.2.0.json',import.meta.url),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(stage));};
const state=async role=>{const r=await call(role,'/state');assert.equal(r.status,200);return r.body;};
const seed=async(date,trades,extra={})=>{const r=await call('admin','/validation/seed',{date,symbols:[...new Set(trades.map(t=>t.tc))],price:115,...extra});assert.equal(r.status,200);};
const finish=async(role,date,stopBeforeFinalize=false)=>{
 const log=[];for(let n=0;n<200;n++){const r=await call('admin','/validation/step',{account:role,date});assert.equal(r.status,200);log.push(r.body);if(n%20===19)console.log(JSON.stringify({stage:stage.name,job:role,date,fragments:n+1}));if(['confirmed','already-confirmed','pending'].includes(r.body.status) || (stopBeforeFinalize && r.body.status==='finalizing'))return log;}throw Error('Job exceeded bounded progress');
};
const compare=(actual,trades,date)=>{
 const ts=Date.parse(date+'T23:59:00+08:00'),quotes=Object.fromEntries(trades.map(t=>[t.tc,{px:115,ts}]));
 const expected=old.PnlHistory.buildSnapshot(trades,quotes,{USDCNY:7,HKDCNY:0.9,ts},{now:ts,startedAt:ts}).snapshot;
 for(const cur of ['CNY','USD','HKD'])for(const key of ['realized','unrealized'])assert.ok(Math.abs(actual.amounts[cur][key]-expected.amounts[cur][key])<1e-6);
 for(const cur of ['CNY','USD','HKD'])assert.ok(Math.abs(actual.purchases[cur]-expected.purchases[cur])<1e-6);
 assert.ok(Math.abs(old.PnlHistory.percentage(actual,'USD')-old.PnlHistory.percentage(expected,'USD'))<1e-9);
};
try{
 await check('authorization-and-first-invocations',async()=>{assert.equal((await call('none','/state')).status,401);assert.equal((await call('alice','/validation/status')).status,401);assert.equal((await call('admin','/validation/status')).body.version,'backend v0.2.0');});
 await check('migration-1000-50-and-raw-evidence',async()=>{
  for(const [role,count,stocks] of [['alice',1000,50],['bob',100,10]]){
   const backup=await fixture(count,stocks),prepared=old.prepareImport(backup),packed=await packImport(backup,prepared);
   const start=await call(role,'/import/start',packed.manifest);assert.equal(start.status,200);const id=start.body.id;
   const other=role==='alice'?'bob':'alice';assert.equal((await call(other,'/import/part',{id,number:0,text:packed.texts[0]})).status,404);
   if(start.body.status==='uploading')for(let n=start.body.nextPart;n<packed.texts.length;n++){
     assert.equal((await call(role,'/import/part',{id,number:n,text:packed.texts[n]})).status,200);
     if(n%20===19)console.log(JSON.stringify({stage:stage.name,role,uploaded:n+1,total:packed.texts.length}));
   }
   assert.equal((await call(role,'/import/part',{id,number:0,text:packed.texts[0]})).body.duplicate,true);
   assert.equal((await call(role,'/import/part',{id,number:0,text:packed.texts[0]+' '})).status,409);
   assert.equal((await call(role,'/import/verify',{id})).status,200);
   for(let n=0;n<packed.texts.length;n++)assert.equal(JSON.stringify((await call(role,'/import/part?id='+id+'&number='+n)).body),packed.texts[n]);
   assert.equal((await call(role,'/import/activate',{id,root:packed.manifest.root})).status,200);
   const active=await state(role);if(active.revision===1)assert.deepEqual(active.state,JSON.parse(JSON.stringify(prepared.state)));
   console.log(JSON.stringify({role,trades:active.state.trades.length,parts:packed.texts.length,verifiedLegacySnapshots:backup.pnlHistory.snapshots.length}));
  }
 });
 await check('bounded-initial-daily-and-durable-restart',async()=>{
  const a=await state('alice');await seed('2026-11-20',a.state.trades);
  const first=await finish('alice','2026-11-20');assert.equal(first.at(-1).status,'confirmed');compare((await state('alice')).confirmedHistory.find(p=>p.date==='2026-11-20'),a.state.trades,'2026-11-20');
  const b=await state('bob');assert.equal((await finish('bob','2026-11-20')).at(-1).status,'confirmed');compare((await state('bob')).confirmedHistory[0],b.state.trades,'2026-11-20');
  stage.aliceFragments=first.length;stage.maxTradesPerFragment=Math.max(...first.map(x=>x.phase==='apply'?x.processed||0:0));
 });
 await check('incremental-next-day-and-repeated-read',async()=>{
  const a=await state('alice');await seed('2026-11-21',a.state.trades);
  const log=await finish('alice','2026-11-21');assert.equal(log.filter(x=>x.phase==='apply').length,0);assert.equal(log.at(-1).status,'confirmed');stage.fragments=log.length;stage.replayedTrades=0;
  assert.equal((await finish('bob','2026-11-21')).at(-1).status,'confirmed');
  for(let i=0;i<10;i++)assert.equal((await state('alice')).state.trades.length,a.state.trades.length);
 });
 await check('idempotent-incremental-change-and-past-freeze',async()=>{
  const a=await state('alice'),past=JSON.stringify(a.confirmedHistory);const trade={...a.state.trades[0],id:'cloud-v02-extra',date:'2026-11-22',qty:3,ts:3001};
  const op={id:'cloud-v02-lost-response',expectedRevision:a.revision,kind:'upsert-trade',trade};assert.equal((await call('alice','/operation',op)).status,200);assert.equal((await call('alice','/operation',op)).body.duplicate,true);
  assert.equal(JSON.stringify((await state('alice')).confirmedHistory),past);
  assert.equal((await call('alice','/operation',{...op,id:'cloud-v02-stale-device'})).status,409);
  const fresh=await state('alice');await seed('2026-11-22',fresh.state.trades);const log=await finish('alice','2026-11-22');assert.equal(log.filter(x=>x.phase==='apply').reduce((n,x)=>n+x.processed,0),1);compare((await state('alice')).confirmedHistory.at(-1),fresh.state.trades,'2026-11-22');stage.replayedTrades=1;
 });
 await check('missing-provider-remains-pending-and-resumes',async()=>{
  const a=await state('alice');await seed('2026-11-23',a.state.trades,{noFx:true});assert.equal((await finish('alice','2026-11-23')).at(-1).status,'pending');
  assert.equal((await state('alice')).confirmedHistory.some(p=>p.date==='2026-11-23'),false);
  await seed('2026-11-23',a.state.trades);assert.equal((await finish('alice','2026-11-23')).at(-1).status,'confirmed');
 });
 await check('backdated-correction-and-archived-recalculation',async()=>{
  const a=await state('alice'),trade={...a.state.trades[0],px:99};assert.equal((await call('alice','/operation',{id:'cloud-v02-correction',expectedRevision:a.revision,kind:'upsert-trade',trade})).status,200);
  const updated=await state('alice');assert.ok(updated.confirmedHistory.every(p=>p.status==='invalidated'));
  assert.equal((await finish('alice','2026-11-20')).at(-1).status,'confirmed');compare((await state('alice')).confirmedHistory[0],updated.state.trades,'2026-11-20');
 });
 await check('prepare-actual-cron-finalization',async()=>{
  const a=await state('alice');await seed('2026-11-24',a.state.trades,{schedule:true});
  assert.equal((await finish('alice','2026-11-24',true)).at(-1).status,'finalizing');
  const b=await state('bob');assert.equal((await finish('bob','2026-11-24',true)).at(-1).status,'finalizing');
  assert.equal((await state('alice')).confirmedHistory.some(p=>p.date==='2026-11-24'),false);
  stage.onlyCronCanFinishNext=true;stage.syntheticFutureDate=true;
 });
 output.completedAt=new Date().toISOString();output.passed=true;
 writeFileSync(new URL('../cloud-verification-v0.2.0.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify({passed:true,stages:output.stages.length,calls:output.calls.length,cronPrepared:true}));
}catch(error){output.failedAt=new Date().toISOString();output.failure=error.message.slice(0,300);writeFileSync(new URL('../cloud-verification-v0.2.0.json',import.meta.url),JSON.stringify(output,null,2)+'\n');throw error;}
