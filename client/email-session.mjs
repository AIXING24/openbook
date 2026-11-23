const base64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const random=()=>base64(crypto.getRandomValues(new Uint8Array(32)));
const digest=async text=>base64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
// Only the pending PKCE verifier is in sessionStorage. Access JWTs and app
// sessions are never written to the durable ledger or offline queue.
export function emailSession({endpoint,storage=globalThis.sessionStorage,fetch:fetcher=globalThis.fetch,now=()=>Date.now(),stripFragment}) {
  const api=new URL(endpoint);if(api.protocol!=='https:'||api.username||api.password||api.search||api.hash||api.pathname!=='/')throw Error('Fixed HTTPS API origin required');
  const key='gaintrace-login:'+api.origin;let current=null;
  const request=async(path,options)=>{
    const response=await fetcher(api.origin+path,{...options,credentials:'omit',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('Login request failed: '+response.status);return response;
  };
  return {
    async begin(){
      const verifier=random(),state=random(),challenge=await digest(verifier);
      storage.setItem(key,JSON.stringify({verifier,state,requestedAt:now()}));
      const url=new URL('/auth/complete',api);url.search=new URLSearchParams({state,challenge}).toString();return url.href;
    },
    async complete(url){
      const fragment=new URLSearchParams(new URL(url).hash.slice(1)),code=fragment.get('gt_code'),state=fragment.get('gt_state');
      if(!code&&!state)return null;
      // The UI must remove sensitive fragments before sending the exchange.
      if(typeof stripFragment!=='function')throw Error('Fragment cleanup required');stripFragment();
      let pending;try{pending=JSON.parse(storage.getItem(key));}catch{}
      if(!pending||pending.state!==state||typeof pending.verifier!=='string'||!Number.isFinite(pending.requestedAt)||pending.requestedAt>now()||now()-pending.requestedAt>600000||! /^[A-Za-z0-9_-]{43}$/.test(code||''))throw Error('Login state mismatch or expired');
      const response=await request('/api/session/exchange',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code,state,verifier:pending.verifier})});
      const session=await response.json();
      if(! /^[A-Za-z0-9_-]{43}$/.test(session.token||'')||typeof session.user?.id!=='string'||!session.user.id||!Number.isFinite(session.expiresAt)||session.expiresAt<=now())throw Error('Invalid authenticated session');
      current={token:session.token,user:session.user,expiresAt:session.expiresAt,identityKey:api.origin+'|'+session.user.id};
      storage.removeItem(key);return structuredClone(current);
    },
    get(){if(current&&current.expiresAt<=now())current=null;return current?structuredClone(current):null;},
    async logout(){
      const prior=current;current=null;storage.removeItem(key);
      if(!prior)return {remoteRevoked:true};
      try{await request('/api/session/logout',{method:'POST',headers:{authorization:'Bearer '+prior.token}});return {remoteRevoked:true};}catch{return {remoteRevoked:false};}
    },
  };
}
