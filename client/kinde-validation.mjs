import {emailSession} from './email-session.mjs';
const status=document.getElementById('status'),login=document.getElementById('login'),logout=document.getElementById('logout');
const strip=()=>history.replaceState(null,'',location.pathname);
const manager=emailSession({endpoint:location.origin,stripFragment:strip});
login.addEventListener('click',async()=>{
  login.disabled=true;
  try{location.assign(await manager.begin());}catch{status.textContent='登录未能开始，请稍后再试。';login.disabled=false;}
});
logout.addEventListener('click',async()=>{
  logout.disabled=true;const result=await manager.logout();
  status.textContent=result.remoteRevoked?'测试会话已退出。':'本机已退出，云端撤销未确认，请稍后重试。';
  logout.hidden=true;logout.disabled=false;login.hidden=false;
});
try{
  if(new URLSearchParams(location.hash.slice(1)).has('gt_error')){strip();throw Error('Provider rejected');}
  const session=await manager.complete(location.href);
  if(session){
    const response=await fetch('/api/session/me',{headers:{authorization:'Bearer '+session.token},credentials:'omit',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('Session confirmation failed');
    const confirmed=await response.json();if(confirmed.id!==session.user.id)throw Error('Identity mismatch');
    status.textContent='邮箱登录与云端会话验证通过。此页没有接入真实账本。';logout.hidden=false;
  }else{status.textContent='点击下方按钮开始测试登录。';login.hidden=false;}
}catch{status.textContent='登录未能完成，请重新开始验证。';login.hidden=false;}
