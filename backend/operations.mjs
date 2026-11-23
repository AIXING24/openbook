import {digest,tradeSignature} from './import-format.mjs';
import {normalizeTrade,validMetadata,mockTrade} from './validation.mjs';
import {read,statement as q} from './storage.mjs';
export async function operation(db,account,b) {
  if(typeof b.id!=='string' || !b.id || b.id.length>200 || !Number.isInteger(b.expectedRevision) || !['upsert-trade','delete-trade','preferences'].includes(b.kind))return {status:422,body:{error:'Invalid operation'}};
  const hash=await digest(JSON.stringify({kind:b.kind,trade:b.trade,tradeId:b.tradeId,preferences:b.preferences}));
  const prior=await read(db,'SELECT hash,revision FROM gt_operations WHERE account=? AND id=?',account,b.id);
  if(prior)return prior.hash===hash?{status:200,body:{duplicate:true,revision:prior.revision}}:{status:409,body:{error:'Operation ID reused'}};
  const a=await read(db,'SELECT generation,revision FROM gt_accounts WHERE id=?',account);
  if(!a?.generation || a.revision!==b.expectedRevision)return {status:409,body:{error:'Revision conflict'}};
  const revision=a.revision+1, writes=[],old=await read(db,'SELECT id,date,ordinal FROM gt_trades WHERE generation=? AND id=?',a.generation,b.trade?.id||b.tradeId||'');
  const guard='EXISTS(SELECT 1 FROM gt_accounts WHERE id=? AND revision=? AND last_operation=?)';
  let since=null;
  if(b.kind==='upsert-trade'){
    let t;try{t=normalizeTrade(b.trade);if(!mockTrade(t))throw Error();}catch{return {status:422,body:{error:'Synthetic valid trade required'}};}
    if(await read(db,'SELECT id FROM gt_trades WHERE generation=? AND tc=? AND cur<>? AND id<>? LIMIT 1',a.generation,t.tc,t.cur,t.id))return {status:422,body:{error:'Currency conflict'}};
    const count=await read(db,'SELECT count(*) n,count(DISTINCT tc) symbols,COALESCE(max(ordinal),-1)+1 ordinal FROM gt_trades WHERE generation=?',a.generation);
    if((!old && count.n>=100000) || (count.symbols>=50 && !await read(db,'SELECT id FROM gt_trades WHERE generation=? AND tc=? LIMIT 1',a.generation,t.tc)))return {status:422,body:{error:'Validation capacity exceeded'}};
    writes.push(q(db,`INSERT INTO gt_trades SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(generation,id) DO UPDATE SET date=excluded.date,ts=excluded.ts,tc=excluded.tc,cur=excluded.cur,signature=excluded.signature,payload=excluded.payload`,account,a.generation,t.id,old?.ordinal??count.ordinal,t.date,t.ts,t.tc,t.cur,tradeSignature(t),JSON.stringify(t),account,revision,b.id));
    since=[old?.date,t.date].filter(Boolean).sort()[0];
  } else if(b.kind==='delete-trade'){
    if(typeof b.tradeId!=='string')return {status:422,body:{error:'Trade ID required'}};
    writes.push(q(db,`DELETE FROM gt_trades WHERE generation=? AND id=? AND ${guard}`,a.generation,b.tradeId,account,revision,b.id));since=old?.date||null;
  } else {
    if(!validMetadata(b.preferences))return {status:422,body:{error:'Complete valid metadata required'}};
    writes.push(q(db,`UPDATE gt_accounts SET metadata=? WHERE generation=? AND ${guard}`,JSON.stringify(b.preferences),a.generation,account,revision,b.id));
  }
  if(since)writes.push(q(db,`UPDATE gt_daily SET status='invalidated',payload=json_set(payload,'$.invalidatedAt',?) WHERE account=? AND date>=? AND ${guard}`,since,account,since,account,revision,b.id));
  writes.push(q(db,`UPDATE gt_accounts SET metadata=json_set(metadata,'$.positionOrder',json(CASE WHEN json_array_length(metadata,'$.positionOrder')=0 THEN '[]' ELSE (SELECT json_group_array(tc) FROM (SELECT j.value tc,CAST(j.key AS INTEGER) n FROM json_each(gt_accounts.metadata,'$.positionOrder') j WHERE EXISTS(SELECT 1 FROM gt_trades t WHERE t.generation=gt_accounts.generation AND t.tc=j.value) UNION ALL SELECT t.tc,100000+min(t.ordinal) n FROM gt_trades t WHERE t.generation=gt_accounts.generation AND t.tc NOT IN (SELECT value FROM json_each(gt_accounts.metadata,'$.positionOrder')) GROUP BY t.tc ORDER BY n)) END)) WHERE generation=? AND ${guard}`,a.generation,account,revision,b.id));
  const result=await db.batch([
    q(db,'UPDATE gt_accounts SET revision=?,last_operation=? WHERE id=? AND revision=?',revision,b.id,account,a.revision),
    ...writes,
    q(db,`INSERT OR IGNORE INTO gt_operations SELECT ?,?,?,? WHERE ${guard}`,account,b.id,hash,revision,account,revision,b.id),
  ]);
  if(result[0].meta.changes)return {status:200,body:{revision}};
  const retry=await read(db,'SELECT hash,revision FROM gt_operations WHERE account=? AND id=?',account,b.id);
  return retry?.hash===hash?{status:200,body:{duplicate:true,revision:retry.revision}}:{status:409,body:{error:'Concurrent revision conflict'}};
}
