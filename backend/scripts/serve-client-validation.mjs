// Loopback-only, fixed allowlist. No account credentials or cloud API proxy.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
const files=new Map([['/','../../client/tests/browser.html'],['/client/sync.mjs','../../client/sync.mjs'],['/client/indexeddb-store.mjs','../../client/indexeddb-store.mjs'],['/backend/validation.mjs','../validation.mjs']]);
const server=http.createServer(async(request,response)=>{
  const path=new URL(request.url,'http://localhost').pathname,target=files.get(path);
  if(request.method!=='GET'||!target){response.writeHead(404);response.end();return;}
  try{const content=await readFile(new URL(target,import.meta.url));response.writeHead(200,{'content-type':path==='/'?'text/html;charset=utf-8':'text/javascript','cache-control':'no-store'});response.end(content);}catch{response.writeHead(500);response.end();}
});
server.listen(8789,'127.0.0.1',()=>console.log('Client storage validation: http://127.0.0.1:8789/'));
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
