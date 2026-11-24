// Candidate Pages wrapper: email allowlist/configuration must be explicitly enabled.
// Keeps the existing mock API; no production frontend or ledger is connected.
import pages from './pages.mjs';
import {kindeAuth} from './kinde-auth.mjs';
let previous,auth;
const safe={'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'};
const configuration=env=>{
  if(env.AUTH_MODE!=='kinde-test-only'||typeof env.AUTH_ALLOWED_EMAILS!=='string')return null;
  let emails;try{emails=JSON.parse(env.AUTH_ALLOWED_EMAILS);}catch{return null;}
  if(!Array.isArray(emails)||!emails.length)return null;
  const key=[env.DB,env.AUTH_ISSUER,env.AUTH_CLIENT_ID,env.AUTH_API_ORIGIN,env.AUTH_ALLOWED_EMAILS];
  if(!previous||key.some((v,i)=>v!==previous[i])){
    auth=kindeAuth({db:env.DB,issuer:env.AUTH_ISSUER,clientId:env.AUTH_CLIENT_ID,apiOrigin:env.AUTH_API_ORIGIN,allowedOrigin:env.AUTH_API_ORIGIN,returnUrl:env.AUTH_API_ORIGIN+'/auth/test',allowedEmails:emails});previous=key;
  }
  return auth;
};
export default {
  async fetch(request,env,context){
    const url=new URL(request.url),path=url.pathname;
    if(path.startsWith('/auth/')||path.startsWith('/api/session/')){
      let candidate;try{candidate=configuration(env);}catch{return Response.json({error:'Auth configuration invalid'},{status:503,headers:safe});}
      if(!candidate)return Response.json({error:'Auth validation not enabled'},{status:503,headers:safe});
      if(url.origin!==env.AUTH_API_ORIGIN)return Response.json({error:'Auth hostname rejected'},{status:403,headers:safe});
      if(['/auth/email-session.mjs','/auth/test-client.mjs'].includes(path)&&request.method==='GET')return env.ASSETS.fetch(request);
      if(path==='/auth/test'&&request.method==='GET')return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GainTrace 邮箱登录验证</title><body style="font:17px system-ui;max-width:560px;margin:12vh auto;padding:24px;color:#173b2d"><h1>GainTrace 邮箱登录验证</h1><p>这是模拟登录验证，请使用指定的测试邮箱。</p><p id="status">正在检查登录状态…</p><button id="login" hidden>邮箱验证码登录</button><button id="logout" hidden>退出测试登录</button><script type="module" src="/auth/test-client.mjs"></script></body></html>',{headers:{...safe,'content-type':'text/html;charset=utf-8','content-security-policy':"default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"}});
      if(path==='/api/session/me'&&request.method==='GET'){
        const user=await candidate.authenticate(request);
        return user?Response.json({id:user.id,expiresAt:user.expiresAt},{headers:safe}):Response.json({error:'Session required'},{status:401,headers:safe});
      }
      const result=await candidate.route(request);return result||Response.json({error:'Unknown auth route'},{status:404,headers:safe});
    }
    return pages.fetch(request,env,context);
  },
};
