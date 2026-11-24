// Kinde public-client PKCE adapter. Not enabled in the public mock Worker.
const encoder=new TextEncoder(),decoder=new TextDecoder();
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64=text=>Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-text.length%4)%4)),c=>c.charCodeAt(0));
const hash=async text=>b64(await crypto.subtle.digest('SHA-256',encoder.encode(text)));
const random=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
const opaque=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const email=value=>typeof value==='string'&&value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)?value.toLowerCase():null;
const cookieName='__Host-gaintrace-kinde';
async function bodyText(response,limit){
  const reader=response.body?.getReader(),chunks=[];let size=0;
  if(reader)for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit){await reader.cancel();throw Error('Response exceeds limit');}chunks.push(part.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return decoder.decode(bytes);
}
export function kindeAuth({db,issuer,clientId,apiOrigin,allowedOrigin,returnUrl,allowedEmails,fetch:fetcher=globalThis.fetch,now=()=>Date.now(),sessionTtlMs=3600000}){
  const api=new URL(apiOrigin),destination=new URL(returnUrl),allow=new Set((allowedEmails||[]).map(email).filter(Boolean));
  if(!/^https:\/\/[a-z0-9-]+\.kinde\.com$/.test(issuer)||! /^[a-zA-Z0-9_-]{16,100}$/.test(clientId||'')||api.protocol!=='https:'||api.origin!==apiOrigin||api.username||api.password||api.pathname!=='/'||api.search||api.hash||destination.protocol!=='https:'||destination.origin!==allowedOrigin||destination.username||destination.password||destination.search||destination.hash||!allow.size||allow.size>50||!Number.isInteger(sessionTtlMs)||sessionTtlMs<60000||sessionTtlMs>3600000)throw Error('Explicit Kinde pilot configuration required');
  const callback=apiOrigin+'/auth/kinde/callback';
  const cookie=value=>cookieName+'='+value+'; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age='+(value?600:0);
  const safeHeaders={'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'};
  const cors=request=>request.headers.get('origin')===allowedOrigin?{'access-control-allow-origin':allowedOrigin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'Authorization, Content-Type','vary':'Origin'}:{'vary':'Origin'};
  const json=(request,body,status=200)=>Response.json(body,{status,headers:{...safeHeaders,...cors(request)}});
  const redirect=location=>new Response(null,{status:303,headers:{...safeHeaders,location,'set-cookie':cookie('')}});
  const reject=()=>{const url=new URL(returnUrl);url.hash='gt_error=login-rejected';return redirect(url.href);};
  let keys,keysAt=0,loading;
  const providerJson=async(url,options={})=>{
    const response=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('Provider unavailable');return JSON.parse(await bodyText(response,64000));
  };
  const loadKeys=async(force=false)=>{
    if(keys&&(!force&&now()-keysAt<3600000||force&&now()-keysAt<60000))return keys;
    if(!loading)loading=(async()=>{const result=await providerJson(issuer+'/.well-known/jwks');if(!Array.isArray(result.keys)||result.keys.length>20)throw Error('Invalid trusted keys');keys=result.keys;keysAt=now();return keys;})().finally(()=>{loading=undefined;});
    return loading;
  };
  const verifyIdentity=async(token,nonce)=>{
    if(!opaque(nonce)||typeof token!=='string'||token.length>16000)throw Error('Invalid ID token');
    const parts=token.split('.');if(parts.length!==3||parts.some(p=>! /^[A-Za-z0-9_-]+$/.test(p)))throw Error('Invalid ID token');
    const header=JSON.parse(decoder.decode(unb64(parts[0]))),claims=JSON.parse(decoder.decode(unb64(parts[1]))),aud=Array.isArray(claims.aud)?claims.aud:[claims.aud],stamp=now()/1000,verifiedEmail=email(claims.email);
    if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>200||claims.iss!==issuer||!aud.length||aud.some(v=>v!==clientId)||(claims.azp!==undefined&&claims.azp!==clientId)||claims.nonce!==nonce||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>200||claims.email_verified!==true||!verifiedEmail||!allow.has(verifiedEmail)||!Number.isFinite(claims.exp)||claims.exp<=stamp||!Number.isFinite(claims.iat)||claims.iat>stamp+30||claims.exp<=claims.iat||(claims.nbf!==undefined&&(!Number.isFinite(claims.nbf)||claims.nbf>stamp+30)))throw Error('ID token claims rejected');
    let jwk=(await loadKeys()).find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig')&&(!k.key_ops||k.key_ops.includes('verify')));
    if(!jwk)jwk=(await loadKeys(true)).find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig')&&(!k.key_ops||k.key_ops.includes('verify')));
    if(!jwk)throw Error('Unknown trusted key');
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,unb64(parts[2]),encoder.encode(parts[0]+'.'+parts[1])))throw Error('ID token signature rejected');
    return {subject:claims.sub,email:verifiedEmail,expiresAt:Math.floor(claims.exp*1000)};
  };
  const identity=async proof=>{
    const lookup=()=>db.prepare('SELECT i.user_id,u.email FROM gt_auth_identities i JOIN gt_auth_users u ON u.id=i.user_id WHERE i.issuer=? AND i.subject=?').bind(issuer,proof.subject).first();
    const existing=await lookup();if(existing){if(existing.email!==proof.email)throw Error('Identity change requires review');return existing.user_id;}
    const id=crypto.randomUUID();
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO gt_auth_users SELECT ?,?,? WHERE (SELECT count(*) FROM gt_auth_users)<50').bind(id,proof.email,now()),
      db.prepare('INSERT OR IGNORE INTO gt_auth_identities SELECT ?,?,id FROM gt_auth_users WHERE id=? AND email=?').bind(issuer,proof.subject,id,proof.email),
    ]);
    const linked=await lookup();if(!linked||linked.email!==proof.email)throw Error('Account linking requires review');return linked.user_id;
  };
  const authenticate=async request=>{
    const token=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];if(!token)return null;
    const row=await db.prepare('SELECT s.user_id,u.email,s.expires_at FROM gt_auth_sessions s JOIN gt_auth_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(await hash(token),now()).first();
    return row?{id:row.user_id,email:row.email,expiresAt:row.expires_at}:null;
  };
  const route=async request=>{
    const url=new URL(request.url),path=url.pathname;
    if(!['/auth/complete','/auth/kinde/callback','/api/session/exchange','/api/session/logout'].includes(path))return null;
    if(url.origin!==apiOrigin)return json(request,{error:'API origin rejected'},403);
    if(path==='/auth/complete'){
      if(request.method!=='GET')return json(request,{error:'GET required'},405);
      const state=url.searchParams.get('state'),challenge=url.searchParams.get('challenge');
      if(url.searchParams.getAll('state').length!==1||url.searchParams.getAll('challenge').length!==1||!opaque(state)||!opaque(challenge))return json(request,{error:'Invalid login start'},400);
      const binding=random(),oauthState=random(),nonce=random(),verifier=random();
      await db.prepare('DELETE FROM gt_kinde_logins WHERE expires_at<=?').bind(now()).run();
      const inserted=await db.prepare('INSERT INTO gt_kinde_logins SELECT ?,?,?,?,?,?,?,NULL WHERE (SELECT count(*) FROM gt_kinde_logins)<100').bind(await hash(binding),oauthState,nonce,verifier,state,challenge,now()+600000).run();
      if(!inserted.meta.changes)return json(request,{error:'Login capacity reached; retry later'},429);
      const authorize=new URL(issuer+'/oauth2/auth');authorize.search=new URLSearchParams({client_id:clientId,redirect_uri:callback,response_type:'code',scope:'openid email',state:oauthState,nonce,code_challenge:await hash(verifier),code_challenge_method:'S256',prompt:'login'}).toString();
      return new Response(null,{status:303,headers:{...safeHeaders,location:authorize.href,'set-cookie':cookie(binding)}});
    }
    if(path==='/auth/kinde/callback'){
      if(request.method!=='GET')return json(request,{error:'GET required'},405);
      const state=url.searchParams.get('state'),code=url.searchParams.get('code'),binding=request.headers.get('cookie')?.match(/(?:^|;\s*)__Host-gaintrace-kinde=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1];
      if(url.searchParams.getAll('state').length!==1||!opaque(state)||!binding||url.searchParams.has('error')||url.searchParams.getAll('code').length!==1||!code||code.length>4096)return reject();
      const bindingHash=await hash(binding),claimToken=random();
      const results=await db.batch([
        db.prepare('UPDATE gt_kinde_logins SET consumed=? WHERE binding_hash=? AND oauth_state=? AND expires_at>? AND consumed IS NULL').bind(claimToken,bindingHash,state,now()),
        db.prepare('SELECT * FROM gt_kinde_logins WHERE binding_hash=? AND consumed=?').bind(bindingHash,claimToken),
      ]);
      const transaction=results[1].results[0];if(!transaction)return reject();
      try{
        const tokens=await providerJson(issuer+'/oauth2/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,redirect_uri:callback,code,code_verifier:transaction.verifier})});
        const proof=await verifyIdentity(tokens.id_token,transaction.nonce),userId=await identity(proof),handoff=random();
        await db.prepare('INSERT INTO gt_auth_handoffs VALUES(?,?,?,?,?,?,NULL)').bind(await hash(handoff),userId,transaction.client_state,transaction.client_challenge,Math.min(now()+60000,proof.expiresAt),proof.expiresAt).run();
        const destination=new URL(returnUrl);destination.hash=new URLSearchParams({gt_code:handoff,gt_state:transaction.client_state}).toString();return redirect(destination.href);
      }catch{return reject();}
      finally{await db.prepare('DELETE FROM gt_kinde_logins WHERE binding_hash=? AND consumed=?').bind(bindingHash,claimToken).run();}
    }
    if(request.headers.get('origin')!==allowedOrigin)return json(request,{error:'Origin rejected'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...safeHeaders,...cors(request)}});
    if(request.method!=='POST')return json(request,{error:'POST required'},405);
    if(path==='/api/session/logout'){
      const token=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
      if(token)await db.prepare('DELETE FROM gt_auth_sessions WHERE token_hash=?').bind(await hash(token)).run();return json(request,{loggedOut:true});
    }
    if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return json(request,{error:'JSON required'},415);
    let body;try{body=JSON.parse(await bodyText(request,2000));}catch{return json(request,{error:'Invalid or oversized exchange'},400);}
    if(!body||Array.isArray(body)||!opaque(body.code)||!opaque(body.state)||typeof body.verifier!=='string'||! /^[A-Za-z0-9._~-]{43,128}$/.test(body.verifier))return json(request,{error:'Invalid exchange'},400);
    const token=random(),tokenHash=await hash(token),codeHash=await hash(body.code),challenge=await hash(body.verifier),stamp=now();
    const results=await db.batch([
      db.prepare('UPDATE gt_auth_handoffs SET consumed=? WHERE code_hash=? AND consumed IS NULL AND expires_at>? AND challenge=? AND state=?').bind(tokenHash,codeHash,stamp,challenge,body.state),
      db.prepare('INSERT INTO gt_auth_sessions SELECT ?,user_id,min(identity_expires_at,?) FROM gt_auth_handoffs WHERE code_hash=? AND consumed=?').bind(tokenHash,stamp+sessionTtlMs,codeHash,tokenHash),
    ]);
    if(!results[0].meta.changes)return json(request,{error:'Exchange expired or used'},401);
    const session=await authenticate(new Request(apiOrigin,{headers:{authorization:'Bearer '+token}}));
    if(!session)return json(request,{error:'Session unavailable'},401);
    return json(request,{token,user:{id:session.id,email:session.email},expiresAt:session.expiresAt});
  };
  return {route,authenticate,verifyIdentity,
    async cleanup(){await db.batch([db.prepare('DELETE FROM gt_kinde_logins WHERE expires_at<=?').bind(now()),db.prepare('DELETE FROM gt_auth_handoffs WHERE expires_at<=?').bind(now()),db.prepare('DELETE FROM gt_auth_sessions WHERE expires_at<=?').bind(now())]);},
  };
}
