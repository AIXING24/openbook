// Candidate Pages wrapper: email allowlist/configuration must be explicitly enabled.
// Authenticated synthetic ledgers are separate from the original mock accounts.
import pages from './pages.mjs';
import {kindeAuth} from './kinde-auth.mjs';
import {ledgerRoute} from './ledger-routes.mjs';
import {ledgerTestHtml} from './ledger-page.mjs';
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
    if(path.startsWith('/auth/')||path.startsWith('/api/session/')||path.startsWith('/api/ledger/')){
      let candidate;try{candidate=configuration(env);}catch{return Response.json({error:'Auth configuration invalid'},{status:503,headers:safe});}
      if(!candidate)return Response.json({error:'Auth validation not enabled'},{status:503,headers:safe});
      if(url.origin!==env.AUTH_API_ORIGIN)return Response.json({error:'Auth hostname rejected'},{status:403,headers:safe});
      if(['/auth/email-session.mjs','/auth/test-client.mjs','/auth/ledger-client.mjs'].includes(path)&&request.method==='GET'){
        const asset=await env.ASSETS.fetch(request),headers=new Headers(asset.headers);
        for(const [name,value] of Object.entries(safe))headers.set(name,value);
        return new Response(asset.body,{status:asset.status,headers});
      }
      if(path==='/auth/test'&&request.method==='GET')return new Response(ledgerTestHtml,{headers:{...safe,'content-type':'text/html;charset=utf-8','content-security-policy':"default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}});
      if(path.startsWith('/api/ledger/')){
        if(env.VALIDATION_MODE!=='mock-only')return Response.json({error:'Mock validation disabled'},{status:503,headers:safe});
        const route=path.slice('/api/ledger'.length);
        if(!['/meta','/trades','/history','/operation','/import/start','/import/part','/import/verify','/import/activate'].includes(route))return Response.json({error:'Unknown ledger route'},{status:404,headers:safe});
        const user=await candidate.authenticate(request);
        if(!user)return Response.json({error:'Session required'},{status:401,headers:safe});
        if(!['GET','POST'].includes(request.method))return Response.json({error:'Method not allowed'},{status:405,headers:safe});
        if(request.method==='POST'&&request.headers.get('origin')!==env.AUTH_API_ORIGIN)return Response.json({error:'Origin rejected'},{status:403,headers:safe});
        if(request.method==='POST'&&request.headers.get('content-type')?.split(';')[0]!=='application/json')return Response.json({error:'JSON required'},{status:415,headers:safe});
        url.pathname=route;
        // The UUID comes exclusively from the validated application session.
        const result=await ledgerRoute(new Request(url,request),env,'email:'+user.id);
        const headers=new Headers(result.headers);for(const [name,value] of Object.entries(safe))headers.set(name,value);
        return new Response(result.body,{status:result.status,headers});
      }
      if(path==='/api/session/me'&&request.method==='GET'){
        const user=await candidate.authenticate(request);
        return user?Response.json({id:user.id,expiresAt:user.expiresAt},{headers:safe}):Response.json({error:'Session required'},{status:401,headers:safe});
      }
      const result=await candidate.route(request);return result||Response.json({error:'Unknown auth route'},{status:404,headers:safe});
    }
    return pages.fetch(request,env,context);
  },
};
