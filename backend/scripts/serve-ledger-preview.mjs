// Local UI harness only: uses a synthetic in-memory session and disposable D1.
// Authentication itself is covered by the native provider tests and cloud OTP.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
const origin='https://preview.example.test',id=crypto.randomUUID(),token='p'.repeat(43);
const mf=new Miniflare({modules:true,scriptPath:new URL('../kinde-pages.mjs',import.meta.url).pathname,compatibilityDate:'2026-08-06',cf:false,host:'127.0.0.1',port:0,d1Databases:{DB:'disposable-ui-preview'},d1Persist:false,bindings:{VALIDATION_MODE:'mock-only',AUTH_MODE:'kinde-test-only',AUTH_ISSUER:'https://test.kinde.com',AUTH_CLIENT_ID:'test-public-client-id',AUTH_API_ORIGIN:origin,AUTH_ALLOWED_EMAILS:'["preview@example.test"]'}});
const db=await mf.getD1Database('DB');
for(const name of ['schema.sql','schema-auth.sql','schema-kinde.sql'])await db.exec((await readFile(new URL('../'+name,import.meta.url),'utf8')).split('\n').filter(s=>s&&!s.startsWith('--')).join('\n'));
const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('base64url');
await db.batch([db.prepare('INSERT INTO gt_auth_users VALUES(?,?,?)').bind(id,'preview@example.test',Date.now()),db.prepare('INSERT INTO gt_auth_sessions VALUES(?,?,?)').bind(hash,id,Date.now()+3600000)]);
const output=await build({entryPoints:[new URL('../../client/ledger-validation.mjs',import.meta.url).pathname],bundle:true,format:'esm',platform:'browser',target:'es2022',write:false,plugins:[{name:'explicit-local-preview',setup(b){
  b.onResolve({filter:/email-session\.mjs$/},()=>({path:'synthetic-session',namespace:'local-preview'}));
  b.onLoad({filter:/.*/,namespace:'local-preview'},()=>({contents:`export function emailSession(){let current={token:${JSON.stringify(token)},user:{id:${JSON.stringify(id)}},identityKey:${JSON.stringify(origin+'|'+id)},expiresAt:Date.now()+3600000};return {complete:async()=>current,get:()=>current,begin:async()=>location.href,logout:async()=>{await fetch('/api/session/logout',{method:'POST',headers:{authorization:'Bearer '+current.token,'content-type':'application/json'},body:'{}'});current=null;return {remoteRevoked:true};}};}`,loader:'js'}));
  b.onLoad({filter:/ledger-validation\.mjs$/},async args=>({contents:(await readFile(args.path,'utf8')).replaceAll('endpoint:location.origin',`endpoint:${JSON.stringify(origin)}`).replace('return fetch(...args);','const target=new URL(args[0],location.href);return fetch(target.pathname+target.search,args[1]);'),resolveDir:new URL('../../client/',import.meta.url).pathname,loader:'js'}));
}}]});
const server=createServer(async(req,res)=>{
  try{
    if(req.url==='/auth/ledger-client.mjs'){res.writeHead(200,{'content-type':'text/javascript','cache-control':'no-store'});res.end(output.outputFiles[0].contents);return;}
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
    const headers={...req.headers,...(req.method==='POST'?{origin}: {})};
    const response=await mf.dispatchFetch(origin+(req.url==='/'?'/auth/test':req.url),{method:req.method,headers,redirect:'manual',...(req.method==='POST'?{body}: {})});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500);res.end('Local preview failed');}
});
server.listen(8790,'127.0.0.1',()=>console.log('Disposable mock ledger UI: http://127.0.0.1:8790/'));
const stop=()=>server.close(async()=>{await mf.dispose();process.exit(0);});process.on('SIGINT',stop);process.on('SIGTERM',stop);
