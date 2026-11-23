import {digest,tradeSignature} from './import-format.mjs';
import {normalizeTrade,validMetadata,validSnapshot,mockTrade} from './validation.mjs';
import {read,all,run,statement as q} from './storage.mjs';
const json=Response.json;
const owns=(db,account,id)=>read(db,'SELECT * FROM gt_imports WHERE id=? AND account=?',id,account);
export async function migrationRoute(request,db,account,path,body) {
  if(path==='/import/start'){
    if(!/^[a-f0-9]{64}$/.test(body.sourceHash||'') || !/^[a-f0-9]{64}$/.test(body.root||'') || !Number.isInteger(body.parts) || body.parts<1 || body.parts>1024 || !Number.isInteger(body.trades) || body.trades<1 || body.trades>1000 || !Number.isInteger(body.snapshots) || body.snapshots<0 || body.snapshots>366 || typeof body.hasHistory!=='boolean')return json({error:'Invalid manifest'},{status:422});
    await db.batch([q(db,'INSERT OR IGNORE INTO gt_accounts(id) VALUES(?)',account),q(db,'INSERT OR IGNORE INTO gt_imports(id,account,source_hash,root,parts,trade_count,snapshot_count,has_history) VALUES(?,?,?,?,?,?,?,?)',crypto.randomUUID(),account,body.sourceHash,body.root,body.parts,body.trades,body.snapshots,+body.hasHistory)]);
    const m=await read(db,'SELECT * FROM gt_imports WHERE account=? AND source_hash=?',account,body.sourceHash);
    if(m.root!==body.root || m.parts!==body.parts || m.trade_count!==body.trades || m.snapshot_count!==body.snapshots || !!m.has_history!==body.hasHistory)return json({error:'Manifest conflict'},{status:409});
    await run(db,'INSERT OR IGNORE INTO gt_validation(generation) VALUES(?)',m.id);
    return json({id:m.id,nextPart:m.next_part,status:m.status});
  }
  const m=path==='/import/verify'?await read(db,`SELECT m.*,v.cursor validated_cursor,p.payload next_payload,p.number part_number FROM gt_imports m LEFT JOIN gt_validation v ON v.generation=m.id LEFT JOIN gt_parts p ON p.generation=m.id AND p.number=COALESCE(v.cursor,0) WHERE m.account=? AND m.id=?`,account,body.id):await owns(db,account,body.id);
  if(!m)return json({error:'Import not found'},{status:404});
  if(path==='/import/part' && request.method==='GET'){
    const row=await read(db,'SELECT payload FROM gt_parts WHERE generation=? AND number=?',m.id,body.number);
    return row?new Response(row.payload,{headers:{'content-type':'application/json'}}):json({error:'Part not found'},{status:404});
  }
  if(path==='/import/part'){
    if(!Number.isInteger(body.number) || body.number<0 || body.number>=m.parts || typeof body.text!=='string' || new TextEncoder().encode(body.text).length>24000)return json({error:'Invalid part'},{status:422});
    const hash=await digest(body.text);
    const prior=await read(db,'SELECT hash FROM gt_parts WHERE generation=? AND number=?',m.id,body.number);
    if(prior)return prior.hash===hash?json({duplicate:true,nextPart:m.next_part}):json({error:'Part conflict'},{status:409});
    if(m.status!=='uploading' || m.next_part!==body.number)return json({error:'Part order conflict'},{status:409});
    let p;try{p=JSON.parse(body.text);if(!['metadata','trades','legacy-header','legacy-snapshot','legacy-ledger'].includes(p.kind))throw Error();}catch{return json({error:'Invalid segment envelope'},{status:422});}
    const nextChain=await digest(m.chain+':'+hash), token=crypto.randomUUID();
    const result=await db.batch([q(db,"UPDATE gt_imports SET next_part=next_part+1,chain=?,token=? WHERE id=? AND next_part=? AND status='uploading'",nextChain,token,m.id,body.number),q(db,'INSERT OR IGNORE INTO gt_parts SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM gt_imports WHERE id=? AND token=?)',m.id,body.number,hash,p.kind,body.text,m.id,token)]);
    return result[0].meta.changes?json({nextPart:body.number+1}):json({error:'Concurrent upload; retry'},{status:409});
  }
  if(path==='/import/verify'){
    if(m.status==='active' || m.status==='verified')return json({verified:true,duplicate:true});
    if(m.next_part!==m.parts || m.chain!==m.root)return json({error:'Incomplete or inconsistent upload'},{status:422});
    const progress={cursor:m.validated_cursor||0};
    if(progress.cursor<m.parts){
      const part={number:m.part_number,payload:m.next_payload};
      const p=JSON.parse(part.payload),token=crypto.randomUUID(),writes=[];
    try{
      if(p.kind==='trades'){
        if(!Number.isInteger(p.offset) || !Array.isArray(p.rows) || !p.rows.length || p.rows.length>10)throw Error();
        const count=await read(db,'SELECT count(*) n FROM gt_trades WHERE generation=?',m.id);
        if(p.offset!==count.n || count.n+p.rows.length>m.trade_count)throw Error();
        for(const [i,t] of p.rows.entries()){
          const normalized=normalizeTrade(t);
          if(JSON.stringify(t)!==JSON.stringify(normalized) || !mockTrade(t))throw Error();

        }
        const currencies=new Map();for(const t of p.rows){if(currencies.has(t.tc) && currencies.get(t.tc)!==t.cur)throw Error();currencies.set(t.tc,t.cur);}
        if(await read(db,`SELECT t.id FROM gt_trades t JOIN json_each(?) j ON t.tc=json_extract(j.value,'$.tc') WHERE t.generation=? AND t.cur<>json_extract(j.value,'$.cur') LIMIT 1`,JSON.stringify(p.rows),m.id))throw Error();
        const ids=new Set(p.rows.map(t=>t.id));if(ids.size!==p.rows.length)throw Error();
        writes.push(q(db,`INSERT INTO gt_trades SELECT ?,?,json_extract(value,'$.t.id'),?+CAST(key AS INTEGER),json_extract(value,'$.t.date'),json_extract(value,'$.t.ts'),json_extract(value,'$.t.tc'),json_extract(value,'$.t.cur'),json_extract(value,'$.signature'),json_extract(value,'$.t') FROM json_each(?) WHERE EXISTS(SELECT 1 FROM gt_validation WHERE generation=? AND token=?)`,account,m.id,p.offset,JSON.stringify(p.rows.map(t=>({t,signature:tradeSignature(t)}))),m.id,token));
        if((await all(db,'SELECT id FROM gt_trades WHERE generation=? AND id IN (SELECT json_extract(value,\'$.id\') FROM json_each(?))',m.id,JSON.stringify(p.rows))).length)throw Error();
      } else if(p.kind==='metadata'){
        if(part.number!==0 || !validMetadata(p.value))throw Error();
      } else if(p.kind==='legacy-header'){
        if(!m.has_history || p.value?.schema!==1 || p.value.complete!==true || (p.value.anchor!=null && !validSnapshot(p.value.anchor)) || await read(db,"SELECT number FROM gt_parts WHERE generation=? AND kind='legacy-header' AND number<>?",m.id,part.number))throw Error();
      } else if(p.kind==='legacy-snapshot'){
        if(!m.has_history || !Number.isInteger(p.index) || p.index<0 || p.index>=m.snapshot_count || !validSnapshot(p.value) || await read(db,"SELECT number FROM gt_parts WHERE generation=? AND kind='legacy-snapshot' AND number<>? AND (json_extract(payload,'$.index')=? OR json_extract(payload,'$.value.date')=?)",m.id,part.number,p.index,p.value.date))throw Error();
      } else if(p.kind==='legacy-ledger'){
        if(!m.has_history || !Number.isInteger(p.offset) || !Array.isArray(p.rows) || !p.rows.length || p.rows.length>20)throw Error();
        const valid=await read(db,`SELECT count(*) n FROM json_each(?) j JOIN gt_trades t ON t.generation=? AND t.ordinal=?+CAST(j.key AS INTEGER) AND t.id=json_extract(j.value,'$.id') AND t.date=json_extract(j.value,'$.date') AND t.signature=json_extract(j.value,'$.signature')`,JSON.stringify(p.rows),m.id,p.offset);
        if(valid.n!==p.rows.length)throw Error();
        const count=await read(db,"SELECT COALESCE(sum(json_array_length(payload,'$.rows')),0) n FROM gt_parts WHERE generation=? AND kind='legacy-ledger' AND number<?",m.id,part.number);
        if(count.n!==p.offset)throw Error();
      } else throw Error();
    }catch{return json({error:'Invalid or conflicting segment'},{status:422});}

      const result=await db.batch([q(db,'UPDATE gt_validation SET cursor=cursor+1,token=? WHERE generation=? AND cursor=?',token,m.id,progress.cursor),...writes]);
      return result[0].meta.changes?json({verifying:true,validatedParts:progress.cursor+1,totalParts:m.parts}):json({verifying:true,retry:true});
    }
    const counts=await read(db,`SELECT (SELECT count(*) FROM gt_trades WHERE generation=?) trades, sum(kind='metadata') metadata, sum(kind='legacy-header') header, sum(kind='legacy-snapshot') snapshots, COALESCE(sum(CASE WHEN kind='legacy-ledger' THEN json_array_length(payload,'$.rows') ELSE 0 END),0) ledger FROM gt_parts WHERE generation=?`,m.id,m.id);
    const stocks=await read(db,'SELECT count(DISTINCT tc) n FROM gt_trades WHERE generation=?',m.id);
    if(m.next_part!==m.parts || m.chain!==m.root || counts.trades!==m.trade_count || counts.metadata!==1 || counts.snapshots!==m.snapshot_count || (m.has_history?(counts.header!==1 || counts.ledger!==m.trade_count):(counts.header!==0 || counts.ledger!==0 || counts.snapshots!==0)) || stocks.n>50)return json({error:'Incomplete or inconsistent import'},{status:422});
    const badOrder=await read(db,`SELECT 1 bad FROM gt_parts p,json_each(p.payload,'$.value.positionOrder') j WHERE p.generation=? AND p.kind='metadata' AND NOT EXISTS(SELECT 1 FROM gt_trades t WHERE t.generation=p.generation AND t.tc=j.value) LIMIT 1`,m.id);
    if(badOrder)return json({error:'Position order does not match ledger'},{status:422});
    await run(db,"UPDATE gt_imports SET status='verified' WHERE id=? AND status='uploading'",m.id);
    return json({verified:true,trades:counts.trades,snapshots:counts.snapshots});
  }
  if(path==='/import/activate'){
    const current=await read(db,'SELECT generation,revision FROM gt_accounts WHERE id=?',account);
    if(current.generation===m.id)return json({active:true,duplicate:true,revision:current.revision});
    if(current.generation || m.status!=='verified' || body.root!==m.root)return json({error:'Account occupied or import not verified'},{status:409});
    const result=await db.batch([q(db,`UPDATE gt_accounts SET generation=?,metadata=(SELECT json_extract(payload,'$.value') FROM gt_parts WHERE generation=? AND kind='metadata'),revision=1 WHERE id=? AND generation IS NULL`,m.id,m.id,account),q(db,"UPDATE gt_imports SET status='active' WHERE id=? AND EXISTS(SELECT 1 FROM gt_accounts WHERE id=? AND generation=?)",m.id,account,m.id)]);
    return result[0].meta.changes?json({active:true,revision:1}):json({error:'Activation conflict'},{status:409});
  }
  return json({error:'Unknown import route'},{status:404});
}
