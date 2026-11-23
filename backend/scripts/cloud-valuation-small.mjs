import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {old} from '../../prototypes/cloudflare-migration/runtime.mjs';
import {configureValidationDns} from '../../prototypes/cloudflare-migration/cloud-transport.mjs';
const secrets=JSON.parse(readFileSync(new URL('../.validation-secrets.json',import.meta.url),'utf8'));
const endpoint='https://gaintrace-batch-validation.aixing24-gaintrace.workers.dev';await configureValidationDns(new URL(endpoint).hostname);
const report={version:'backend v0.3.1',startedAt:new Date().toISOString(),calls:[],date:'2026-11-25',syntheticFutureDate:true};
const call=async(role,path,body)=>{const startedAt=new Date().toISOString();const r=await fetch(endpoint+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+secrets['TEST_'+role+'_TOKEN'],'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);const data=await r.json();report.calls.push({path,startedAt,endedAt:new Date().toISOString(),status:r.status,result:path==='/validation/step'?data:undefined});return data;};
assert.equal((await call('ADMIN','/validation/status')).version,'backend v0.3.1');
const a=await call('ALICE','/state'),trades=a.state.trades,date=report.date;
await call('ADMIN','/validation/seed',{date,symbols:[...new Set(trades.map(t=>t.tc))],price:115});
for(const account of ['alice','bob'])for(let n=0;n<40;n++){const result=await call('ADMIN','/validation/step',{account,date});assert.notEqual(result.status,'pending');if(result.processed)assert.ok(result.processed<=5);if(result.status==='confirmed')break;if(n===39)throw Error('Job incomplete');}
const final=await call('ALICE','/state'),point=final.confirmedHistory.find(p=>p.date===date),ts=Date.parse(date+'T23:59:00+08:00');
const expected=old.PnlHistory.buildSnapshot(trades,Object.fromEntries(trades.map(t=>[t.tc,{px:115,ts}])),{USDCNY:7,HKDCNY:0.9,ts},{now:ts,startedAt:ts}).snapshot;
for(const c of ['CNY','USD','HKD'])for(const k of ['realized','unrealized'])assert.ok(Math.abs(point.amounts[c][k]-expected.amounts[c][k])<1e-6);
assert.ok(Math.abs(old.PnlHistory.percentage(point,'USD')-old.PnlHistory.percentage(expected,'USD'))<1e-9);
report.completedAt=new Date().toISOString();report.passed=true;writeFileSync(new URL('../cloud-valuation-v0.3.1.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,calls:report.calls.length,valuationsPerFragment:5}));
