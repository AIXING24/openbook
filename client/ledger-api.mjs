// Session credentials remain in memory; every request checks the bound owner.
export function ledgerApi({endpoint,getSession,identityKey,fetch:fetcher=globalThis.fetch}) {
  const origin=new URL(endpoint);
  if(origin.protocol!=='https:'||origin.origin!==endpoint||typeof getSession!=='function'||typeof identityKey!=='string')throw Error('Fixed authenticated API required');
  const request=async(path,body)=>{
    if(!/^\/(meta|trades|history|operation|import\/(start|part|verify|activate))(\?|$)/.test(path))throw Error('Unknown ledger route');
    const session=getSession();
    if(!session||session.identityKey!==identityKey||!session.token)return {status:401,body:{error:'Session required'}};
    const response=await fetcher(endpoint+'/api/ledger'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+session.token,...(body===undefined?{}:{'content-type':'application/json'})},credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000),...(body===undefined?{}:{body:JSON.stringify(body)})});
    const text=await response.text();let value;try{value=JSON.parse(text);}catch{value={error:'Invalid API response'};}
    return {status:response.status,body:value,text};
  };
  const read=async path=>{const reply=await request(path);if(reply.status!==200)throw Error('Ledger read failed: '+reply.status);return reply.body;};
  const pages=async(path,field,revision,initial,maximum)=>{
    const rows=[];let cursor=initial;
    for(let n=0;n<maximum;n++){
      const page=await read(path+'?after='+encodeURIComponent(cursor));
      if(page.revision!==revision)throw Error('Cloud changed during pagination; refresh again');
      if(!Array.isArray(page[field])||page[field].length>20)throw Error('Invalid page');
      rows.push(...page[field]);
      if(page[field].length<20)return rows;
      if(page.next<=cursor)throw Error('Invalid pagination cursor');cursor=page.next;
    }
    throw Error('Pagination capacity exceeded');
  };
  return {identityKey,request,
    async readSnapshot(){
      const meta=await read('/meta');if(!meta.state)return {...meta,confirmedHistory:[]};
      const trades=await pages('/trades','trades',meta.revision,-1,5001);
      // Recheck after the final page, including the empty final page case.
      const after=await read('/meta');
      if(after.revision!==meta.revision||after.generation!==meta.generation)throw Error('Cloud changed during pagination; refresh again');
      return {...meta,state:{...meta.state,trades}};
    },
    readHistory:revision=>pages('/history','points',revision,'',20),
    operation:body=>request('/operation',body),
  };
}
