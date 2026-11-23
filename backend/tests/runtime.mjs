import {readFileSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import {fixture,old} from '../../prototypes/cloudflare-migration/runtime.mjs';
import {packImport} from '../import-format.mjs';
export {fixture,old,packImport};
export async function runtime() {
  const mf=new Miniflare({modules:true,scriptPath:new URL('../worker.mjs',import.meta.url).pathname,compatibilityDate:'2026-08-06',cf:false,host:'127.0.0.1',port:0,d1Databases:{DB:'NORMALIZED-wipe-me'},d1Persist:false,bindings:{VALIDATION_MODE:'mock-only',TEST_ALICE_TOKEN:'MOCK-ALICE',TEST_BOB_TOKEN:'MOCK-BOB-LOCAL',TEST_ADMIN_TOKEN:'MOCK-ADMIN-LOCAL'}});
  const db=await mf.getD1Database('DB');
  try{await db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8').split('\n').filter(line=>line && !line.startsWith('--')).join('\n'));}catch(error){await mf.dispose();throw error;}
  const call=async(role,path,body)=>{const r=await mf.dispatchFetch('http://mock.invalid'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+(role==='alice'?'MOCK-ALICE':role==='bob'?'MOCK-BOB-LOCAL':role==='admin'?'MOCK-ADMIN-LOCAL':'no-access'),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await r.text();let value;try{value=JSON.parse(text);}catch{value={error:text.slice(0,500)};}return {status:r.status,body:value};};
  return {mf,db,call,close:()=>mf.dispose()};
}
export async function upload(r,role,backup,{activate=true}={}) {
  const prepared=old.prepareImport(backup), packed=await packImport(backup,prepared);
  let res=await r.call(role,'/import/start',packed.manifest);if(res.status!==200)throw Error(JSON.stringify(res));
  const id=res.body.id;
  for(let n=res.body.nextPart;n<packed.texts.length;n++){res=await r.call(role,'/import/part',{id,number:n,text:packed.texts[n]});if(res.status!==200)throw Error(JSON.stringify({n,...res}));}
  for(let n=0;n<packed.texts.length+2;n++){res=await r.call(role,'/import/verify',{id});if(res.status!==200)throw Error(JSON.stringify(res));if(res.body.verified)break;}if(!res.body.verified)throw Error('Verification did not finish');
  // Client verifies every frozen server segment before activation; raw legacy evidence is untouched.
  for(let n=0;n<packed.texts.length;n++){res=await r.call(role,'/import/part?id='+id+'&number='+n);if(JSON.stringify(res.body)!==packed.texts[n])throw Error('Server staged content differs');}
  if(activate){res=await r.call(role,'/import/activate',{id,root:packed.manifest.root});if(res.status!==200)throw Error(JSON.stringify(res));}
  return {id,prepared,packed};
}
export async function finishDate(r,role,date,{limit=200}={}) {
  const log=[];
  for(let n=0;n<limit;n++){const result=await r.call('admin','/validation/step',{account:role,date});if(result.status!==200)throw Error(JSON.stringify(result));log.push(result.body);if(['confirmed','already-confirmed','pending'].includes(result.body.status))return log;}
  throw Error('Job did not finish within bounded invocations');
}
