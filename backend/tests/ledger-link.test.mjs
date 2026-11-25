import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import {IDBFactory} from 'fake-indexeddb';
import {ledgerApi} from '../../client/ledger-api.mjs';
import {initializeDemo} from '../../client/mock-ledger.mjs';
import {cloudSync} from '../../client/sync.mjs';
import {indexedDbStore} from '../../client/indexeddb-store.mjs';
import {fixture,upload} from './runtime.mjs';
const origin='https://pilot.example.test',hash=async token=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('base64url');
test('Native Workerd binds cloud ledgers and durable queues to authenticated identities',async t=>{
  const mf=new Miniflare({modules:true,scriptPath:new URL('../kinde-pages.mjs',import.meta.url).pathname,compatibilityDate:'2026-08-06',cf:false,host:'127.0.0.1',port:0,d1Databases:{DB:'ledger-link-test'},d1Persist:false,bindings:{VALIDATION_MODE:'mock-only',AUTH_MODE:'kinde-test-only',AUTH_ISSUER:'https://test.kinde.com',AUTH_CLIENT_ID:'test-public-client-id',AUTH_API_ORIGIN:origin,AUTH_ALLOWED_EMAILS:'["alice@example.test","bob@example.test"]',TEST_ALICE_TOKEN:'MOCK-ALICE-LOCAL',TEST_BOB_TOKEN:'MOCK-BOB-LOCAL'}});
  t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
  for(const name of ['schema.sql','schema-auth.sql','schema-kinde.sql'])await db.exec(readFileSync(new URL('../'+name,import.meta.url),'utf8').split('\n').filter(s=>s&&!s.startsWith('--')).join('\n'));
  const alice={token:'a'.repeat(43),user:{id:crypto.randomUUID()}},bob={token:'b'.repeat(43),user:{id:crypto.randomUUID()}};
  for(const [session,email] of [[alice,'alice@example.test'],[bob,'bob@example.test']]){
    session.identityKey=origin+'|'+session.user.id;
    await db.batch([db.prepare('INSERT INTO gt_auth_users VALUES(?,?,?)').bind(session.user.id,email,Date.now()),db.prepare('INSERT INTO gt_auth_sessions VALUES(?,?,?)').bind(await hash(session.token),session.user.id,Date.now()+3600000)]);
  }
  let current=alice,calls=0,offline=false,lose=false;
  const network=async(url,options={})=>{
    calls++;if(offline)throw Error('Offline');
    const response=await mf.dispatchFetch(url,{...options,headers:{...options.headers,...(options.method==='POST'?{origin}: {})}});
    if(lose&&url.endsWith('/operation')){lose=false;await response.text();throw Error('Lost response after commit');}return response;
  };
  const api=ledgerApi({endpoint:origin,identityKey:alice.identityKey,getSession:()=>current,fetch:network});
  const bobApi=ledgerApi({endpoint:origin,identityKey:bob.identityKey,getSession:()=>bob,fetch:network});
  const invoke=async(session,path,body,extra={})=>mf.dispatchFetch(origin+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+session.token,origin,'content-type':'application/json',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
  await t.test('anonymous, mock tokens, aliases, foreign origins and administrative routes are denied',async()=>{
    for(const token of ['', 'MOCK-ALICE-LOCAL'])assert.equal((await invoke({token},'/api/ledger/meta')).status,401);
    assert.equal((await mf.dispatchFetch('https://alias.example.test/api/ledger/meta',{headers:{authorization:'Bearer '+alice.token}})).status,403);
    assert.equal((await invoke(alice,'/api/ledger/operation',{}, {origin:'https://other.example.test'})).status,403);
    assert.equal((await invoke(alice,'/api/ledger/validation/seed',{})).status,404);
    assert.equal((await invoke(alice,'/state')).status,401);
    const response=await invoke(alice,'/api/ledger/meta?account=bob');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).state,null);
  });
  let initial;
  await t.test('a fixed demo imports, verifies and activates independently for each email owner',async()=>{
    initial=await initializeDemo(api);const other=await initializeDemo(bobApi);
    assert.notEqual(initial.generation,other.generation);assert.equal(initial.state.trades.length,4);
    assert.deepEqual((await initializeDemo(api)).state,initial.state);
    assert.equal((await invoke(bob,'/api/ledger/import/part?id='+initial.generation+'&number=0')).status,404);
    for(const path of ['/import/verify','/import/activate'])assert.equal((await invoke(bob,'/api/ledger'+path,{id:initial.generation,root:'0'.repeat(64),account:'email:'+alice.user.id})).status,404);
    const accounts=(await db.prepare('SELECT id FROM gt_accounts').all()).results;assert.deepEqual(new Set(accounts.map(a=>a.id)),new Set(['email:'+alice.user.id,'email:'+bob.user.id]));
    assert.equal((await invoke(alice,'/api/ledger/meta?account=email:'+bob.user.id)).status,200);
  });
  const factory=new IDBFactory();let store=indexedDbStore({indexedDB:factory,name:'linked-queue'}),sync=cloudSync({store,identityKey:alice.identityKey,api});t.after(()=>store.close());
  await t.test('an offline edit survives reopen and a lost committed response retries without duplication',async()=>{
    await sync.initialize(initial);const trade={...initial.state.trades[2],id:'linked-buy',date:'2026-11-24',ts:1000,px:90,qty:1};
    await sync.enqueue({kind:'upsert-trade',trade},{id:'linked-operation'});offline=true;assert.equal((await sync.flush()).mode,'offline');
    await store.close();store=indexedDbStore({indexedDB:factory,name:'linked-queue'});sync=cloudSync({store,identityKey:alice.identityKey,api});assert.equal((await sync.snapshot()).pending,1);
    offline=false;lose=true;assert.equal((await sync.flush()).pending,1);assert.equal((await api.readSnapshot()).state.trades.filter(t=>t.id===trade.id).length,1);
    const sent=(await sync.exportPending()).queue[0].wire;await sync.refresh();assert.deepEqual((await sync.exportPending()).queue[0].wire,sent);
    assert.equal((await sync.flush()).pending,0);assert.equal((await db.prepare('SELECT count(*) n FROM gt_operations WHERE account=? AND id=?').bind('email:'+alice.user.id,'linked-operation').first()).n,1);
    assert.equal((await bobApi.readSnapshot()).state.trades.length,4);
  });
  await t.test('identity switches and expired sessions retain edits until the same owner reauthenticates',async()=>{
    await sync.enqueue({kind:'delete-trade',tradeId:'linked-buy'},{id:'expired-delete'});current=bob;const before=calls;
    assert.equal((await sync.flush()).mode,'auth-required');assert.equal(calls,before,'wrong identity must not send credentials');
    current=alice;await db.prepare('UPDATE gt_auth_sessions SET expires_at=0 WHERE user_id=?').bind(alice.user.id).run();
    assert.equal((await sync.flush()).mode,'auth-required');assert.equal((await sync.snapshot()).pending,1);
    await db.prepare('UPDATE gt_auth_sessions SET expires_at=? WHERE user_id=?').bind(Date.now()+3600000,alice.user.id).run();
    assert.equal((await sync.flush()).pending,0);assert.equal((await api.readSnapshot()).state.trades.some(t=>t.id==='linked-buy'),false);
  });
  await t.test('another device cannot silently overwrite pending local edits',async()=>{
    await sync.enqueue({kind:'delete-trade',tradeId:'demo-buy-2'},{id:'local-conflict'});const snapshot=await api.readSnapshot();
    const other=await api.operation({id:'external-device',expectedRevision:snapshot.revision,kind:'upsert-trade',trade:{...initial.state.trades[0],id:'device-buy',date:'2026-11-24'}});assert.equal(other.status,200);
    const blocked=await sync.flush();assert.equal(blocked.mode,'conflict');assert.equal(blocked.pending,1);
    assert.equal((await api.readSnapshot()).state.trades.some(t=>t.id==='demo-buy-2'),true);assert.equal(blocked.observedCloud.state.trades.some(t=>t.id==='device-buy'),true);
  });
  await t.test('trade and history pagination detects changes between pages and returns only the owner',async()=>{
    const largeId=crypto.randomUUID(),session={token:'c'.repeat(43),user:{id:largeId},identityKey:origin+'|'+largeId};
    await db.batch([db.prepare('INSERT INTO gt_auth_users VALUES(?,?,?)').bind(largeId,'pages@example.test',Date.now()),db.prepare('INSERT INTO gt_auth_sessions VALUES(?,?,?)').bind(await hash(session.token),largeId,Date.now()+3600000)]);
    const uploadApi={call:async(_role,path,body)=>{const response=await invoke(session,'/api/ledger'+path,body);return {status:response.status,body:await response.json()};}};
    await upload(uploadApi,'ignored',await fixture(45,3));
    const largeApi=ledgerApi({endpoint:origin,identityKey:session.identityKey,getSession:()=>session,fetch:network});
    const large=await largeApi.readSnapshot();assert.equal(large.state.trades.length,45);
    const writes=Array.from({length:25},(_,i)=>{const date='2026-10-'+String(i+1).padStart(2,'0');return db.prepare('INSERT INTO gt_daily VALUES(?,?,?,?,?)').bind('email:'+largeId,date,1,'confirmed',JSON.stringify({date,amounts:{USD:{realized:10,unrealized:20}}}));});await db.batch(writes);
    const history=await largeApi.readHistory(large.revision);assert.equal(history.length,25);assert.equal((await bobApi.readHistory(1)).length,0);
    let mutate=true;const changing=ledgerApi({endpoint:origin,identityKey:session.identityKey,getSession:()=>session,fetch:async(url,options)=>{const response=await network(url,options);if(mutate&&url.includes('/trades?')){mutate=false;const result=await largeApi.operation({id:'pagination-change',kind:'delete-trade',tradeId:large.state.trades[0].id,expectedRevision:large.revision});assert.equal(result.status,200);}return response;}});
    await assert.rejects(changing.readSnapshot(),/changed during pagination/);
  });
  await t.test('revoking a session immediately denies ledger reads and mutations',async()=>{
    assert.equal((await invoke(alice,'/api/session/logout',{})).status,200);
    assert.equal((await invoke(alice,'/api/ledger/meta')).status,401);assert.equal((await api.operation({})).status,401);
  });
});
