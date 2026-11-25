import {ledgerRoute} from './ledger-routes.mjs';
import {dailyStep,retainDaily} from './daily.mjs';
import {read,all,statement as q} from './storage.mjs';
import {validDate} from './validation.mjs';
const authorized=(r,s)=>typeof s==='string' && s.length>=10 && r.headers.get('authorization')==='Bearer '+s;
const response=(data,status=200)=>Response.json(data,{status});
export default {
  async fetch(request,env) {
    if(env.VALIDATION_MODE!=='mock-only')return response({error:'Mock validation disabled'},503);
    const url=new URL(request.url), path=url.pathname;
    if(!['GET','POST'].includes(request.method))return response({error:'Method not allowed'},405);
    let b={};
    if(path.startsWith('/validation/') && request.method==='POST'){
      const text=await request.text();if(new TextEncoder().encode(text).length>32000)return response({error:'Request too large'},413);
      try{b=JSON.parse(text);if(!b || typeof b!=='object' || Array.isArray(b))throw Error();}catch{return response({error:'Invalid JSON'},400);}
    }
    const db=env.DB;
    if(path.startsWith('/validation/')){
      if(!authorized(request,env.TEST_ADMIN_TOKEN))return response({error:'Admin authorization required'},401);
      if(path==='/validation/status')return response({version:'backend v0.3.3',jobs:await all(db,'SELECT account,date,phase,revision,previous_date FROM gt_jobs ORDER BY account,date'),control:await all(db,'SELECT * FROM gt_control')});
      if(path==='/validation/step' && request.method==='POST'){
        if(!['alice','bob'].includes(b.account) || !validDate(b.date))return response({error:'Invalid job'},422);
        return response(await dailyStep(db,b.account,b.date));
      }
      if(path==='/validation/retain' && request.method==='POST'){
        if(!['alice','bob'].includes(b.account) || !validDate(b.date))return response({error:'Invalid retention'},422);
        await retainDaily(db,b.account,b.date);return response({retained:true});
      }
      if(path==='/validation/seed' && request.method==='POST'){
        if(!validDate(b.date) || !Array.isArray(b.symbols) || b.symbols.length>50 || b.symbols.some(tc=>! /^(sh|hk|us)100\d{3}$/.test(tc)) || !Number.isFinite(b.price) || b.price<=0)return response({error:'Synthetic prices required'},422);
        const writes=[q(db,'DELETE FROM gt_prices WHERE date=?',b.date),...[...new Set(b.symbols.filter(tc=>tc!==b.missing))].map(tc=>q(db,'INSERT INTO gt_prices VALUES(?,?,?,?)',b.date,tc,b.price,b.finalized===false?0:1))];
        writes.push(b.noFx?q(db,'DELETE FROM gt_rates WHERE date=?',b.date):q(db,'INSERT INTO gt_rates VALUES(?,?) ON CONFLICT(date) DO UPDATE SET payload=excluded.payload',b.date,JSON.stringify({USDCNY:7,HKDCNY:0.9})));
        if(b.schedule)writes.push(q(db,"INSERT INTO gt_control VALUES('valuation-date',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",b.date));
        // Restart valuation fragments if providers are replenished; confirmed records stay frozen.
        writes.push(q(db,"UPDATE gt_jobs SET phase='value',cursor='',token=NULL WHERE date=? AND phase IN ('value','finalize')",b.date));
        await db.batch(writes);return response({seeded:true});
      }
      return response({error:'Unknown validation route'},404);
    }
    const account=authorized(request,env.TEST_ALICE_TOKEN)?'alice':authorized(request,env.TEST_BOB_TOKEN)?'bob':null;
    if(!account)return response({error:'Test account authorization required'},401);
    return ledgerRoute(request,env,account);
  },
  async scheduled(controller,env) {
    if(env.VALIDATION_MODE!=='mock-only')return;
    const clock=await read(env.DB,"SELECT value FROM gt_control WHERE key='valuation-date'");if(!clock)return;
    const last=await read(env.DB,"SELECT value FROM gt_control WHERE key='last-account'");
    const sql=`SELECT a.id FROM gt_accounts a WHERE a.generation IS NOT NULL AND a.id>? AND NOT EXISTS(SELECT 1 FROM gt_daily d WHERE d.account=a.id AND d.date=? AND d.status='confirmed') ORDER BY a.id LIMIT 1`;
    const account=await read(env.DB,sql,last?.value||'',clock.value)||await read(env.DB,sql,'',clock.value);
    if(!account)return;
    const result=await dailyStep(env.DB,account.id,clock.value);
    await env.DB.batch([q(env.DB,"INSERT INTO gt_control VALUES('last-account',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",account.id),q(env.DB,"INSERT INTO gt_control VALUES('last-scheduled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify({account:account.id,date:clock.value,result,scheduledTime:controller.scheduledTime,cron:controller.cron}))]);
  },
};
