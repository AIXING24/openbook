import {emailSession} from './email-session.mjs';
import {ledgerApi} from './ledger-api.mjs';
import {initializeDemo} from './mock-ledger.mjs';
import {indexedDbStore} from './indexeddb-store.mjs';
import {cloudSync} from './sync.mjs';
import {normalizeTrade,dateAt} from '../backend/validation.mjs';
import {emptyPosition,applyTrade} from '../backend/valuation.mjs';
const el=id=>document.getElementById(id),status=el('status');
const manager=emailSession({endpoint:location.origin,stripFragment:()=>history.replaceState(null,'',location.pathname)});
const store=indexedDbStore({name:'gaintrace-ledger-pilot-v1'});
let api,sync,busy=false;
const modes={synced:'已同步',pending:'待同步',offline:'网络不可用，操作已保留',conflict:'存在其他设备修改，已暂停提交',rejected:'操作未被接受，已保留', 'auth-required':'登录已失效，操作已保留'};
const number=value=>Number(value).toFixed(2);
const row=(parent,values)=>{const tr=document.createElement('tr');for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td);}parent.append(tr);};
async function render(){
  if(!sync)return;
  const view=await sync.snapshot();
  el('sync-status').textContent=(modes[view.mode]||view.mode)+' · 待同步 '+view.pending+' 笔 · 云端版本 '+view.confirmedRevision;
  if(view.mode==='auth-required')el('login').hidden=false;
  el('contents').hidden=false;
  const positions=new Map();
  for(const t of [...view.state.trades].sort((a,b)=>a.date.localeCompare(b.date)||a.ts-b.ts)){if(!positions.has(t.tc))positions.set(t.tc,emptyPosition(t.cur));applyTrade(positions.get(t.tc),t);}
  el('positions').replaceChildren();let realized=0,unrealized=0;
  const order=view.state.positionOrder.length?view.state.positionOrder:[...positions.keys()];
  for(const tc of order){const p=positions.get(tc);if(!p)continue;realized+=p.realized;unrealized+=p.shares*(tc==='us100001'?60:95)-p.cost;row(el('positions'),['模拟股票 '+(tc==='us100001'?'1':'2'),p.shares+(p.shares===0?'（已清仓）':''),'$'+number(p.cost),'$'+number(p.realized)]);}
  el('stats').replaceChildren();for(const [label,value] of [['已实现盈亏',realized],['按固定模拟价格计算的总盈亏',realized+unrealized]]){const item=document.createElement('div');item.textContent=label;const strong=document.createElement('strong');strong.textContent='$'+number(value);strong.className='profit';item.append(strong);el('stats').append(item);}
  el('trades').replaceChildren();for(const t of [...view.state.trades].sort((a,b)=>b.date.localeCompare(a.date)||b.ts-a.ts))row(el('trades'),[t.date,'模拟股票 '+(t.tc==='us100001'?'1':'2'),t.side==='B'?'买入':t.side==='S'?'卖出':'分红','$'+number(t.px),t.qty]);
}
async function historyRead(){
  if(!sync)return;
  try{
    const view=await sync.snapshot(),points=await api.readHistory(view.confirmedRevision);el('history').replaceChildren();
    el('history-status').textContent=points.length?'以下是云端保存的模拟日终记录；失效记录等待重算。':'尚无日终点。此阶段先验证账本同步，日终调度将在下一阶段验收。';
    for(const point of points){const p=document.createElement('p');p.textContent=point.date+' · '+(point.status==='confirmed'?'模拟已确认：$'+number(point.amounts.USD.realized+point.amounts.USD.unrealized):'待重算');el('history').append(p);}
  }catch{el('history').replaceChildren();el('history-status').textContent='日终记录暂时无法读取，账本同步状态见上方。';}
}
const action=async work=>{
  if(busy)return;busy=true;const buttons=[...document.querySelectorAll('#ledger button')];buttons.forEach(b=>b.disabled=true);
  try{await work();}catch{el('sync-status').textContent='操作未完成，请恢复网络或重新登录后重试。只有成功保存到本机的操作才会保留。';}
  finally{busy=false;buttons.forEach(b=>b.disabled=false);}
};
el('login').onclick=async()=>{el('login').disabled=true;try{location.assign(await manager.begin());}catch{status.textContent='登录未能开始，请稍后再试。';el('login').disabled=false;}};
el('logout').onclick=async()=>{
  if(busy)return;busy=true;el('logout').disabled=true;const result=await manager.logout();
  sync=null;api=null;el('ledger').hidden=true;el('positions').replaceChildren();el('trades').replaceChildren();el('stats').replaceChildren();el('history').replaceChildren();
  status.textContent=result.remoteRevoked?'测试会话已退出。待同步模拟记录保留在本机。':'本机已退出，云端撤销未确认；待同步模拟记录保留。';el('logout').hidden=true;el('logout').disabled=false;el('login').hidden=false;busy=false;
};
el('seed').onclick=()=>action(async()=>{const snapshot=await initializeDemo(api,message=>el('sync-status').textContent=message);await sync.initialize(snapshot);el('seed').hidden=true;await render();await historyRead();});
el('refresh').onclick=()=>action(async()=>{await sync.refresh();await render();await historyRead();});
el('flush').onclick=()=>action(async()=>{await sync.flush();await render();await historyRead();});
el('trade-form').onsubmit=event=>{event.preventDefault();action(async()=>{
  const fields=new FormData(event.target),tc=fields.get('tc'),trade=normalizeTrade({id:crypto.randomUUID(),date:dateAt(Date.now()),tc,mkt:'us',name:'Mock stock '+(tc==='us100001'?1:2),cur:'USD',side:fields.get('side'),px:Number(fields.get('px')),qty:Number(fields.get('qty')),fee:0,broker:'Mock HSBC',note:'模拟数据',ts:Date.now()});
  await sync.enqueue({kind:'upsert-trade',trade});await render();await sync.flush();await render();
});};
el('export').onclick=()=>action(async()=>{const record=await sync.exportPending();const blob=new Blob([JSON.stringify({format:'GainTrace simulated pending edits',schema:1,record},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='gaintrace-mock-pending.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
window.addEventListener('online',()=>{if(sync)action(async()=>{await sync.flush();await render();});});
window.addEventListener('focus',()=>{if(sync)action(()=>render());});
try{
  if(new URLSearchParams(location.hash.slice(1)).has('gt_error')){history.replaceState(null,'',location.pathname);throw Error('Rejected login');}
  const session=await manager.complete(location.href);
  if(!session){status.textContent='点击下方按钮开始测试登录。';el('login').hidden=false;}
  else{
    const proof=await fetch('/api/session/me',{headers:{authorization:'Bearer '+session.token},credentials:'omit',signal:AbortSignal.timeout(15000)});
    if(!proof.ok||(await proof.json()).id!==session.user.id)throw Error('Session confirmation failed');
    api=ledgerApi({endpoint:location.origin,identityKey:session.identityKey,getSession:()=>manager.get(),fetch:async(...args)=>{if(el('offline').checked)throw Error('Simulated offline');return fetch(...args);}});
    sync=cloudSync({store,identityKey:session.identityKey,api});
    status.textContent='邮箱登录与云端会话验证通过。';el('logout').hidden=false;el('ledger').hidden=false;
    const saved=await store.read(session.identityKey),snapshot=await api.readSnapshot();
    if(saved){await sync.initialize(snapshot);await sync.flush();await render();await historyRead();}
    else if(snapshot.state){await sync.initialize(snapshot);await render();await historyRead();}
    else{el('seed').hidden=false;el('sync-status').textContent='此邮箱还没有模拟账本，点击「创建模拟账本」开始。';}
  }
}catch{status.textContent='登录或账本读取未能完成，请重新开始验证。';el('login').hidden=false;}
