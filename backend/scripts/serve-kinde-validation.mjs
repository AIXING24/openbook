// Loopback-only OIDC probe for the existing public Kinde application.
// No ledger, refresh token storage, cloud configuration change, or production session.
import http from 'node:http';
import {randomBytes,createHash,createPublicKey,verify,timingSafeEqual} from 'node:crypto';
import {writeFile} from 'node:fs/promises';

const issuer='https://gaintrace.kinde.com';
const clientId='aa0b21876d724d4482f6d1af6cc8181e';
const origin='http://localhost:3000';
const expectedEmail=process.env.GAINTRACE_TEST_EMAIL?.trim().toLowerCase();
if(!expectedEmail||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(expectedEmail))throw Error('Set GAINTRACE_TEST_EMAIL to the explicitly authorized test recipient');
const random=()=>randomBytes(32).toString('base64url');
const digest=value=>createHash('sha256').update(value).digest('base64url');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const pending=new Map();
let report={version:'auth probe v0.1.0',stage:'ready',productionIntegrated:false};
const headers={'cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://gaintrace.kinde.com; frame-ancestors 'none'; base-uri 'none'",'x-content-type-options':'nosniff'};
const page=(title,body)=>'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title><body style="font:17px system-ui;max-width:560px;margin:12vh auto;padding:24px;color:#173b2d"><h1>'+title+'</h1>'+body+'</body></html>';
const finish=async result=>{
  report={...report,...result,completedAt:new Date().toISOString()};
  // Only protocol booleans and public configuration; never email, subject, token or code.
  await writeFile('/private/tmp/gaintrace-kinde-login-report.json',JSON.stringify(report,null,2),{mode:0o600});
};
const fetchJson=async(url,options={})=>{
  const response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Provider request rejected');
  const text=await response.text();if(Buffer.byteLength(text)>64000)throw Error('Provider response too large');
  return JSON.parse(text);
};
const server=http.createServer(async(request,response)=>{
  const host=request.headers.host;
  if(host!=='localhost:3000'){response.writeHead(403,headers);response.end('Loopback host required');return;}
  const url=new URL(request.url,origin);
  const cookie=request.headers.cookie?.match(/(?:^|;\s*)gt_probe=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1];
  const session=pending.get(cookie);
  for(const [id,value] of pending)if(Date.now()-value.createdAt>600000)pending.delete(id);
  const html=(body,status=200,extraHeaders={})=>{response.writeHead(status,{...headers,...extraHeaders,'content-type':'text/html;charset=utf-8'});response.end(body);};
  const redirect=path=>{response.writeHead(303,{...headers,location:origin+path});response.end();};
  try{
    if(url.pathname==='/'&&request.method==='GET'&&(url.searchParams.has('code')||url.searchParams.has('error'))){
      if(!session||Date.now()-session.createdAt>600000||!equal(url.searchParams.get('state'),session.state))return html(page('回调已拒绝','<p>登录状态不匹配或已过期。请从本机验证页面重新开始。</p>'),401);
      pending.delete(cookie);
      if(url.searchParams.has('error')){await finish({stage:'provider-rejected'});return redirect('/result');}
      const code=url.searchParams.get('code');
      if(!code||code.length>4096){await finish({stage:'invalid-callback'});return redirect('/result');}
      const tokens=await fetchJson(issuer+'/oauth2/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,redirect_uri:origin,code,code_verifier:session.verifier})});
      const parts=typeof tokens.id_token==='string'&&tokens.id_token.length<=16000?tokens.id_token.split('.'):[];
      if(parts.length!==3||parts.some(p=>! /^[A-Za-z0-9_-]+$/.test(p)))throw Error('Malformed ID token');
      const tokenHeader=JSON.parse(Buffer.from(parts[0],'base64url')),claims=JSON.parse(Buffer.from(parts[1],'base64url'));
      const now=Date.now()/1000;
      if(tokenHeader.alg!=='RS256'||typeof tokenHeader.kid!=='string'||tokenHeader.kid.length>200||claims.iss!==issuer||!(Array.isArray(claims.aud)?claims.aud:[claims.aud]).includes(clientId)||!equal(claims.nonce,session.nonce)||typeof claims.sub!=='string'||!claims.sub||!Number.isFinite(claims.exp)||claims.exp<=now||!Number.isFinite(claims.iat)||claims.iat>now+30||claims.exp<=claims.iat||(claims.nbf!==undefined&&(!Number.isFinite(claims.nbf)||claims.nbf>now+30))||(Array.isArray(claims.aud)&&claims.aud.length>1&&claims.azp!==clientId))throw Error('ID token claims rejected');
      const jwks=await fetchJson(issuer+'/.well-known/jwks');
      const jwk=Array.isArray(jwks.keys)&&jwks.keys.length<=20?jwks.keys.find(k=>k.kid===tokenHeader.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig')):null;
      if(!jwk||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:jwk,format:'jwk'}),Buffer.from(parts[2],'base64url')))throw Error('ID token signature rejected');
      if(typeof claims.email!=='string'||claims.email.trim().toLowerCase()!==expectedEmail)throw Error('Unexpected test identity');
      let profileEvidence='not-requested';
      if(claims.email_verified!==true&&typeof tokens.access_token==='string'){
        const profile=await fetchJson(issuer+'/oauth2/v2/user_profile',{headers:{authorization:'Bearer '+tokens.access_token}});
        const sameSubject=(profile.sub??profile.id)===claims.sub;
        const sameEmail=typeof profile.email==='string'&&profile.email.toLowerCase()===expectedEmail;
        profileEvidence=sameSubject&&sameEmail&&profile.email_verified===true?'verified':sameSubject&&sameEmail?'matching-but-unverified':'identity-mismatch';
      }
      await finish({stage:'identity-checked',issuer,clientId,pkceWithoutSecret:true,idTokenSignature:true,issuerAudienceNonce:true,testEmailMatches:true,emailVerifiedClaim:claims.email_verified===true?'true':claims.email_verified===false?'false':'missing',profileEvidence,claimNames:Object.keys(claims).sort(),amr:Array.isArray(claims.amr)?claims.amr.filter(x=>typeof x==='string'&&x.length<80):[],productionSessionIssued:false});
      return redirect('/result');
    }
    if(url.pathname==='/'&&request.method==='GET'){
      if(pending.size>=10)return html(page('请稍后重试','<p>本机待验证请求已达到上限。</p>'),429);
      const id=random(),csrf=random();pending.set(id,{createdAt:Date.now(),csrf});
      response.setHeader('set-cookie','gt_probe='+id+'; HttpOnly; SameSite=Lax; Path=/; Max-Age=600');
      // POST form Origin becomes "null" under no-referrer. Permit referrers
      // only to this loopback origin on the start page; callbacks stay no-referrer.
      return html(page('GainTrace 邮箱登录验证','<p>使用现有 Kinde 公共应用和本机回调，仅检查登录协议，不接入个人账本。</p><p>点击后在 Kinde 官方页面输入已指定的测试邮箱；验证码和注册确认由你完成。</p><form method="post" action="/login"><input type="hidden" name="csrf" value="'+csrf+'"><button style="padding:12px 18px;font:inherit">打开 Kinde 邮箱登录</button></form>'),200,{'referrer-policy':'same-origin'});
    }
    if(url.pathname==='/login'&&request.method==='POST'){
      if(request.headers.origin!==origin||!session){
        console.log(JSON.stringify({probe:'local-browser-binding',origin:request.headers.origin??null,cookiePresent:Boolean(cookie),transactionPresent:Boolean(session)}));
        return html(page('请求已拒绝','<p>请从本机页面开始登录。</p>'),403);
      }
      let text='';for await(const chunk of request){text+=chunk;if(text.length>1000)return html(page('请求过大',''),413);}
      if(!equal(new URLSearchParams(text).get('csrf'),session.csrf))return html(page('请求已拒绝',''),403);
      session.state=random();session.nonce=random();session.verifier=random();
      report={version:'auth probe v0.1.0',stage:'awaiting-user',productionIntegrated:false};
      console.log(JSON.stringify({probe:'local-browser-binding',originAccepted:true,transactionBound:true,authorizationRedirect:true}));
      const authorize=new URL(issuer+'/oauth2/auth');authorize.search=new URLSearchParams({client_id:clientId,redirect_uri:origin,response_type:'code',scope:'openid profile email',state:session.state,nonce:session.nonce,code_challenge:digest(session.verifier),code_challenge_method:'S256',prompt:'login'}).toString();
      response.writeHead(303,{...headers,location:authorize.href});response.end();return;
    }
    if(url.pathname==='/result'&&request.method==='GET'){
      const checked=report.stage==='identity-checked';
      return html(page(checked?'登录协议验证已完成':'登录验证未通过',checked?'<p>签名、issuer、audience、nonce、PKCE 和测试邮箱匹配检查均通过。</p><p>邮箱验证标记：'+report.emailVerifiedClaim+'；用户资料证据：'+report.profileEvidence+'。</p><p>未签发生产会话，未读取或迁移任何账本。请回到聊天继续。</p>':'<p>当前阶段：'+report.stage+'。未签发任何会话，请回到聊天排查。</p>'));
    }
    response.writeHead(404,headers);response.end();
  }catch{
    await finish({stage:'protocol-check-failed'});redirect('/result');
  }
});
server.listen(3000,'127.0.0.1',()=>console.log('Kinde loopback validation ready: http://localhost:3000'));
const close=()=>server.close(()=>process.exit(0));
process.on('SIGINT',close);process.on('SIGTERM',close);
