// Authentication is not wired into the mock Worker. It requires a configured
// Access OTP application, a fixed issuer/AUD and an explicit email allowlist.
const encoder=new TextEncoder();
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64=text=>Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-text.length%4)%4)),c=>c.charCodeAt(0));
const hash=async text=>b64(await crypto.subtle.digest('SHA-256',encoder.encode(text)));
const random=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
const email=value=>typeof value==='string'&&value.length<=254&&/^[^\s@]+@[^\s@]+$/.test(value)?value.trim().toLowerCase():null;
const opaque=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const nonce=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{32,128}$/.test(value);
export function emailAuth({db,issuer,audience,allowedOrigin,returnUrl,allowedEmails,fetch:fetcher=globalThis.fetch,now=()=>Date.now(),sessionTtlMs=3600000}) {
  const destination=new URL(returnUrl);
  const allow=new Set((allowedEmails||[]).map(email).filter(Boolean));
  if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer)||typeof audience!=='string'||!audience||!allow.size||destination.origin!==allowedOrigin||destination.protocol!=='https:'||destination.search||destination.hash||destination.username||destination.password||!Number.isInteger(sessionTtlMs)||sessionTtlMs<60000||sessionTtlMs>86400000)throw Error('Explicit email authentication configuration required');
  let keys,keysAt=0,loading;
  const loadKeys=async(force=false)=>{
    if(keys&&!force&&now()-keysAt<3600000)return keys;
    // Random untrusted kid values must not trigger unlimited JWKS requests.
    if(keys&&force&&now()-keysAt<60000)return keys;
    if(!loading)loading=(async()=>{
      const response=await fetcher(issuer+'/cdn-cgi/access/certs',{signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw Error('Trusted signing keys unavailable');
      const data=await response.json();if(!Array.isArray(data.keys)||data.keys.length>20)throw Error('Invalid trusted signing keys');
      keys=data.keys;keysAt=now();return keys;
    })().finally(()=>{loading=undefined;});
    return loading;
  };
  const claims=async token=>{
    if(typeof token!=='string'||token.length>12000)throw Error('Invalid identity token');
    const parts=token.split('.');if(parts.length!==3||parts.some(p=>!p||! /^[A-Za-z0-9_-]+$/.test(p)))throw Error('Invalid identity token');
    const header=JSON.parse(new TextDecoder().decode(unb64(parts[0]))),body=JSON.parse(new TextDecoder().decode(unb64(parts[1])));
    const timestamp=now()/1000,verifiedEmail=email(body.email);
    if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>200||body.iss!==issuer||!(Array.isArray(body.aud)?body.aud:[body.aud]).includes(audience)||body.type!=='app'||typeof body.sub!=='string'||!body.sub||body.sub.length>200||!verifiedEmail||!allow.has(verifiedEmail)||!Number.isFinite(body.exp)||body.exp<=timestamp||!Number.isFinite(body.iat)||body.iat>timestamp+30||body.exp<=body.iat||(body.nbf!==undefined&&(!Number.isFinite(body.nbf)||body.nbf>timestamp)))throw Error('Identity claims rejected');
    let jwk=(await loadKeys()).find(k=>k.kid===header.kid&&k.kty==='RSA');
    if(!jwk)jwk=(await loadKeys(true)).find(k=>k.kid===header.kid&&k.kty==='RSA');
    if(!jwk)throw Error('Unknown trusted signing key');
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,unb64(parts[2]),encoder.encode(parts[0]+'.'+parts[1])))throw Error('Identity signature rejected');
    return {subject:body.sub,email:verifiedEmail,expiresAt:Math.floor(body.exp*1000)};
  };
  const identity=async proof=>{
    const existing=await db.prepare('SELECT i.user_id,u.email FROM gt_auth_identities i JOIN gt_auth_users u ON u.id=i.user_id WHERE i.issuer=? AND i.subject=?').bind(issuer,proof.subject).first();
    if(existing){if(existing.email!==proof.email)throw Error('Identity change requires account review');return existing.user_id;}
    const id=crypto.randomUUID();
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO gt_auth_users SELECT ?,?,? WHERE (SELECT count(*) FROM gt_auth_users)<50').bind(id,proof.email,now()),
      db.prepare('INSERT OR IGNORE INTO gt_auth_identities SELECT ?,?,id FROM gt_auth_users WHERE id=? AND email=?').bind(issuer,proof.subject,id,proof.email),
    ]);
    const linked=await db.prepare('SELECT i.user_id,u.email FROM gt_auth_identities i JOIN gt_auth_users u ON u.id=i.user_id WHERE i.issuer=? AND i.subject=?').bind(issuer,proof.subject).first();
    if(!linked||linked.email!==proof.email)throw Error('Account linking requires review');
    return linked.user_id;
  };
  const cors=request=>request.headers.get('origin')===allowedOrigin?{'access-control-allow-origin':allowedOrigin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'Authorization, Content-Type','vary':'Origin'}:{'vary':'Origin'};
  const json=(request,body,status=200)=>Response.json(body,{status,headers:{...cors(request),'cache-control':'no-store','referrer-policy':'no-referrer'}});
  const authenticate=async request=>{
    const token=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if(!token)return null;
    const row=await db.prepare('SELECT s.user_id,u.email,s.expires_at FROM gt_auth_sessions s JOIN gt_auth_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(await hash(token),now()).first();
    return row?{id:row.user_id,email:row.email,expiresAt:row.expires_at}:null;
  };
  const route=async request=>{
    const url=new URL(request.url),path=url.pathname;
    if(path==='/auth/complete'&&request.method==='GET'){
      const state=url.searchParams.get('state'),challenge=url.searchParams.get('challenge');
      if(!nonce(state)||!opaque(challenge))return json(request,{error:'Invalid login request'},400);
      let proof,userId;
      try{proof=await claims(request.headers.get('cf-access-jwt-assertion'));userId=await identity(proof);}catch{return json(request,{error:'Email authentication rejected'},401);}
      const code=random(),expires=Math.min(now()+60000,proof.expiresAt);
      await db.prepare('INSERT INTO gt_auth_handoffs VALUES(?,?,?,?,?,?,NULL)').bind(await hash(code),userId,state,challenge,expires,proof.expiresAt).run();
      const location=new URL(returnUrl);location.hash=new URLSearchParams({gt_code:code,gt_state:state}).toString();
      return new Response(null,{status:303,headers:{location:location.href,'cache-control':'no-store','referrer-policy':'no-referrer'}});
    }
    if(!['/api/session/exchange','/api/session/logout'].includes(path))return null;
    if(request.headers.get('origin')!==allowedOrigin)return json(request,{error:'Origin rejected'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors(request)});
    if(request.method!=='POST')return json(request,{error:'POST required'},405);
    if(path==='/api/session/logout'){
      const token=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
      if(token)await db.prepare('DELETE FROM gt_auth_sessions WHERE token_hash=?').bind(await hash(token)).run();
      return json(request,{loggedOut:true});
    }
    if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return json(request,{error:'JSON required'},415);
    const reader=request.body?.getReader(),chunks=[];let size=0;
    if(reader)for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>2000){await reader.cancel();return json(request,{error:'Request too large'},413);}chunks.push(part.value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const text=new TextDecoder().decode(bytes);
    let body;try{body=JSON.parse(text);}catch{return json(request,{error:'Invalid JSON'},400);}
    if(!opaque(body?.code)||!nonce(body?.state)||typeof body.verifier!=='string'||! /^[A-Za-z0-9._~-]{43,128}$/.test(body.verifier))return json(request,{error:'Invalid exchange'},400);
    const token=random(),tokenHash=await hash(token),codeHash=await hash(body.code),challenge=await hash(body.verifier),stamp=now();
    // Consume and issue in one D1 transaction. Concurrent replays cannot create
    // a second session; only the winner's random hash passes the insert guard.
    const result=await db.batch([
      db.prepare('UPDATE gt_auth_handoffs SET consumed=? WHERE code_hash=? AND consumed IS NULL AND expires_at>? AND challenge=? AND state=?').bind(tokenHash,codeHash,stamp,challenge,body.state),
      db.prepare('INSERT INTO gt_auth_sessions SELECT ?,user_id,min(identity_expires_at,?) FROM gt_auth_handoffs WHERE code_hash=? AND consumed=?').bind(tokenHash,stamp+sessionTtlMs,codeHash,tokenHash),
    ]);
    if(!result[0].meta.changes)return json(request,{error:'Exchange expired or already used'},401);
    const session=await authenticate(new Request('https://auth.invalid/',{headers:{authorization:'Bearer '+token}}));
    if(!session)return json(request,{error:'Session unavailable'},401);
    return json(request,{token,user:{id:session.id,email:session.email},expiresAt:session.expiresAt});
  };
  return {route,authenticate,verifyIdentity:claims,
    async cleanup(){await db.batch([db.prepare('DELETE FROM gt_auth_handoffs WHERE expires_at<=?').bind(now()),db.prepare('DELETE FROM gt_auth_sessions WHERE expires_at<=?').bind(now())]);},
  };
}
