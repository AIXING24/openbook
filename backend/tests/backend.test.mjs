import test from 'node:test';
import assert from 'node:assert/strict';
import {runtime,fixture,old,packImport,upload,finishDate} from './runtime.mjs';
import {emptyPosition,applyTrade} from '../valuation.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<=Math.max(1e-6,Math.abs(b)*1e-10),`${a} != ${b}`);
function compareSnapshot(actual,expected) {
  for(const c of ['CNY','USD','HKD']){near(actual.amounts[c].realized,expected.amounts[c].realized);near(actual.amounts[c].unrealized,expected.amounts[c].unrealized);near(actual.purchases[c],expected.purchases[c]);}
  const sort=rows=>rows.slice().sort((a,b)=>a.tc.localeCompare(b.tc));
  const a=sort(actual.positions),b=sort(expected.positions);assert.equal(a.length,b.length);
  a.forEach((p,i)=>{assert.equal(p.tc,b[i].tc);for(const k of ['shares','cost','px'])near(p[k],b[i][k]);});
  near(old.PnlHistory.percentage(actual,'USD'),old.PnlHistory.percentage(expected,'USD'));
}
const reference=(trades,date,price=115)=>{const stamp=Date.parse(date+'T23:59:00+08:00');return old.PnlHistory.buildSnapshot(trades,Object.fromEntries(trades.map(t=>[t.tc,{px:price,ts:stamp}])),{USDCNY:7,HKDCNY:0.9,ts:stamp},{now:stamp,startedAt:stamp}).snapshot;};
test('streaming ledger matches established long/short/fees/dividend accounting across page splits',()=>{
  const source=[['B',100,10,.5],['S',110,15,.7],['B',90,7,.4],['D',0,0,0,3],['S',105,2,.2],['D',0,0,0,5],['S',90,2,.1],['D',0,0,0,2],['B',85,5,.3]];
  const rows=source.map(([side,px,qty,fee,amt],i)=>({id:String(i),date:'2026-11-10',ts:i,tc:'us100000',cur:'USD',mkt:'us',side,px,qty,fee,...(amt?{amt}:{})}));
  const p=emptyPosition('USD');for(const t of rows)applyTrade(p,t);const expected=old.Core.calcPositions(rows)[0];
  for(const k of ['shares','cost','avg','realized','dividend'])near(p[k],expected[k]);
});
test('normalized migration, durable daily jobs and historical invariants',async t=>{
  const r=await runtime();t.after(()=>r.close());const backup=await fixture();const prepared=old.prepareImport(backup),packed=await packImport(backup,prepared);
  let migration;
  await t.test('inactive import, isolation, hash conflicts and resumable ordered parts',async()=>{
    migration=(await r.call('alice','/import/start',packed.manifest)).body.id;
    assert.equal((await r.call('alice','/state')).body.state,null);
    assert.equal((await r.call('bob','/import/part',{id:migration,number:0,text:packed.texts[0]})).status,404);
    assert.equal((await r.call('alice','/import/part',{id:migration,number:1,text:packed.texts[1]})).status,409);
    assert.equal((await r.call('alice','/import/part',{id:migration,number:0,text:packed.texts[0]})).status,200);
    assert.equal((await r.call('alice','/import/part',{id:migration,number:0,text:packed.texts[0]})).body.duplicate,true);
    assert.equal((await r.call('alice','/import/part',{id:migration,number:0,text:packed.texts[0]+' '})).status,409);
    assert.equal((await r.call('alice','/import/start',packed.manifest)).body.nextPart,1);
    assert.equal((await r.call('alice','/import/activate',{id:migration,root:packed.manifest.root})).status,409);
  });
  await t.test('1000 trades/50 stocks verify, preserve raw history and metadata before activation',async()=>{
    const uploaded=await upload(r,'alice',backup,{activate:false});assert.equal(uploaded.id,migration);
    assert.equal((await r.call('alice','/state')).body.state,null);
    const result=await r.call('alice','/import/activate',{id:migration,root:packed.manifest.root});assert.equal(result.status,200);
    const stateResult=await r.call('alice','/state');assert.equal(stateResult.status,200,JSON.stringify(stateResult.body));const state=stateResult.body;assert.deepEqual(state.state,JSON.parse(JSON.stringify(prepared.state)));
    assert.ok(old.Core.calcPositions(state.state.trades).some(p=>p.shares===0));
    assert.equal((await r.call('alice','/import/activate',{id:migration,root:packed.manifest.root})).body.duplicate,true);
    const second=await fixture(100,10);const id=(await upload(r,'alice',second,{activate:false})).id;
    assert.equal((await r.call('alice','/import/activate',{id,root:(await packImport(second,old.prepareImport(second))).manifest.root})).status,409);
    await upload(r,'bob',second);assert.equal((await r.call('bob','/state')).body.state.trades.length,100);
  });
  await t.test('partial daily job stays invisible; duplicate/concurrent fragments do not double count',async()=>{
    await r.call('admin','/validation/seed',{date:'2026-11-15',symbols:[...new Set(backup.trades.map(t=>t.tc))],price:115});
    assert.equal((await r.call('admin','/validation/step',{account:'alice',date:'2026-11-15'})).body.status,'started');
    await Promise.all([r.call('admin','/validation/step',{account:'alice',date:'2026-11-15'}),r.call('admin','/validation/step',{account:'alice',date:'2026-11-15'})]);
    assert.equal((await r.call('alice','/state')).body.confirmedHistory.length,0);
    const log=await finishDate(r,'alice','2026-11-15');assert.equal(log.at(-1).status,'confirmed');assert.ok(log.every(x=>!x.processed || x.processed<=10));
    const point=(await r.call('alice','/state')).body.confirmedHistory[0];compareSnapshot(point,reference(backup.trades,'2026-11-15'));
    assert.equal((await finishDate(r,'alice','2026-11-15'))[0].status,'already-confirmed');
  });
  await t.test('next date reuses cumulative positions instead of rereading all trades',async()=>{
    await r.call('admin','/validation/seed',{date:'2026-11-16',symbols:[...new Set(backup.trades.map(t=>t.tc))],price:115});
    const log=await finishDate(r,'alice','2026-11-16');assert.equal(log[0].previousDate,'2026-11-15');assert.equal(log.filter(x=>x.phase==='apply').length,0);
    const point=(await r.call('alice','/state')).body.confirmedHistory.at(-1);compareSnapshot(point,reference(backup.trades,'2026-11-16'));
  });
  const edit={...prepared.state.trades[0],id:'new-synthetic',date:'2026-11-17',qty:3,ts:2001};let revision=1;
  await t.test('lost responses, duplicate IDs and competing devices preserve one ledger operation',async()=>{
    const b={id:'lost-operation',kind:'upsert-trade',expectedRevision:revision,trade:edit};const concurrent=await Promise.all([r.call('alice','/operation',b),r.call('alice','/operation',b)]);assert.ok(concurrent.every(x=>x.status===200),JSON.stringify(concurrent));revision=2;
    assert.equal((await r.call('alice','/operation',b)).body.duplicate,true);
    assert.equal((await r.call('alice','/operation',{...b,trade:{...edit,px:101}})).status,409);
    assert.equal((await r.call('alice','/operation',{...b,id:'stale-device'})).status,409);
    assert.equal((await r.call('alice','/state')).body.state.trades.filter(t=>t.id===edit.id).length,1);
    const before=(await r.call('alice','/state')).body.confirmedHistory;
    assert.ok(before.every(p=>p.status==='confirmed'));
    assert.equal((await finishDate(r,'alice','2026-11-15'))[0].status,'already-confirmed');
    const after=(await r.call('alice','/state')).body.confirmedHistory;assert.deepEqual(after,before);
    const {trades,...preferences}=(await r.call('alice','/state')).body.state;
    const race=await Promise.all(['device-1','device-2'].map(id=>r.call('alice','/operation',{id,expectedRevision:revision,kind:'preferences',preferences})));assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);revision++;
  });
  await t.test('backdated correction restarts an in-flight job, invalidates only affected days and archives old points',async()=>{
    const trade={...prepared.state.trades[0],px:98};assert.equal((await r.call('alice','/operation',{id:'backdated',expectedRevision:revision,kind:'upsert-trade',trade})).status,200);revision++;
    assert.ok((await r.call('alice','/state')).body.confirmedHistory.every(p=>p.status==='invalidated' && old.PnlHistory.value(p,'USD')===null));
    await finishDate(r,'alice','2026-11-15');
    const state=(await r.call('alice','/state')).body;compareSnapshot(state.confirmedHistory[0],reference(state.state.trades,'2026-11-15'));
    assert.equal((await r.db.prepare('SELECT count(*) n FROM gt_archive').first()).n,1);
    await r.call('admin','/validation/seed',{date:'2026-11-17',symbols:[...new Set(backup.trades.map(t=>t.tc))],price:115});
    await r.call('admin','/validation/step',{account:'alice',date:'2026-11-17'});
    assert.equal((await r.call('alice','/operation',{id:'mid-job',expectedRevision:revision,kind:'delete-trade',tradeId:edit.id})).status,200);revision++;
    const log=await finishDate(r,'alice','2026-11-17');assert.equal(log[0].status,'started');
    const final=(await r.call('alice','/state')).body;compareSnapshot(final.confirmedHistory.at(-1),reference(final.state.trades,'2026-11-17'));
  });
  await t.test('missing/unfinalized prices and historical FX remain pending; replenish resumes safely',async()=>{
    const symbols=[...new Set(backup.trades.map(t=>t.tc))];const open=old.Core.calcPositions((await r.call('alice','/state')).body.state.trades).find(p=>p.shares!==0).tc;
    for(const condition of [{missing:open},{finalized:false},{noFx:true}]){
      await r.call('admin','/validation/seed',{date:'2026-11-18',symbols,price:115,...condition});
      const log=await finishDate(r,'alice','2026-11-18');assert.equal(log.at(-1).status,'pending');assert.equal((await r.call('alice','/state')).body.confirmedHistory.some(p=>p.date==='2026-11-18'),false);
    }
    await r.call('admin','/validation/seed',{date:'2026-11-18',symbols,price:115});await finishDate(r,'alice','2026-11-18');assert.equal((await r.call('alice','/state')).body.confirmedHistory.at(-1).status,'confirmed');
  });
  await t.test('scheduled handler advances without browser reads or manual daily calls',async()=>{
    await r.call('admin','/validation/seed',{date:'2026-11-19',symbols:[...new Set(backup.trades.map(t=>t.tc))],price:115,schedule:true});
    const worker=await r.mf.getWorker();for(let i=0;i<60;i++)await worker.scheduled({scheduledTime:Date.now(),cron:'* * * * *'});
    assert.ok((await r.call('alice','/state')).body.confirmedHistory.some(p=>p.date==='2026-11-19' && p.status==='confirmed'));
    assert.ok((await r.call('bob','/state')).body.confirmedHistory.some(p=>p.date==='2026-11-19' && p.status==='confirmed'));
  });
  await t.test('365 calendar days plus baseline retention leaves all trades and closed realized P&L',async()=>{
    const point=(await r.call('alice','/state')).body.confirmedHistory.at(-1);
    for(const date of ['2025-01-01','2025-11-18','2025-11-19','2025-11-20'])await r.db.prepare("INSERT INTO gt_daily VALUES('alice',?,1,'confirmed',?)").bind(date,JSON.stringify({...point,date})).run();
    await r.call('admin','/validation/retain',{account:'alice',date:'2026-11-19'});
    const state=(await r.call('alice','/state')).body;assert.equal(state.state.trades.length,1000);assert.equal(state.confirmedHistory[0].date,'2025-11-19');assert.equal(state.confirmedHistory[1].date,'2025-11-20');
  });
  await t.test('tampered manifests, invalid trade values and mismatched legacy ledger never activate',async()=>{
    const clone=value=>JSON.parse(JSON.stringify(value));
    for(const invalid of ['root','trade','ledger','snapshot']){
      const bad=clone(backup),badPrepared=clone(prepared);bad.lastBackup=invalid.length+100;
      if(invalid==='trade')badPrepared.state.trades[0].qty=-1;
      if(invalid==='ledger')badPrepared.history.ledger[0].signature='changed';
      if(invalid==='snapshot')badPrepared.history.snapshots[0].amounts.CNY.unrealized+=100;
      const packedBad=await packImport(bad,badPrepared);if(invalid==='root')packedBad.manifest.root='a'.repeat(64);
      const start=await r.call('bob','/import/start',packedBad.manifest);assert.equal(start.status,200);const id=start.body.id;
      let rejected=false;
      for(let n=0;n<packedBad.texts.length;n++){const result=await r.call('bob','/import/part',{id,number:n,text:packedBad.texts[n]});if(result.status!==200){assert.equal(result.status,422);rejected=true;break;}}
      if(!rejected){for(let n=0;n<packedBad.texts.length+2;n++){const result=await r.call('bob','/import/verify',{id});if(result.status===422){rejected=true;break;}assert.equal(result.status,200);}assert.ok(rejected);}
      assert.equal((await r.call('bob','/import/activate',{id,root:packedBad.manifest.root})).status,409);
    }
    assert.equal((await r.call('bob','/state')).body.state.trades.length,100);
    const staged=(await r.call('alice','/import/part?id='+migration+'&number=0')).body;
    assert.equal(JSON.stringify(staged),packed.texts[0]);
  });
  await t.test('pagination and account guards prevent disclosure and unsafe method changes',async()=>{
    const first=await r.call('alice','/trades');assert.equal(first.body.trades.length,20);assert.equal(first.body.next,19);
    assert.equal((await r.call('alice','/trades?after=19')).body.trades[0].id,prepared.state.trades[20].id);
    assert.equal((await r.call('none','/state')).status,401);assert.equal((await r.call('alice','/validation/status')).status,401);
    assert.equal((await r.call('alice','/import/activate?id='+migration)).status,405);
    assert.equal((await r.call('alice','/trades?after=bad')).status,422);
  });
});
