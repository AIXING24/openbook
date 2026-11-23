import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {emailAuth} from '../email-auth.mjs';
import {emailSession} from '../../client/email-session.mjs';
import {runtime} from './runtime.mjs';
const b64=bytes=>Buffer.from(bytes).toString('base64url');
const digest=async value=>b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
test('email OTP handoff and sessions require verified identity and survive hostile exchanges',async t=>{
  const r=await runtime();t.after(()=>r.close());
  await r.db.exec(readFileSync(new URL('../schema-auth.sql',import.meta.url),'utf8').split('\n').filter(s=>s&&!s.startsWith('--')).join('\n'));
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'trusted-key',alg:'RS256'};
  let stamp=Date.parse('2026-11-23T10:00:00Z'),keyCalls=0;
  const issuer='https://gaintrace-test.cloudflareaccess.com',audience='auth-application-aud',origin='https://app.example.test';
  const configuration={db:r.db,issuer,audience,allowedOrigin:origin,returnUrl:origin+'/openbook/',allowedEmails:['alice@example.test','bob@example.test'],now:()=>stamp,fetch:async url=>{keyCalls++;assert.equal(url,issuer+'/cdn-cgi/access/certs');return Response.json({keys:[jwk]});}};
  const auth=emailAuth(configuration);
  const token=async(overrides={},header={})=>{
    const body={iss:issuer,aud:[audience],type:'app',sub:'alice-sub',email:'alice@example.test',iat:Math.floor(stamp/1000),exp:Math.floor(stamp/1000)+7200,...overrides};
    const content=b64(JSON.stringify({alg:'RS256',kid:'trusted-key',...header}))+'.'+b64(JSON.stringify(body));
    return content+'.'+b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(content)));
  };
  const verifier='v'.repeat(43),state='s'.repeat(43);
  const login=async(jwt,options={})=>{
    const url=new URL('https://api.example.test/auth/complete');url.search=new URLSearchParams({state,challenge:await digest(verifier),return:'https://evil.example/',...options}).toString();
    return auth.route(new Request(url,{headers:jwt?{'cf-access-jwt-assertion':jwt}:{}}));
  };
  const exchange=async(code,options={})=>auth.route(new Request('https://api.example.test/api/session/exchange',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({code,state,verifier,...options})}));
  const codeFrom=response=>new URLSearchParams(new URL(response.headers.get('location')).hash.slice(1)).get('gt_code');
  let aliceSession;
  await t.test('valid configured issuer signature is accepted; keys fetched only from fixed issuer',async()=>{
    const proof=await auth.verifyIdentity(await token());assert.equal(proof.email,'alice@example.test');
    await auth.verifyIdentity(await token());assert.equal(keyCalls,1);
    assert.throws(()=>emailAuth({...configuration,allowedEmails:[]}),/configuration/);
    assert.throws(()=>emailAuth({...configuration,returnUrl:'https://evil.example/'}),/configuration/);
  });
  await t.test('wrong issuer, audience, algorithm, expired and machine tokens cannot log in',async()=>{
    for(const [body,header] of [
      [{iss:'https://evil.example'},{}],[{aud:['different-app']},{}],[{}, {alg:'none'}],
      [{exp:Math.floor(stamp/1000)-1},{}],[{nbf:stamp/1000+600},{}],[{type:'service-token'},{}],
      [{email:'unlisted@example.test'},{}],[{iat:stamp/1000+600},{}],
    ])assert.equal((await login(await token(body,header))).status,401);
    assert.equal((await login(null)).status,401);
    const signed=await token(),parts=signed.split('.');parts[1]=b64(JSON.stringify({iss:issuer,aud:[audience],type:'app',sub:'bob-sub',email:'bob@example.test',iat:stamp/1000,exp:stamp/1000+7200}));
    assert.equal((await login(parts.join('.'))).status,401);
    assert.equal((await r.db.prepare('SELECT count(*) n FROM gt_auth_users').first()).n,0);
  });
  await t.test('untrusted key IDs and oversized requests are bounded before database writes',async()=>{
    const calls=keyCalls;
    for(const kid of ['unknown-one','unknown-two','unknown-three'])assert.equal((await login(await token({}, {kid}))).status,401);
    assert.equal(keyCalls,calls);
    const large=await auth.route(new Request('https://api.example.test/api/session/exchange',{method:'POST',headers:{origin,'content-type':'application/json'},body:'x'.repeat(3000)}));
    assert.equal(large.status,413);
  });
  await t.test('redirect contains a short opaque code with fixed return address; wrong PKCE/state rejected',async()=>{
    const response=await login(await token());assert.equal(response.status,303);
    const url=new URL(response.headers.get('location'));assert.equal(url.origin,origin);assert.equal(url.pathname,'/openbook/');
    assert.equal(response.headers.get('referrer-policy'),'no-referrer');const code=codeFrom(response);
    assert.equal((await exchange(code,{verifier:'w'.repeat(43)})).status,401);
    assert.equal((await exchange(code,{state:'x'.repeat(43)})).status,401);
    const issued=await exchange(code);assert.equal(issued.status,200);aliceSession=await issued.json();
    assert.equal(aliceSession.expiresAt,stamp+3600000);
    assert.equal((await exchange(code)).status,401);
    const stored=JSON.stringify(await r.db.prepare('SELECT * FROM gt_auth_sessions').all())+JSON.stringify(await r.db.prepare('SELECT * FROM gt_auth_handoffs').all());
    assert.ok(!stored.includes(aliceSession.token)&&!stored.includes(code));
  });
  await t.test('two simultaneous exchanges produce exactly one session',async()=>{
    const code=codeFrom(await login(await token()));
    const replies=await Promise.all([exchange(code),exchange(code)]);assert.deepEqual(replies.map(r=>r.status).sort(),[200,401]);
  });
  await t.test('expired handoff cannot exchange and session never exceeds identity expiry',async()=>{
    const code=codeFrom(await login(await token()));stamp+=61000;assert.equal((await exchange(code)).status,401);
    const identityExpiry=stamp+90000,shortCode=codeFrom(await login(await token({exp:identityExpiry/1000})));
    const issued=await (await exchange(shortCode)).json();assert.equal(issued.expiresAt,identityExpiry);
  });
  await t.test('verified identities get separate owners; same email with a new subject requires review',async()=>{
    const bobCode=codeFrom(await login(await token({sub:'bob-sub',email:'bob@example.test'}))),bob=await (await exchange(bobCode)).json();
    assert.notEqual(bob.user.id,aliceSession.user.id);
    assert.equal((await auth.authenticate(new Request('https://api.example.test/',{headers:{authorization:'Bearer '+bob.token}}))).id,bob.user.id);
    assert.equal((await login(await token({sub:'new-sub-with-same-email'}))).status,401);
    assert.equal((await r.db.prepare('SELECT count(*) n FROM gt_auth_users').first()).n,2);
  });
  await t.test('CORS requires the exact app origin; logout and expiration revoke authorization',async()=>{
    const preflight=await auth.route(new Request('https://api.example.test/api/session/exchange',{method:'OPTIONS',headers:{origin}}));
    assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
    assert.equal(preflight.headers.get('access-control-allow-credentials'),null);
    assert.equal((await auth.route(new Request('https://api.example.test/api/session/exchange',{method:'OPTIONS',headers:{origin:'https://evil.example'}}))).status,403);
    assert.equal((await auth.route(new Request('https://api.example.test/api/session/logout',{method:'POST',headers:{origin,authorization:'Bearer '+aliceSession.token}}))).status,200);
    assert.equal(await auth.authenticate(new Request('https://api.example.test/',{headers:{authorization:'Bearer '+aliceSession.token}})),null);
    stamp+=7200000;await auth.cleanup();assert.equal((await r.db.prepare('SELECT count(*) n FROM gt_auth_sessions').first()).n,0);
  });
  await t.test('browser PKCE handoff strips the fragment and keeps the session out of persistent storage',async()=>{
    const values=new Map(),storage={setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k)??null,removeItem:k=>values.delete(k)};
    let stripped=0;
    const manager=emailSession({endpoint:'https://api.example.test',storage,now:()=>stamp,stripFragment:()=>{stripped++;},fetch:async(url,options)=>{
      assert.equal(options.credentials,'omit');assert.equal(stripped,1);
      return auth.route(new Request(url,{...options,headers:{...options.headers,origin}}));
    }});
    const start=new URL(await manager.begin()),jwt=await token();
    const response=await login(jwt,{state:start.searchParams.get('state'),challenge:start.searchParams.get('challenge')});
    const session=await manager.complete(response.headers.get('location'));assert.ok(session.identityKey.endsWith('|'+session.user.id));
    assert.equal(values.size,0);assert.equal(manager.get().token,session.token);
    assert.equal((await manager.logout()).remoteRevoked,true);assert.equal(manager.get(),null);
    const noCleanup=emailSession({endpoint:'https://api.example.test',storage,now:()=>stamp});
    await assert.rejects(noCleanup.complete(origin+'/#gt_code='+('a'.repeat(43))+'&gt_state=x'),/cleanup/);
  });
});
