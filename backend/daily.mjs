import {emptyPosition,applyTrade} from './valuation.mjs';
import {read,all,run,statement as q} from './storage.mjs';
import {validDate} from './validation.mjs';
const done={status:'already-confirmed'};
const live=(job)=>['apply','value','finalize'].includes(job.phase);
// Each invocation does one bounded, durable unit. SQL batches make checkpoint+outputs atomic.
export async function dailyStep(db,account,date) {
  if(!validDate(date))throw Error('Invalid date');
  const info=await read(db,`SELECT a.generation active_generation,a.revision active_revision,d.status daily_status,j.* FROM gt_accounts a LEFT JOIN gt_daily d ON d.account=a.id AND d.date=? LEFT JOIN gt_jobs j ON j.account=a.id AND j.date=? WHERE a.id=?`,date,date,account);
  const current={generation:info?.active_generation,revision:info?.active_revision};
  if(!current.generation)return {status:'no-ledger'};
  if(info.daily_status==='confirmed')return done;
  let job=info.id?info:null;
  if(!job || !live(job) || job.revision!==current.revision || job.generation!==current.generation) {
    const prior=await read(db,`SELECT j.id,j.date FROM gt_jobs j JOIN gt_daily d ON d.account=j.account AND d.date=j.date AND d.revision=j.revision WHERE j.account=? AND j.generation=? AND j.date<? AND j.phase='done' AND d.status='confirmed' ORDER BY j.date DESC LIMIT 1`,account,current.generation,date);
    const id=crypto.randomUUID();
    const result=await db.batch([
      q(db,'DELETE FROM gt_positions WHERE job IN (SELECT id FROM gt_jobs WHERE account=? AND date=?) AND EXISTS(SELECT 1 FROM gt_accounts WHERE id=? AND revision=?)',account,date,account,current.revision),
      q(db,`INSERT INTO gt_jobs(id,account,generation,date,revision,previous_date,phase) SELECT ?,?,?,?,?,?,'apply' WHERE EXISTS(SELECT 1 FROM gt_accounts WHERE id=? AND revision=?) ON CONFLICT(account,date) DO UPDATE SET id=excluded.id,generation=excluded.generation,revision=excluded.revision,previous_date=excluded.previous_date,phase='apply',cursor='',token=NULL,reason=NULL`,id,account,current.generation,date,current.revision,prior?.date||null,account,current.revision),
      q(db,`INSERT INTO gt_positions SELECT ?,tc,cur,payload,NULL FROM gt_positions WHERE job=? AND EXISTS(SELECT 1 FROM gt_jobs WHERE id=?)`,id,prior?.id||'',id),
    ]);
    return {status:result[1].meta.changes?'started':'revision-changed',previousDate:prior?.date||null};
  }
  const token=crypto.randomUUID();
  const guard=(phase,cursor)=>q(db,`UPDATE gt_jobs SET phase=?,cursor=?,token=?,reason=NULL WHERE id=? AND phase=? AND cursor=? AND revision=(SELECT revision FROM gt_accounts WHERE id=account)`,phase,cursor,token,job.id,job.phase,job.cursor);
  if(job.phase==='apply'){
    const cursor=job.cursor?JSON.parse(job.cursor):['',0,-1];
    const rows=await all(db,`SELECT ordinal,date,ts,tc,cur,payload FROM gt_trades WHERE account=? AND generation=? AND date>? AND date<=? AND (date,ts,ordinal)>(?,?,?) ORDER BY date,ts,ordinal LIMIT 10`,account,current.generation,job.previous_date||'',date,...cursor);
    if(!rows.length){const result=await guard('value','').run();return {status:result.meta.changes?'valuing':'conflict'};}
    const symbols=[...new Set(rows.map(r=>r.tc))];
    const states=await all(db,'SELECT tc,payload FROM gt_positions WHERE job=? AND tc IN (SELECT value FROM json_each(?))',job.id,JSON.stringify(symbols));
    const map=new Map(states.map(r=>[r.tc,JSON.parse(r.payload)]));
    for(const row of rows){const p=map.get(row.tc)||emptyPosition(row.cur);applyTrade(p,JSON.parse(row.payload));map.set(row.tc,p);}
    if([...map.values()].some(p=>Object.entries(p).some(([k,v])=>k!=='cur' && !Number.isFinite(v)) || p.purchases<0))return {status:'pending',reason:'ledger'};
    const last=rows.at(-1), next=JSON.stringify([last.date,last.ts,last.ordinal]);
    const result=await db.batch([guard('apply',next),q(db,`INSERT INTO gt_positions SELECT ?,json_extract(value,'$.tc'),json_extract(value,'$.p.cur'),json_extract(value,'$.p'),NULL FROM json_each(?) WHERE EXISTS(SELECT 1 FROM gt_jobs WHERE id=? AND token=?) ON CONFLICT(job,tc) DO UPDATE SET payload=excluded.payload,valuation=NULL`,job.id,JSON.stringify(symbols.map(tc=>({tc,p:map.get(tc)}))),job.id,token)]);
    return {status:result[0].meta.changes?'progress':'conflict',phase:'apply',processed:rows.length};
  }
  if(job.phase==='value'){
    const rows=await all(db,`SELECT p.tc,p.cur,p.payload,r.px FROM gt_positions p LEFT JOIN gt_prices r ON r.tc=p.tc AND r.date=? AND r.finalized=1 WHERE p.job=? AND p.tc>? ORDER BY p.tc LIMIT 5`,date,job.id,job.cursor);
    if(!rows.length){const result=await guard('finalize','').run();return {status:result.meta.changes?'finalizing':'conflict'};}
    const rate=await read(db,'SELECT payload FROM gt_rates WHERE date=?',date), fx=rate?JSON.parse(rate.payload):null;
    const cutoff=Date.parse(date+'T23:59:00+08:00'), values=[];
    for(const row of rows){
      const p=JSON.parse(row.payload);
      if(row.cur!=='CNY' && !(Number.isFinite(fx?.[row.cur==='USD'?'USDCNY':'HKDCNY']) && fx[row.cur==='USD'?'USDCNY':'HKDCNY']>0))return {status:'pending',reason:'fx'};
      if(p.shares && !(Number.isFinite(row.px) && row.px>0))return {status:'pending',reason:'quotes'};
      const value={realized:p.realized,unrealized:p.shares?p.shares*row.px-p.cost:0,purchases:p.purchases,position:p.shares?{tc:row.tc,cur:row.cur,shares:p.shares,cost:p.cost,px:row.px,quoteAt:cutoff}:null};
      if(!Number.isFinite(value.unrealized))return {status:'pending',reason:'ledger'};
      values.push({tc:row.tc,value});
    }
    const result=await db.batch([guard('value',rows.at(-1).tc),q(db,`INSERT INTO gt_positions SELECT p.job,p.tc,p.cur,p.payload,json_extract(j.value,'$.value') FROM gt_positions p JOIN json_each(?) j ON p.tc=json_extract(j.value,'$.tc') WHERE p.job=? AND EXISTS(SELECT 1 FROM gt_jobs WHERE id=? AND token=?) ON CONFLICT(job,tc) DO UPDATE SET valuation=excluded.valuation`,JSON.stringify(values),job.id,job.id,token)]);
    return {status:result[0].meta.changes?'progress':'conflict',phase:'value',processed:rows.length};
  }
  const cutoff=Date.parse(date+'T23:59:00+08:00');
  const amount=cur=>`json_object('realized',COALESCE(sum(CASE WHEN cur='${cur}' THEN json_extract(valuation,'$.realized') ELSE 0 END),0),'unrealized',COALESCE(sum(CASE WHEN cur='${cur}' THEN json_extract(valuation,'$.unrealized') ELSE 0 END),0))`;
  const purchased=cur=>`COALESCE(sum(CASE WHEN cur='${cur}' THEN json_extract(valuation,'$.purchases') ELSE 0 END),0)`;
  const payload=await read(db,`SELECT json_object('date',?,'capturedAt',?,'amounts',json_object('CNY',${amount('CNY')},'USD',${amount('USD')},'HKD',${amount('HKD')}),'purchases',json_object('CNY',${purchased('CNY')},'USD',${purchased('USD')},'HKD',${purchased('HKD')}),'rates',json_object('CNY',1,'USD',json_extract((SELECT payload FROM gt_rates WHERE date=?),'$.USDCNY'),'HKD',json_extract((SELECT payload FROM gt_rates WHERE date=?),'$.HKDCNY')),'fxAt',CASE WHEN EXISTS(SELECT 1 FROM gt_rates WHERE date=?) THEN ? ELSE NULL END,'fxApprox',json('false'),'positions',json((SELECT COALESCE(json_group_array(json_extract(valuation,'$.position')),'[]') FROM (SELECT valuation FROM gt_positions WHERE job=? AND json_extract(valuation,'$.position') IS NOT NULL ORDER BY tc))),'invalidatedAt',NULL,'valuationDate',?,'generatedAt',?,'source','SYNTHETIC_CONFIRMED_CLOSE','ledgerRevision',?) payload,count(*) n,sum(valuation IS NULL) missing FROM gt_positions WHERE job=?`,date,cutoff,date,date,date,cutoff,job.id,date,Date.now(),job.revision,job.id);
  if(payload.missing)return {status:'pending',reason:'incomplete'};
  if(!payload.n)return {status:'pending',reason:'empty'};
  const result=await db.batch([
    guard('done',''),
    q(db,'INSERT OR IGNORE INTO gt_archive SELECT account,date,revision,payload FROM gt_daily WHERE account=? AND date=? AND status<>\'confirmed\' AND revision<>? AND EXISTS(SELECT 1 FROM gt_jobs WHERE id=? AND token=?)',account,date,job.revision,job.id,token),
    q(db,`INSERT INTO gt_daily SELECT ?,?,?,'confirmed',? WHERE EXISTS(SELECT 1 FROM gt_jobs WHERE id=? AND token=?) ON CONFLICT(account,date) DO UPDATE SET revision=excluded.revision,status=excluded.status,payload=excluded.payload`,account,date,job.revision,payload.payload,job.id,token),
  ]);
  return {status:result[2].meta.changes?'confirmed':'revision-changed'};
}
export async function retainDaily(db,account,today) {
  const cutoff=new Date(Date.parse(today)-364*86400000).toISOString().slice(0,10);
  const baseline=await read(db,"SELECT max(date) date FROM gt_daily WHERE account=? AND date<? AND status='confirmed'",account,cutoff);
  await db.batch([
    q(db,'DELETE FROM gt_positions WHERE job IN (SELECT id FROM gt_jobs WHERE account=? AND date<? AND date<>?)',account,cutoff,baseline?.date||''),
    q(db,'DELETE FROM gt_jobs WHERE account=? AND date<? AND date<>?',account,cutoff,baseline?.date||''),
    q(db,'DELETE FROM gt_daily WHERE account=? AND date<? AND date<>?',account,cutoff,baseline?.date||''),
    q(db,'DELETE FROM gt_archive WHERE account=? AND date<? AND date<>?',account,cutoff,baseline?.date||''),
  ]);
}
