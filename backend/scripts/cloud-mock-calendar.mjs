import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync,writeFileSync} from 'node:fs';
import {old} from '../tests/runtime.mjs';
import {mockTrade} from '../validation.mjs';
const config=JSON.parse(readFileSync(new URL('../wrangler.local.json',import.meta.url),'utf8'));
assert.equal(config.vars.VALIDATION_MODE,'mock-only');assert.deepEqual(config.triggers.crons,[]);
let credentials;
try{credentials=await promisify(execFile)('./node_modules/.bin/wrangler',['auth','token','--json','--config','wrangler.local.json'],{env:process.env});}catch{throw Error('Official authorization unavailable; output withheld');}
const {token}=JSON.parse(credentials.stdout),base='/accounts/'+config.account_id;
async function official(path,body,method=body?'POST':'GET'){
  const response=await fetch('https://api.cloudflare.com/client/v4'+base+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const data=await response.json();assert.equal(response.status,200,'Official API status');assert.equal(data.success,true,'Official API success');return data.result;
}
const sql=async(statement,params=[])=>{
  const result=await official('/d1/database/'+config.d1_databases[0].database_id+'/query',{sql:statement,params});assert.ok(result.every(part=>part.success),'D1 query failed');return result.flatMap(part=>part.results);
};
const schedulesPath='/workers/scripts/'+config.name+'/schedules';
const initialSchedules=await official(schedulesPath);assert.deepEqual(initialSchedules.schedules??initialSchedules,[]);
const accounts=await sql("SELECT id,generation,revision FROM gt_accounts WHERE id LIKE 'email:%' AND generation IS NOT NULL");assert.equal(accounts.length,1);
const account=accounts[0],trades=(await sql('SELECT payload FROM gt_trades WHERE account=? AND generation=? ORDER BY date,ts,ordinal',[account.id,account.generation])).map(row=>JSON.parse(row.payload));
assert.ok(trades.length>=5&&trades.every(mockTrade));
const dates=['2026-11-23','2026-11-24'];
assert.equal((await sql('SELECT count(*) total FROM gt_daily WHERE account=? AND date IN (?,?)',[account.id,...dates]))[0].total,0,'Use a fresh fixed simulation window, not a destructive rerun');
const sourceCommit=(await promisify(execFile)('git',['rev-parse','HEAD'])).stdout.trim();
const report={version:'backend v0.3.4',sourceCommit,startedAt:new Date().toISOString(),syntheticCalendar:true,dates,accountCount:1,startingRevision:account.revision,mockTradeCount:trades.length,noBrowserOrAppSessionUsedByScheduler:true,manualDailyStepsCalled:0,observations:[],confirmed:false,temporaryCronRemoved:false};
const file=new URL('../cloud-mock-calendar-v0.3.4.json',import.meta.url);
const save=()=>writeFileSync(file,JSON.stringify(report,null,2)+'\n');
let enabled=false;
try{
  await sql(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  assert.equal((await sql('SELECT count(*) total FROM gt_mock_schedule_targets'))[0].total,0);
  const deadline=Date.now()+25*60000;report.deadline=new Date(deadline).toISOString();
  await sql('INSERT INTO gt_mock_schedule_targets VALUES(?,?)',[account.id,'2026-11-22']);
  await sql('INSERT INTO gt_mock_schedule_days VALUES(?,?,0),(?,?,1),(?,?,1)',['2026-11-22',Date.now()-1,dates[0],Date.now()-1,dates[1],Date.now()-1]);
  for(const date of dates){
    await sql('INSERT INTO gt_prices VALUES(?,?,?,1),(?,?,?,1) ON CONFLICT(date,tc) DO UPDATE SET px=excluded.px,finalized=excluded.finalized',[date,'us100001',60,date,'us100002',95]);
    await sql('INSERT INTO gt_rates VALUES(?,?) ON CONFLICT(date) DO UPDATE SET payload=excluded.payload',[date,JSON.stringify({USDCNY:7,HKDCNY:0.9})]);
  }
  await sql("INSERT INTO gt_control VALUES('mock-calendar-enabled','1'),('mock-calendar-until',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[String(deadline)]);
  enabled=true;await official(schedulesPath,[{cron:'* * * * *'}],'PUT');
  const active=await official(schedulesPath);assert.equal((active.schedules??active)[0].cron,'* * * * *');report.temporaryCronEnabledAt=new Date().toISOString();save();
  console.log(JSON.stringify({stage:'waiting-for-real-cron',version:report.version,dates,deadline:report.deadline}));
  let previous='';
  while(Date.now()<deadline){
    const jobs=await sql('SELECT date,phase FROM gt_jobs WHERE account=? AND date IN (?,?) ORDER BY date',[account.id,...dates]);
    const points=await sql('SELECT date,status,payload FROM gt_daily WHERE account=? AND date IN (?,?) ORDER BY date',[account.id,...dates]);
    const progress=JSON.stringify({jobs,confirmed:points.filter(point=>point.status==='confirmed').length});
    if(progress!==previous){previous=progress;const event={observedAt:new Date().toISOString(),jobs,confirmed:points.filter(point=>point.status==='confirmed').length};report.observations.push(event);save();console.log(JSON.stringify(event));}
    if(points.length===dates.length&&points.every(point=>point.status==='confirmed')){
      report.points=points.map(row=>{
        const point=JSON.parse(row.payload),stamp=Date.parse(row.date+'T23:59:00+08:00');
        const quotes={us100001:{px:60,ts:stamp},us100002:{px:95,ts:stamp}};
        const expected=old.PnlHistory.buildSnapshot(trades.filter(trade=>trade.date<=row.date),quotes,{USDCNY:7,HKDCNY:0.9,ts:stamp},{now:stamp,startedAt:stamp}).snapshot;
        assert.equal(point.source,'SYNTHETIC_CONFIRMED_CLOSE');
        for(const currency of ['CNY','USD','HKD'])for(const key of ['realized','unrealized'])assert.ok(Math.abs(point.amounts[currency][key]-expected.amounts[currency][key])<0.000001,'Reference accounting differs');
        return {date:row.date,status:row.status,source:point.source,ledgerRevision:point.ledgerRevision,realizedUSD:point.amounts.USD.realized,totalUSD:point.amounts.USD.realized+point.amounts.USD.unrealized,generatedAt:new Date(point.generatedAt).toISOString(),referenceAccountingMatched:true};
      });
      report.confirmed=true;report.completedAt=new Date().toISOString();break;
    }
    await new Promise(resolve=>setTimeout(resolve,60000));
  }
  assert.equal(report.confirmed,true,'Real Cron did not finish within the temporary window');
}finally{
  if(enabled){
    await official(schedulesPath,[],'PUT');
    await sql("UPDATE gt_control SET value='0' WHERE key='mock-calendar-enabled'");
    const finalSchedules=await official(schedulesPath);report.temporaryCronRemoved=(finalSchedules.schedules??finalSchedules).length===0;
    assert.equal(report.temporaryCronRemoved,true);report.cleanupAt=new Date().toISOString();
  }
  save();
}
const end=new Date().toISOString();
const query=`query($accountTag:string,$start:string,$end:string,$scriptName:string){viewer{accounts(filter:{accountTag:$accountTag}){workersInvocationsScheduled(limit:100,filter:{scriptName:$scriptName,datetime_geq:$start,datetime_leq:$end}){cpuTimeUs cron datetime scheduledDatetime scriptName status}}}}`;
const response=await fetch('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({query,variables:{accountTag:config.account_id,start:report.startedAt,end,scriptName:config.name}}),signal:AbortSignal.timeout(30000)});
const analytics=await response.json();assert.equal(response.status,200);assert.ok(!analytics.errors,'Official scheduled analytics unavailable');
const samples=analytics.data.viewer.accounts[0].workersInvocationsScheduled;
report.cpu={queriedAt:end,timeRange:{start:report.startedAt,end},units:'Official scheduled invocation cpuTimeUs, microseconds',samples,maxObservedMs:samples.length?Math.max(...samples.map(sample=>sample.cpuTimeUs))/1000:null,allObservedWithin10ms:samples.length>0&&samples.every(sample=>sample.cpuTimeUs<10000),freeCpuHeadroomProven:false};save();
console.log(JSON.stringify({...report,observations:undefined,cpu:{...report.cpu,samples:undefined}},null,2));
