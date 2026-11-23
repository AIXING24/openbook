import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {configureValidationDns} from './cloud-transport.mjs';
const secrets=JSON.parse(readFileSync('.validation-secrets.json','utf8'));
const deployment=JSON.parse(readFileSync('cloud-deployment.json','utf8'));
const transport=await configureValidationDns(new URL(deployment.url).hostname);
const requests=[];const events=[];
const call=async (role,path,body)=>{
 const startedAt=new Date().toISOString();const response=await fetch(new URL(path,deployment.url),{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+secrets['TEST_'+role+'_TOKEN'],'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
 const data=await response.json();requests.push({role,path,startedAt,finishedAt:new Date().toISOString(),status:response.status});return {status:response.status,body:data};
};
const phase=async (name,fn)=>{await new Promise(r=>setTimeout(r,2000));const startedAt=new Date().toISOString();await fn();const event={name,startedAt,finishedAt:new Date().toISOString()};events.push(event);console.log(JSON.stringify(event));};
try {
 const initial=await call('ALICE','/state');assert.equal(initial.status,200);const before=initial.body;let revision=before.revision;
 await phase('raw state reads preserve full ledger and historical evidence',async()=>{for(let i=0;i<10;i++){const read=await call('ALICE','/state');assert.equal(read.status,200);assert.deepEqual(read.body,before);}});
 await phase('small SQL mutations and response-loss replay preserve past P&L',async()=>{
  for(let i=0;i<3;i++){
   const trade={...before.state.trades[1],id:crypto.randomUUID(),date:'2026-11-25',side:'B',qty:1};
   const op={id:crypto.randomUUID(),kind:'upsert-trade',trade,expectedRevision:revision};
   const added=await call('ALICE','/operation',op);assert.equal(added.status,200);revision=added.body.revision;
   const retry=await call('ALICE','/operation',op);assert.equal(retry.body.duplicate,true);
   const removed=await call('ALICE','/operation',{id:crypto.randomUUID(),kind:'delete-trade',tradeId:trade.id,expectedRevision:revision});assert.equal(removed.status,200);revision=removed.body.revision;
  }
  const after=await call('ALICE','/state');assert.deepEqual(after.body.state.trades,before.state.trades);assert.deepEqual(after.body.confirmedHistory,before.confirmedHistory);assert.deepEqual(after.body.legacyHistory,before.legacyHistory);
 });
 await phase('daily calculation without loading history',async()=>{
  for(const date of ['2026-11-20','2026-11-21','2026-11-22']){
   assert.equal((await call('ADMIN','/validation/seed',{date,symbols:[...new Set(before.state.trades.map(t=>t.tc))],price:124})).status,200);
   const run=await call('ADMIN','/validation/run',{date});assert.equal(run.status,200);assert.ok(run.body.output.every(r=>r.status==='confirmed'));
  }
 });
 await phase('next synthetic date staged for real Cron',async()=>{assert.equal((await call('ADMIN','/validation/seed',{date:'2026-11-24',symbols:[...new Set(before.state.trades.map(t=>t.tc))],price:126,schedule:true})).status,200);});
}finally{writeFileSync('cloud-recheck-results.json',JSON.stringify({version:'prototype v0.2.1',checkedAt:new Date().toISOString(),transport,events,requests},null,2)+'\n');}
