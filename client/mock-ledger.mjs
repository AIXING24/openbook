import {normalizeTrade} from '../backend/validation.mjs';
import {packImport} from '../backend/import-format.mjs';
export function demoState(){
  const trades=[
    ['demo-buy-1','2026-11-18','us100001',1,'B',50,10],
    ['demo-sell-1','2026-11-19','us100001',1,'S',55,10],
    ['demo-buy-2','2026-11-18','us100002',2,'B',80,5],
    ['demo-sell-2','2026-11-20','us100002',2,'S',85,2],
  ].map(([id,date,tc,n,side,px,qty],ts)=>normalizeTrade({id,date,tc,name:'Mock stock '+n,mkt:'us',cur:'USD',side,px,qty,fee:0,broker:'Mock HSBC',note:'模拟数据',ts}));
  return {v:1,base:'USD',upRed:false,theme:'auto',brokers:['Mock HSBC'],lastBroker:'Mock HSBC',lastBackup:0,demoVersion:1,seeded:true,positionOrder:['us100002','us100001'],trades};
}
// Only a fixed synthetic preset is exposed in the pilot UI. No file picker or
// personal ledger upload is enabled. Existing cloud ledgers are never replaced.
export async function initializeDemo(api,onProgress=()=>{}){
  const existing=await api.readSnapshot();if(existing.state)return existing;
  const state=demoState(),packed=await packImport({schema:1,state},{state,history:null});
  const call=async(path,body)=>{const reply=await api.request(path,body);if(reply.status!==200)throw Error('Demo setup failed: '+reply.status);return reply;};
  const started=(await call('/import/start',packed.manifest)).body,id=started.id;
  for(let n=started.nextPart;n<packed.texts.length;n++){await call('/import/part',{id,number:n,text:packed.texts[n]});onProgress('保存模拟片段 '+(n+1)+'/'+packed.texts.length);}
  let verified=false;
  for(let n=0;n<packed.texts.length+2;n++){const result=(await call('/import/verify',{id})).body;if(result.verified){verified=true;break;}onProgress('核验模拟数据…');}
  if(!verified)throw Error('Demo verification incomplete');
  for(let n=0;n<packed.texts.length;n++){const reply=await call('/import/part?id='+encodeURIComponent(id)+'&number='+n);if(reply.text!==packed.texts[n])throw Error('Staged data mismatch');}
  await call('/import/activate',{id,root:packed.manifest.root});return api.readSnapshot();
}
