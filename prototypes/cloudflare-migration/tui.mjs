import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createRuntime, fixture, FrontendPrototype } from './runtime.mjs';
const runtime=await createRuntime(),backup=await fixture(100,10),client=new FrontendPrototype(runtime,backup);
const rl=readline.createInterface({input:stdin,output:stdout});let last=null;
try{
  while(true){
    console.clear();console.log('THROWAWAY — 模拟账户、内存D1，无真实数据');
    const cloud=(await runtime.request('alice','/state')).body;
    console.log(JSON.stringify({local:client.summary(),cloud:{revision:cloud.revision,trades:cloud.state?.trades.length||0,legacyPoints:cloud.legacyHistory?.snapshots.length||0,confirmed:cloud.confirmedHistory.map(row=>({date:row.date,status:row.status}))},last},null,2));
    console.log('[s]开始/续传 [u]上传全部 [c]核验并切换 [o]切换离线 [a]新增模拟交易 [y]同步 [t]模拟收盘任务 [q]退出');
    const key=await rl.question('> ');if(key==='q')break;
    try{
      if(key==='s')last=await client.start();
      if(key==='u'){await client.upload();last={uploaded:client.parts.length};}
      if(key==='c'){const result=await client.finish();last={httpStatus:result.status,committed:result.body.committed,error:result.body.error};}
      if(key==='o'){client.offline=!client.offline;last={offline:client.offline};}
      if(key==='a'){client.edit({...backup.trades[1],id:crypto.randomUUID(),date:'2026-11-19',side:'B',qty:1,ts:Date.now()});last={pending:client.outbox.length};}
      if(key==='y')last=await client.sync();
      if(key==='t'){await runtime.seed('2026-11-18',backup.trades);last=await runtime.schedule('2026-11-18');}
    }catch(error){last={error:error.message};}
  }
}finally{rl.close();await runtime.close();}
