// Run only against the isolated validation Worker. Secrets never enter reports.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {fixture,FrontendPrototype,old} from './runtime.mjs';
import {configureValidationDns} from './cloud-transport.mjs';
const secrets=JSON.parse(readFileSync(new URL('./.validation-secrets.json',import.meta.url),'utf8'));
const deployment=JSON.parse(readFileSync(new URL('./cloud-deployment.json',import.meta.url),'utf8'));
const base=new URL(deployment.url);
if (!base.hostname.startsWith('gaintrace-free-validation.') || !base.hostname.endsWith('.workers.dev')) throw new Error('Isolated validation host required');
const transport=await configureValidationDns(base.hostname);
const events=[];
const requests=[];
const record=(name,details={})=>{const event={name,at:new Date().toISOString(),...details};events.push(event);console.log(JSON.stringify(event));};
const call=async (account,path,body)=>{
  const token=secrets['TEST_'+account.toUpperCase()+'_TOKEN'];
  const started=performance.now();
  const startedAt=new Date().toISOString();
  const response=await fetch(new URL(path,base),{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});
  let value;try {value=await response.json();} catch {value={error:'non-JSON response',status:response.status};}
  const networkElapsedMs=Math.round(performance.now()-started);
  requests.push({account,path,method:body===undefined?'GET':'POST',status:response.status,startedAt,finishedAt:new Date().toISOString(),networkElapsedMs});
  return {status:response.status,body:value,networkElapsedMs};
};
const runtime={request:call};
const seed=async (date,trades,price,extra={})=>{
  const result=await call('admin','/validation/seed',{date,symbols:[...new Set(trades.map(t=>t.tc))],price,...extra});assert.equal(result.status,200);return result;
};
const run=async date=>{const result=await call('admin','/validation/run',{date});assert.equal(result.status,200);return result.body.output;};
const state=async account=>{const result=await call(account,'/state');assert.equal(result.status,200);return result.body;};
try {
  const unauth=await fetch(new URL('/state',base));assert.equal(unauth.status,401);
  const fixed=await fetch(new URL('/state',base),{headers:{authorization:'Bearer MOCK-ALICE'}});assert.equal(fixed.status,401);
  assert.equal((await call('alice','/validation/status')).status,401);
  record('public and fixed mock credentials rejected; admin isolated');
  const backup=await fixture();const bobBackup=await fixture(100,10);
  const local=new FrontendPrototype(runtime,backup);await local.start();await local.chunk(0);
  assert.equal((await local.finish()).status,409);assert.equal((await state('alice')).state,null);
  assert.equal((await call('bob','/migration/chunk',{id:local.migration.id,number:0,text:local.parts[0]})).status,404);
  record('incomplete upload remains inactive and chunks account isolated');
  await local.start();assert.deepEqual(local.migration.received,[0]);assert.equal((await local.chunk(0)).body.duplicate,true);
  assert.equal((await local.chunk(0,local.parts[0]+' ')).status,409);
  await local.upload();const committed=await local.finish();assert.equal(committed.status,200);
  assert.deepEqual(old.Core.calcPositions(committed.body.state.trades),old.Core.calcPositions(backup.trades));
  assert.equal((await local.finish()).body.duplicate,true);
  record('resumable verified migration and idempotent commit',{trades:1000,stocks:50,chunks:local.parts.length,closedStocks:old.Core.calcPositions(backup.trades).filter(p=>!p.shares).length,legacySnapshots:backup.pnlHistory.snapshots.length});
  const conflicting=new FrontendPrototype(runtime,bobBackup);await conflicting.upload();assert.equal((await conflicting.finish()).status,409);
  const bob=new FrontendPrototype(runtime,bobBackup,'bob');await bob.upload();assert.equal((await bob.finish()).status,200);
  record('existing cloud ledger protected; independent second account',{bobTrades:(await state('bob')).state.trades.length});
  await seed('2026-11-16',backup.trades,115);
  assert.ok((await run('2026-11-16')).every(r=>r.status==='confirmed'));
  assert.ok((await run('2026-11-16')).every(r=>r.status==='already-confirmed'));
  const historical=(await state('alice')).confirmedHistory;
  record('D1 daily computation persists and retry is idempotent');
  await seed('2026-11-17',backup.trades,118,{missing:'us100002'});assert.ok((await run('2026-11-17')).every(r=>r.status==='pending'));
  await seed('2026-11-17',backup.trades,118);assert.ok((await run('2026-11-17')).every(r=>r.status==='confirmed'));
  await seed('2026-11-18',backup.trades,120,{noFx:true});assert.ok((await run('2026-11-18')).every(r=>r.reason==='fx'));
  await seed('2026-11-18',backup.trades,120,{finalized:false});assert.ok((await run('2026-11-18')).every(r=>r.reason==='quotes'));
  await seed('2026-11-18',backup.trades,120);await run('2026-11-18');
  record('missing prices or FX and unfinalized bars stay pending; retries backfill');
  local.offline=true;const added={...backup.trades[1],id:'cloud-offline-new',date:'2026-11-22',side:'B',qty:3,px:120,ts:2000};local.edit(added);
  assert.equal((await local.sync()).pending,1);assert.equal((await state('alice')).state.trades.length,1000);
  local.offline=false;await local.sync({loseResponse:true});assert.equal(local.outbox.length,1);await local.sync();assert.equal(local.outbox.length,0);
  const after=await state('alice');assert.equal(after.state.trades.filter(t=>t.id===added.id).length,1);assert.deepEqual(after.confirmedHistory[0],historical[0]);
  record('offline outbox and response-loss retry avoid duplicates; future purchase preserves history');
  const concurrent=await Promise.all(['cloud-device-a','cloud-device-b'].map(id=>call('alice','/operation',{id,kind:'upsert-trade',trade:{...added,id},expectedRevision:after.revision})));
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);record('two devices racing commit only one revision');
  const current=await state('alice');assert.equal((await call('alice','/operation',{id:'cloud-backdate',kind:'upsert-trade',trade:{...current.state.trades[0],fee:0.2},expectedRevision:current.revision})).status,200);
  assert.ok((await state('alice')).confirmedHistory.every(r=>r.status==='invalidated'));await run('2026-11-16');
  const status=await call('admin','/validation/status');assert.ok(status.body.archives.some(r=>r.account_id==='alice'));
  assert.deepEqual((await state('alice')).legacyHistory,backup.pnlHistory);record('backdated correction invalidates history and recomputation archives evidence');
  const providers=await call('admin','/validation/providers');assert.equal(providers.status,200);record('fixed public provider reachability from Worker',providers.body);
  await seed('2026-11-23',backup.trades,125,{schedule:true});
  record('synthetic date staged for real Cron observation',{valuationDate:'2026-11-23'});
  const readResults=[];for(let i=0;i<10;i++)readResults.push(await call('alice','/state'));
  assert.ok(readResults.every(r=>r.status===200));record('repeated 1000-trade cloud reads succeed',{requests:readResults.length,networkElapsedMs:readResults.map(r=>r.networkElapsedMs),elapsedIsNotCpu:true});
} finally {
  const output={checkedAt:new Date().toISOString(),environment:'actual isolated Cloudflare Worker + remote D1; synthetic ledgers only',deployment,transport,events,requests,limitations:'Real Cron and Cloudflare CPU analytics require separate observation; networkElapsedMs is not CPU. No production authentication, real ledger or frontend integration.'};
  writeFileSync(new URL('./cloud-verification-results.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
}
