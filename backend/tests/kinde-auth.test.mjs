import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {kindeAuth} from '../kinde-auth.mjs';
import {runtime} from './runtime.mjs';
const b64=value=>Buffer.from(value).toString('base64url');
const hash=async value=>b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
test('Kinde PKCE, verified identities and application sessions remain isolated',async t=>{
  const r=await runtime();t.after(()=>r.close());
  for(const name of ['schema-auth.sql','schema-kinde.sql'])await r.db.exec(readFileSync(new URL('../'+name,import.meta.url),'utf8').split('\n').filter(s=>s&&!s.startsWith('--')).join('\n'));
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'trusted-key',alg:'RS256',use:'sig'};
  const issuer='https://gaintrace-test.kinde.com',clientId='test-public-client-id',apiOrigin='https://api.example.test',origin='https://app.example.test';
  let stamp=Date.parse('2026-11-24T03:00:00Z'),overrides={},headerOverrides={},corrupt=false,tokenCalls=0,keyCalls=0;
  const signed=async nonce=>{
    const claims={iss:issuer,aud:[clientId],azp:clientId,nonce,sub:'alice-sub',email:'alice@example.test',email_verified:true,iat:stamp/1000,exp:stamp/1000+7200,...overrides};
    const content=b64(JSON.stringify({alg:'RS256',kid:'trusted-key',...headerOverrides}))+'.'+b64(JSON.stringify(claims));
    const token=content+'.'+b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(content)));
    return corrupt?token.slice(0,-10)+'abcdefghij':token;
  };
  const configuration={db:r.db,issuer,clientId,apiOrigin,allowedOrigin:origin,returnUrl:origin+'/openbook/',allowedEmails:['alice@example.test','bob@example.test'],now:()=>stamp,fetch:async(url,options)=>{
    assert.equal(options.redirect,'manual');
    if(url===issuer+'/.well-known/jwks'){keyCalls++;return Response.json({keys:[jwk]});}
    assert.equal(url,issuer+'/oauth2/token');assert.equal(options.method,'POST');
    const fields=options.body;assert.equal(fields.get('grant_type'),'authorization_code');assert.equal(fields.get('client_id'),clientId);assert.equal(fields.get('redirect_uri'),apiOrigin+'/auth/kinde/callback');assert.equal(fields.has('client_secret'),false);assert.equal(fields.has('refresh_token'),false);
    const transaction=await r.db.prepare('SELECT nonce FROM gt_kinde_logins WHERE verifier=?').bind(fields.get('code_verifier')).first();assert.ok(transaction);
    tokenCalls++;return Response.json({id_token:await signed(transaction.nonce),access_token:'not-retained',refresh_token:'not-retained'});
  }};
  const auth=kindeAuth(configuration),verifier='v'.repeat(43),state='s'.repeat(43);
  const start=async()=>{
    const response=await auth.route(new Request(apiOrigin+'/auth/complete?'+new URLSearchParams({state,challenge:await hash(verifier)})));
    assert.equal(response.status,303);const location=new URL(response.headers.get('location'));
    const cookie=response.headers.get('set-cookie').split(';')[0];
    return {response,location,cookie};
  };
  const callback=(flow,options={})=>auth.route(new Request(apiOrigin+'/auth/kinde/callback?'+new URLSearchParams({state:flow.location.searchParams.get('state'),code:'one-use-provider-code',...options}),{headers:flow.cookie?{cookie:flow.cookie}:{}}));
  const handoff=response=>new URLSearchParams(new URL(response.headers.get('location')).hash.slice(1)).get('gt_code');
  const exchange=(code,options={},requestOrigin=origin)=>auth.route(new Request(apiOrigin+'/api/session/exchange',{method:'POST',headers:{origin:requestOrigin,'content-type':'application/json'},body:JSON.stringify({code,state,verifier,...options})}));
  const reset=()=>{overrides={};headerOverrides={};corrupt=false;};
  let alice;
  await t.test('explicit HTTPS tenant, callback, allowlist and bounded lifetime are required',async()=>{
    for(const changed of [{issuer:'https://evil.example'},{apiOrigin:'https://api.example.test/path'},{returnUrl:'https://evil.example/'},{allowedEmails:[]},{sessionTtlMs:7200000}])assert.throws(()=>kindeAuth({...configuration,...changed}),/configuration/);
    assert.equal(await auth.route(new Request(apiOrigin+'/not-auth')),null);
    assert.equal((await auth.route(new Request('https://other.example/auth/complete'))).status,403);
  });
  await t.test('server stores browser-bound nonce/verifier and sends only public-client PKCE',async()=>{
    const flow=await start(),params=flow.location.searchParams;
    assert.equal(flow.location.origin,issuer);assert.equal(params.get('scope'),'openid email');assert.equal(params.get('code_challenge_method'),'S256');assert.equal(params.has('client_secret'),false);
    assert.match(flow.response.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Lax; Path=\//);
    const response=await callback(flow);assert.equal(response.status,303);assert.ok(handoff(response));
    assert.equal(new URL(response.headers.get('location')).origin,origin);assert.match(response.headers.get('set-cookie'),/Max-Age=0/);
    alice=await (await exchange(handoff(response))).json();assert.ok(alice.token);assert.equal(alice.expiresAt,stamp+3600000);
    const identity=await auth.authenticate(new Request(apiOrigin,{headers:{authorization:'Bearer '+alice.token}}));assert.equal(identity.id,alice.user.id);
    const rows=JSON.stringify(await r.db.prepare('SELECT * FROM gt_auth_sessions').all())+JSON.stringify(await r.db.prepare('SELECT * FROM gt_auth_handoffs').all());assert.ok(!rows.includes(alice.token)&&!rows.includes('not-retained'));
  });
  await t.test('wrong browser, state, duplicate fields and expired transactions never exchange a code',async()=>{
    const flow=await start(),before=tokenCalls;
    assert.equal(handoff(await callback({...flow,cookie:''})),null);
    assert.equal(handoff(await callback(flow,{state:'x'.repeat(43)})),null);
    const duplicate=await auth.route(new Request(apiOrigin+'/auth/kinde/callback?'+new URLSearchParams({state:flow.location.searchParams.get('state'),code:'a'})+'&code=b',{headers:{cookie:flow.cookie}}));assert.equal(handoff(duplicate),null);
    stamp+=600001;assert.equal(handoff(await callback(flow)),null);stamp-=600001;assert.equal(tokenCalls,before);
  });
  await t.test('only one simultaneous provider callback wins and handoff is not replayable',async()=>{
    const flow=await start(),before=tokenCalls,responses=await Promise.all([callback(flow),callback(flow)]);
    assert.equal(tokenCalls,before+1);const codes=responses.map(handoff).filter(Boolean);assert.equal(codes.length,1);
    const results=await Promise.all([exchange(codes[0]),exchange(codes[0])]);assert.deepEqual(results.map(x=>x.status).sort(),[200,401]);
    assert.equal(handoff(await callback(flow)),null);
  });
  await t.test('provider issuer/client audience/azp/nonce/email verification are mandatory',async()=>{
    const rejected=[{iss:'https://another.kinde.com'},{aud:[issuer]},{aud:[clientId,'other-client']},{azp:'other-client'},{nonce:'wrong'},{email_verified:false},{email_verified:'true'},{email_verified:null},{email:'unlisted@example.test'},{exp:stamp/1000-1},{iat:stamp/1000+300},{nbf:stamp/1000+300}];
    for(const claims of rejected){overrides=claims;assert.equal(handoff(await callback(await start())),null);}
    reset();headerOverrides={alg:'none'};assert.equal(handoff(await callback(await start())),null);
    reset();corrupt=true;assert.equal(handoff(await callback(await start())),null);reset();
    assert.equal((await r.db.prepare('SELECT count(*) n FROM gt_auth_users').first()).n,1);
  });
  await t.test('unknown key IDs do not trigger arbitrary fetches or repeated rotation refetches',async()=>{
    const before=keyCalls;for(const kid of ['unknown-one','unknown-two','unknown-three']){headerOverrides={kid};assert.equal(handoff(await callback(await start())),null);}assert.equal(keyCalls,before);reset();
  });
  await t.test('frontend PKCE, Origin and handoff expiry protect application sessions',async()=>{
    let code=handoff(await callback(await start()));
    assert.equal((await exchange(code,{verifier:'x'.repeat(43)})).status,401);
    assert.equal((await exchange(code,{state:'x'.repeat(43)})).status,401);
    assert.equal((await exchange(code,{},'https://evil.example')).status,403);
    assert.equal((await exchange(code)).status,200);
    code=handoff(await callback(await start()));stamp+=61000;assert.equal((await exchange(code)).status,401);stamp-=61000;
    const huge=await auth.route(new Request(apiOrigin+'/api/session/exchange',{method:'POST',headers:{origin,'content-type':'application/json'},body:'x'.repeat(3000)}));assert.equal(huge.status,400);
  });
  await t.test('provider subjects isolate owners and matching emails never silently merge',async()=>{
    overrides={sub:'bob-sub',email:'bob@example.test'};const bob=await (await exchange(handoff(await callback(await start())))).json();assert.notEqual(bob.user.id,alice.user.id);
    overrides={sub:'new-alice-sub'};assert.equal(handoff(await callback(await start())),null);
    overrides={email:'bob@example.test'};assert.equal(handoff(await callback(await start())),null);reset();
    assert.equal((await r.db.prepare('SELECT count(*) n FROM gt_auth_users').first()).n,2);
  });
  await t.test('session lifetime is bounded by provider identity and logout revokes local access',async()=>{
    overrides={exp:stamp/1000+90};const short=await (await exchange(handoff(await callback(await start())))).json();assert.equal(short.expiresAt,stamp+90000);reset();
    const response=await auth.route(new Request(apiOrigin+'/api/session/logout',{method:'POST',headers:{origin,authorization:'Bearer '+alice.token}}));assert.equal(response.status,200);
    assert.equal(await auth.authenticate(new Request(apiOrigin,{headers:{authorization:'Bearer '+alice.token}})),null);
    stamp+=7200000;await auth.cleanup();assert.equal((await r.db.prepare('SELECT count(*) n FROM gt_auth_sessions').first()).n,0);
    assert.equal((await r.db.prepare('SELECT count(*) n FROM gt_kinde_logins').first()).n,0);
  });
});
