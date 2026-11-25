// Shared mock ledger routes. The caller supplies an already verified owner;
// request fields and test credentials can never select that owner here.
import {migrationRoute} from './migration.mjs';
import {operation} from './operations.mjs';
import {read} from './storage.mjs';
import {validDate} from './validation.mjs';
const response=(data,status=200)=>Response.json(data,{status});
const jsonText=text=>new Response(text,{headers:{'content-type':'application/json'}});
export async function ledgerRoute(request,env,account) {
  if(env.VALIDATION_MODE!=='mock-only')return response({error:'Mock validation disabled'},503);
  const url=new URL(request.url),path=url.pathname,db=env.DB;
  if(!['GET','POST'].includes(request.method))return response({error:'Method not allowed'},405);
  let b={};
  if(request.method==='POST'){
    const text=await request.text();if(new TextEncoder().encode(text).length>32000)return response({error:'Request too large'},413);
    try{b=JSON.parse(text);if(!b||typeof b!=='object'||Array.isArray(b))throw Error();}catch{return response({error:'Invalid JSON'},400);}
  }else if(path==='/import/part')b={id:url.searchParams.get('id'),number:Number(url.searchParams.get('number'))};
  if(path.startsWith('/import/')){
    if((path!=='/import/part' || request.method!=='GET') && request.method!=='POST')return response({error:'POST required'},405);
    return migrationRoute(request,db,account,path,b);
  }
  if(path==='/meta' && request.method==='GET'){
    const row=await read(db,"SELECT json_object('revision',revision,'generation',generation,'state',json(metadata)) payload FROM gt_accounts WHERE id=? AND generation IS NOT NULL",account);
    return row?jsonText(row.payload):response({revision:0,generation:null,state:null});
  }
  if(path==='/history' && request.method==='GET'){
    const after=url.searchParams.get('after')||'';
    if(after && !validDate(after))return response({error:'Invalid history cursor'},422);
    // Version and points come from one query, so a concurrent retroactive
    // edit cannot pair an old revision with newly invalidated history.
    const row=await read(db,`SELECT json_object('revision',a.revision,'next',COALESCE((SELECT max(date) FROM (SELECT date FROM gt_daily WHERE account=a.id AND date>? ORDER BY date LIMIT 20)),?),'points',json((SELECT COALESCE(json_group_array(json_set(payload,'$.status',status)),'[]') FROM (SELECT payload,status FROM gt_daily WHERE account=a.id AND date>? ORDER BY date LIMIT 20)))) payload FROM gt_accounts a WHERE a.id=?`,after,after,after,account);
    return row?jsonText(row.payload):response({revision:0,next:after,points:[]});
  }
  if(path==='/state' && request.method==='GET'){
    const a=await read(db,'SELECT generation,revision FROM gt_accounts WHERE id=?',account);
    if(!a?.generation)return response({revision:0,state:null,legacyHistory:null,confirmedHistory:[]});
    const row=await read(db,`SELECT json_object('revision',a.revision,'generation',a.generation,'state',json_patch(json(a.metadata),json_object('trades',json((SELECT json_group_array(json(payload)) FROM (SELECT payload FROM gt_trades WHERE account=a.id AND generation=a.generation ORDER BY ordinal))))),'confirmedHistory',json((SELECT COALESCE(json_group_array(json_set(payload,'$.status',status)),'[]') FROM (SELECT payload,status FROM gt_daily WHERE account=a.id ORDER BY date)))) payload FROM gt_accounts a WHERE a.id=?`,account);
    return jsonText(row.payload);
  }
  if(path==='/trades' && request.method==='GET'){
    const after=Number(url.searchParams.get('after')||-1);
    if(!Number.isInteger(after)||after< -1)return response({error:'Invalid cursor'},422);
    const row=await read(db,`SELECT json_object('revision',a.revision,'next',COALESCE((SELECT max(ordinal) FROM (SELECT ordinal FROM gt_trades WHERE account=a.id AND generation=a.generation AND ordinal>? ORDER BY ordinal LIMIT 20)),?),'trades',json((SELECT COALESCE(json_group_array(json(payload)),'[]') FROM (SELECT payload FROM gt_trades WHERE account=a.id AND generation=a.generation AND ordinal>? ORDER BY ordinal LIMIT 20)))) payload FROM gt_accounts a WHERE a.id=?`,after,after,after,account);
    return row?jsonText(row.payload):response({revision:0,next:after,trades:[]});
  }
  if(path==='/operation' && request.method==='POST'){const r=await operation(db,account,b);return response(r.body,r.status);}
  return response({error:'Unknown route'},404);
}
