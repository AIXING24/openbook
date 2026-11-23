import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {indexedDbStore} from '../../client/indexeddb-store.mjs';
import {cloudSync} from '../../client/sync.mjs';
import {runtime,fixture,upload} from './runtime.mjs';
const makeApi=(r,role='alice')=>({identityKey:'mock-api|'+role,
  operation:body=>r.call(role,'/operation',body),
  readSnapshot:async()=>{const reply=await r.call(role,'/state');assert.equal(reply.status,200);return reply.body;}});
const newTrade=(base,id='queued-trade')=>({...base,id,date:'2026-11-18',qty:7,ts:9999});

test('durable frontend queue integrates with D1 without changing the production UI',async t=>{
  const r=await runtime();t.after(()=>r.close());
  await upload(r,'alice',await fixture(30,3));await upload(r,'bob',await fixture(10,2));
  const factory=new IDBFactory();
  const store=()=>indexedDbStore({indexedDB:factory,name:'sync-acceptance'});
  const api=makeApi(r),initial=await api.readSnapshot();
  let first=store(),client=cloudSync({store:first,identityKey:api.identityKey,api});
  t.after(()=>first.close());
  await client.initialize(initial);

  await t.test('local edits survive closing the database and remain account-scoped',async()=>{
    await client.enqueue({kind:'upsert-trade',trade:newTrade(initial.state.trades[0])},{id:'persistent-buy'});
    const before=await client.snapshot();assert.equal(before.pending,1);assert.equal(before.mode,'pending');
    assert.equal((await api.readSnapshot()).state.trades.length,30);
    await first.close();first=store();client=cloudSync({store:first,identityKey:api.identityKey,api});
    assert.deepEqual(await client.snapshot(),before);
    const bobApi=makeApi(r,'bob'),bob=cloudSync({store:first,identityKey:bobApi.identityKey,api:bobApi});
    await bob.initialize(await bobApi.readSnapshot());assert.equal((await bob.snapshot()).pending,0);
    assert.equal((await bob.snapshot()).state.trades.length,10);
    assert.throws(()=>cloudSync({store:first,identityKey:bobApi.identityKey,api}),/identity mismatch/);
  });
  await t.test('a response lost after commit retries the identical wire operation on reopen',async()=>{
    const sent=[];let lost=true;
    const unreliable={...api,operation:async wire=>{
      sent.push(structuredClone(wire));const result=await api.operation(wire);
      if(lost){lost=false;throw Error('Response lost after server commit');}return result;
    }};
    client=cloudSync({store:first,identityKey:api.identityKey,api:unreliable});
    assert.equal((await client.flush()).mode,'offline');
    assert.equal((await api.readSnapshot()).state.trades.filter(t=>t.id==='queued-trade').length,1);
    const pending=await client.exportPending();assert.equal(pending.queue[0].wire.expectedRevision,initial.revision);
    await first.close();first=store();client=cloudSync({store:first,identityKey:api.identityKey,api:unreliable});
    // Seeing the committed revision before retry must not silently discard or
    // rebase the uncertain operation.
    await client.refresh();assert.equal((await client.snapshot()).pending,1);
    const result=await client.flush();assert.equal(result.mode,'synced');assert.equal(result.pending,0);
    assert.deepEqual(sent[0],sent[1]);assert.equal(result.confirmedRevision,initial.revision+1);
    assert.equal((await r.db.prepare("SELECT count(*) n FROM gt_operations WHERE account='alice' AND id='persistent-buy'").first()).n,1);
  });
  await t.test('simultaneous tabs append atomically and deduplicated flushes do not drop later edits',async()=>{
    const second=store();t.after(()=>second.close());
    const other=cloudSync({store:second,identityKey:api.identityKey,api});
    await Promise.all([
      client.enqueue({kind:'upsert-trade',trade:newTrade(initial.state.trades[0],'tab-one')},{id:'tab-one-op'}),
      other.enqueue({kind:'upsert-trade',trade:newTrade(initial.state.trades[1],'tab-two')},{id:'tab-two-op'}),
    ]);
    assert.equal((await other.snapshot()).pending,2);
    const results=await Promise.all([client.flush(),other.flush()]);
    assert.ok(results.every(x=>x.mode==='synced'),JSON.stringify(results));
    const final=await api.readSnapshot();assert.equal(final.state.trades.filter(t=>['tab-one','tab-two'].includes(t.id)).length,2);
    assert.equal((await client.snapshot()).pending,0);
  });
  await t.test('authentication failure retains the queue; login retry can finish it',async()=>{
    const unauthorized={...api,operation:async()=>({status:401,body:{error:'Login required'}})};
    client=cloudSync({store:first,identityKey:api.identityKey,api:unauthorized});
    await client.enqueue({kind:'delete-trade',tradeId:'tab-two'},{id:'delete-after-login'});
    const failed=await client.flush();assert.equal(failed.mode,'auth-required');assert.equal(failed.pending,1);
    client=cloudSync({store:first,identityKey:api.identityKey,api});
    assert.equal((await client.flush()).mode,'synced');assert.equal((await api.readSnapshot()).state.trades.some(t=>t.id==='tab-two'),false);
  });
  await t.test('lost confirmation reads preserve later edits and use consecutive cloud revisions',async()=>{
    const sent=[],noRead={...api,operation:async wire=>{sent.push(structuredClone(wire));return api.operation(wire);},readSnapshot:async()=>{throw Error('Read unavailable');}};
    client=cloudSync({store:first,identityKey:api.identityKey,api:noRead});
    await client.enqueue({kind:'upsert-trade',trade:newTrade(initial.state.trades[0],'first-before-read')},{id:'before-read-failure'});
    assert.equal((await client.flush()).reason,'confirmation-read-unavailable');
    const before=await client.snapshot();
    const {trades,...preferences}=before.state;
    await client.enqueue({kind:'preferences',preferences:{...preferences,base:'CNY'}},{id:'after-read-failure'});
    const reliable={...api,operation:async wire=>{sent.push(structuredClone(wire));return api.operation(wire);}};
    client=cloudSync({store:first,identityKey:api.identityKey,api:reliable});
    const final=await client.flush();assert.equal(final.mode,'synced');assert.equal(final.state.base,'CNY');
    assert.deepEqual(sent[0],sent[1]);assert.equal(sent[2].expectedRevision,sent[1].expectedRevision+1);
  });
  await t.test('a device edit after an uncertain commit cannot silently rebase the remaining queue',async()=>{
    const bobApi=makeApi(r,'bob'),before=await bobApi.readSnapshot();
    const lost={...bobApi,operation:async wire=>{await bobApi.operation(wire);throw Error('Lost committed response');}};
    const bob=cloudSync({store:first,identityKey:bobApi.identityKey,api:lost});
    await bob.enqueue({kind:'upsert-trade',trade:newTrade(before.state.trades[0],'bob-committed')},{id:'bob-uncertain'});
    assert.equal((await bob.flush()).mode,'offline');
    await bob.enqueue({kind:'upsert-trade',trade:newTrade(before.state.trades[0],'bob-pending')},{id:'bob-later'});
    const committed=await bobApi.readSnapshot();
    await bobApi.operation({id:'bob-other-device',kind:'upsert-trade',expectedRevision:committed.revision,trade:newTrade(before.state.trades[0],'bob-external')});
    const retry=cloudSync({store:first,identityKey:bobApi.identityKey,api:bobApi});
    const blocked=await retry.flush();assert.equal(blocked.mode,'conflict');assert.equal(blocked.pending,1);
    const queue=(await retry.exportPending()).queue;assert.equal(queue[0].edit.id,'bob-later');assert.equal(queue[0].wire,null);
    assert.ok(blocked.state.trades.some(t=>t.id==='bob-pending'));
    assert.equal((await bobApi.readSnapshot()).state.trades.some(t=>t.id==='bob-pending'),false);
  });
  await t.test('another device causes a visible conflict; pending edits stay available for review',async()=>{
    await client.enqueue({kind:'upsert-trade',trade:newTrade(initial.state.trades[0],'conflicted-local')},{id:'local-after-other-device'});
    const before=await api.readSnapshot();
    await api.operation({kind:'upsert-trade',id:'outside-device',expectedRevision:before.revision,trade:newTrade(initial.state.trades[1],'outside-trade')});
    const blocked=await client.flush();assert.equal(blocked.mode,'conflict');assert.equal(blocked.pending,1);
    assert.ok(blocked.state.trades.some(t=>t.id==='conflicted-local'));assert.ok(blocked.observedCloud.state.trades.some(t=>t.id==='outside-trade'));
    const saved=await client.exportPending();assert.equal(saved.queue[0].wire.expectedRevision,before.revision);
    await first.close();first=store();client=cloudSync({store:first,identityKey:api.identityKey,api});
    assert.equal((await client.flush()).mode,'conflict');assert.equal((await client.exportPending()).queue.length,1);
    assert.equal((await api.readSnapshot()).state.trades.some(t=>t.id==='conflicted-local'),false);
  });
});

test('storage failure never reports an edit saved or sends it to the cloud',async()=>{
  const factory=new IDBFactory(),real=indexedDbStore({indexedDB:factory,name:'quota-check'});
  const state={v:1,base:'USD',upRed:false,theme:'dark',brokers:['Mock HSBC'],lastBroker:'Mock HSBC',lastBackup:0,demoVersion:0,seeded:true,positionOrder:[],trades:[]};
  let calls=0;
  const api={identityKey:'quota-user',operation:async()=>{calls++;},readSnapshot:async()=>({generation:'quota-generation',revision:1,state})};
  await cloudSync({store:real,identityKey:api.identityKey,api}).initialize(await api.readSnapshot());
  const failing={read:key=>real.read(key),change:async()=>{throw new DOMException('Quota exceeded','QuotaExceededError');}};
  const client=cloudSync({store:failing,identityKey:api.identityKey,api});
  await assert.rejects(client.enqueue({kind:'delete-trade',tradeId:'absent'},{id:'quota-edit'}),/Quota/);
  assert.equal((await real.read(api.identityKey)).queue.length,0);assert.equal(calls,0);await real.close();
});
