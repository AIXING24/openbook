// Browser-side packing after existing prepareImport has validated the whole backup.
export const digest = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
export const tradeSignature = t => JSON.stringify([t.date,t.tc,t.mkt,t.cur,t.side,t.px,t.qty,t.fee||0,t.amt??null,t.ts||0]);
export async function packImport(backup, prepared) {
  const {trades,...metadata}=prepared.state;
  const history=prepared.history;
  const parts=[{kind:'metadata',value:metadata}];
  for(let offset=0;offset<trades.length;offset+=10)parts.push({kind:'trades',offset,rows:trades.slice(offset,offset+10)});
  if(history){
    const {snapshots,ledger,...header}=history;
    parts.push({kind:'legacy-header',value:header});
    for(let offset=0;offset<ledger.length;offset+=20)parts.push({kind:'legacy-ledger',offset,rows:ledger.slice(offset,offset+20)});
    snapshots.forEach((value,index)=>parts.push({kind:'legacy-snapshot',index,value}));
  }
  const texts=parts.map(p=>JSON.stringify(p));
  let root='';for(const text of texts)root=await digest(root+':'+await digest(text));
  return {manifest:{sourceHash:await digest(JSON.stringify(backup)),root,parts:texts.length,trades:trades.length,snapshots:history?.snapshots.length||0,hasHistory:!!history},texts};
}
