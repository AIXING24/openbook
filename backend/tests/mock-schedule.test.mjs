import test from 'node:test';
import assert from 'node:assert/strict';
import {runtime,fixture,upload} from './runtime.mjs';
test('mock Cron catches up in order without a browser or session',async context=>{
  const instance=await runtime();context.after(()=>instance.close());
  const backup=await fixture(4,2),symbols=[...new Set(backup.trades.map(trade=>trade.tc))];
  await upload(instance,'alice',backup);await upload(instance,'bob',backup);
  const db=instance.db,clock=Date.parse('2026-11-25T09:00:00Z');
  await db.batch([
    db.prepare("INSERT INTO gt_control VALUES('mock-calendar-enabled','1')"),
    db.prepare("INSERT INTO gt_mock_schedule_targets VALUES('alice','2026-11-22'),('bob','2026-11-22')"),
    db.prepare('INSERT INTO gt_mock_schedule_days VALUES(?,?,0),(?,?,1),(?,?,1),(?,?,1)').bind('2026-11-22',clock-1,'2026-11-23',clock-1,'2026-11-24',clock-1,'2026-11-25',clock+3600000),
  ]);
  for(const date of ['2026-11-23','2026-11-24','2026-11-25'])await instance.call('admin','/validation/seed',{date,symbols,price:115,noFx:date==='2026-11-23'});
  const worker=await instance.mf.getWorker();
  const tick=async(stamp=clock)=>{await worker.scheduled({scheduledTime:stamp,cron:'* * * * *'});};
  const points=async()=>db.prepare("SELECT account,date,payload FROM gt_daily WHERE status='confirmed' AND account IN ('alice','bob') ORDER BY account,date").all();
  await context.test('missing FX does not confirm a partial day or skip a gap',async()=>{
    for(let index=0;index<20;index++)await tick();
    assert.equal((await points()).results.length,0);
    const jobs=(await db.prepare('SELECT account,date,phase FROM gt_jobs').all()).results;
    assert.equal(jobs.length,2);assert.ok(jobs.every(job=>job.date==='2026-11-23'&&job.phase==='value'));
    const last=JSON.parse((await db.prepare("SELECT value FROM gt_control WHERE key='mock-last-scheduled'").first()).value);
    assert.equal(last.result.reason,'fx');assert.equal(last.source,'MOCK_CALENDAR');
  });
  await context.test('provider recovery resumes checkpoints, skips closed days and respects readiness',async()=>{
    await instance.call('admin','/validation/seed',{date:'2026-11-23',symbols,price:115});
    for(let index=0;index<24;index++)await tick();
    const rows=(await points()).results;assert.equal(rows.length,4);
    for(const account of ['alice','bob'])assert.deepEqual(rows.filter(row=>row.account===account).map(row=>row.date),['2026-11-23','2026-11-24']);
    assert.equal((await db.prepare("SELECT count(*) total FROM gt_jobs WHERE date='2026-11-25'").first()).total,0);
    assert.equal((await db.prepare("SELECT count(*) total FROM gt_positions p JOIN gt_jobs j ON j.id=p.job WHERE j.phase='done'").first()).total,8);
  });
  await context.test('duplicate ticks leave history immutable and later dates appear only when ready',async()=>{
    const before=(await points()).results;
    for(let index=0;index<4;index++)await tick();assert.deepEqual((await points()).results,before);
    for(let index=0;index<24;index++)await tick(clock+3600000);
    const after=(await points()).results;assert.equal(after.length,6);
    assert.deepEqual(after.filter(row=>row.date!=='2026-11-25'),before);
    const last=JSON.parse((await db.prepare("SELECT value FROM gt_control WHERE key='mock-last-scheduled'").first()).value);
    assert.equal(last.result.status,'confirmed');assert.equal(last.scheduledTime,clock+3600000);
  });
  await context.test('explicit disable stops the calendar and does not fall back to the legacy clock',async()=>{
    await db.batch([db.prepare("UPDATE gt_control SET value='0' WHERE key='mock-calendar-enabled'"),db.prepare("INSERT INTO gt_control VALUES('valuation-date','2026-11-26')"),db.prepare("INSERT INTO gt_mock_schedule_days VALUES('2026-11-26',0,1)")]);
    await tick(clock+7200000);assert.equal((await points()).results.length,6);
    assert.equal((await db.prepare("SELECT count(*) total FROM gt_jobs WHERE date='2026-11-26'").first()).total,0);
  });
  await context.test('the temporary validation deadline also stops work',async()=>{
    await db.batch([db.prepare("UPDATE gt_control SET value='1' WHERE key='mock-calendar-enabled'"),db.prepare("INSERT INTO gt_control VALUES('mock-calendar-until',?)").bind(String(clock+7200000))]);
    await tick(clock+7200000);
    assert.equal((await db.prepare("SELECT count(*) total FROM gt_jobs WHERE date='2026-11-26'").first()).total,0);
  });
});
