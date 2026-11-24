import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare,createFetchMock} from 'miniflare';
const issuer='https://gaintrace-test.kinde.com',origin='https://api.example.test',clientId='test-public-client-id';
const b64=value=>Buffer.from(value).toString('base64url');
test('Native Workerd fetch exchanges Kinde codes and refuses provider redirects',async t=>{
  const fetchMock=createFetchMock();fetchMock.disableNetConnect();
  const mf=new Miniflare({modules:true,scriptPath:new URL('../kinde-pages.mjs',import.meta.url).pathname,compatibilityDate:'2026-08-06',cf:false,host:'127.0.0.1',port:0,fetchMock,d1Databases:{DB:'kinde-native-runtime-test'},d1Persist:false,bindings:{VALIDATION_MODE:'mock-only',AUTH_MODE:'kinde-test-only',AUTH_ALLOWED_EMAILS:'["alice@example.test"]',AUTH_ISSUER:issuer,AUTH_CLIENT_ID:clientId,AUTH_API_ORIGIN:origin}});
  t.after(()=>mf.dispose());
  const db=await mf.getD1Database('DB');
  for(const name of ['schema-auth.sql','schema-kinde.sql'])await db.exec(readFileSync(new URL('../'+name,import.meta.url),'utf8').split('\n').filter(s=>s&&!s.startsWith('--')).join('\n'));
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'native-runtime-key',alg:'RS256',use:'sig'};
  const verifier='v'.repeat(43),state='s'.repeat(43),challenge=b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
  const begin=async()=>{
    const r=await mf.dispatchFetch(origin+'/auth/complete?'+new URLSearchParams({state,challenge}),{redirect:'manual'});assert.equal(r.status,303);
    const location=new URL(r.headers.get('location')),nonce=(await db.prepare('SELECT nonce FROM gt_kinde_logins WHERE oauth_state=?').bind(location.searchParams.get('state')).first()).nonce;
    return {state:location.searchParams.get('state'),nonce,cookie:r.headers.get('set-cookie').split(';')[0]};
  };
  const callback=flow=>mf.dispatchFetch(origin+'/auth/kinde/callback?'+new URLSearchParams({state:flow.state,code:'synthetic-provider-code'}),{headers:{cookie:flow.cookie},redirect:'manual'});
  await t.test('default native fetch reaches token and JWKS endpoints and issues an application session',async()=>{
    const flow=await begin(),stamp=Math.floor(Date.now()/1000);
    const claims={iss:issuer,aud:[clientId],azp:clientId,nonce:flow.nonce,sub:'native-test-alice',email:'alice@example.test',email_verified:true,iat:stamp,exp:stamp+3600};
    const content=b64(JSON.stringify({alg:'RS256',kid:jwk.kid}))+'.'+b64(JSON.stringify(claims));
    const idToken=content+'.'+b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(content)));
    fetchMock.get(issuer).intercept({path:'/oauth2/token',method:'POST'}).reply(200,{id_token:idToken},{headers:{'content-type':'application/json'}});
    fetchMock.get(issuer).intercept({path:'/.well-known/jwks',method:'GET'}).reply(200,{keys:[jwk]},{headers:{'content-type':'application/json'}});
    const response=await callback(flow);assert.equal(response.status,303);
    const fragment=new URLSearchParams(new URL(response.headers.get('location')).hash.slice(1));
    assert.ok(fragment.get('gt_code'),'Native runtime callback must complete, not return gt_error');
    const exchange=await mf.dispatchFetch(origin+'/api/session/exchange',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({code:fragment.get('gt_code'),state,verifier})});
    assert.equal(exchange.status,200);const session=await exchange.json();assert.ok(session.token);
    assert.equal((await mf.dispatchFetch(origin+'/api/session/me',{headers:{authorization:'Bearer '+session.token}})).status,200);
  });
  await t.test('an unexpected token endpoint redirect is rejected without following it',async()=>{
    const before=(await db.prepare('SELECT count(*) n FROM gt_auth_users').first()).n;
    const flow=await begin();
    fetchMock.get(issuer).intercept({path:'/oauth2/token',method:'POST'}).reply(302,'',{headers:{location:'https://unexpected.example.test/token'}});
    const response=await callback(flow);assert.equal(response.status,303);
    assert.equal(new URL(response.headers.get('location')).hash,'#gt_error=login-rejected');
    assert.equal((await db.prepare('SELECT count(*) n FROM gt_auth_users').first()).n,before);
  });
});
