import {normalizeTrade,validMetadata} from '../backend/validation.mjs';
const clone=value=>structuredClone(value);
const paused=record=>['conflict','rejected'].includes(record.mode);
const required=record=>{if(!record)throw Error('Cloud account not initialized');if(record.schema!==1)throw Error('Unsupported local cache schema');return record;};
function metadata(value) {
  if(!validMetadata(value))throw Error('Invalid cloud metadata');
  return Object.fromEntries(['v','base','upRed','theme','brokers','lastBroker','lastBackup','demoVersion','seeded','positionOrder'].map(key=>[key,clone(value[key])]));
}
function cloudSnapshot(value) {
  if(!value || !Number.isInteger(value.revision) || value.revision<1 || typeof value.generation!=='string' || !value.generation || !Array.isArray(value.state?.trades))throw Error('Invalid cloud ledger snapshot');
  const {trades,...settings}=value.state;
  const normalized=trades.map(normalizeTrade);
  if(new Set(normalized.map(t=>t.id)).size!==normalized.length)throw Error('Duplicate cloud trade ID');
  return {generation:value.generation,revision:value.revision,state:{...metadata(settings),trades:normalized}};
}
function edit(payload,id) {
  if(typeof id!=='string'||!id||id.length>200)throw Error('Invalid operation ID');
  if(payload?.kind==='upsert-trade')return {id,kind:payload.kind,trade:normalizeTrade(payload.trade)};
  if(payload?.kind==='delete-trade' && typeof payload.tradeId==='string' && payload.tradeId)return {id,kind:payload.kind,tradeId:payload.tradeId};
  if(payload?.kind==='preferences' && validMetadata(payload.preferences))return {id,kind:payload.kind,preferences:metadata(payload.preferences)};
  throw Error('Invalid local edit');
}
function apply(state,operation) {
  const next=clone(state);
  if(operation.kind==='upsert-trade'){
    const index=next.trades.findIndex(t=>t.id===operation.trade.id);
    if(index<0)next.trades.push(clone(operation.trade));else next.trades[index]=clone(operation.trade);
  }else if(operation.kind==='delete-trade')next.trades=next.trades.filter(t=>t.id!==operation.tradeId);
  else Object.assign(next,clone(operation.preferences));
  const stocks=new Set(next.trades.map(t=>t.tc));
  const kept=[...new Set(next.positionOrder.filter(tc=>stocks.has(tc)))];
  next.positionOrder=kept.length?kept.concat([...stocks].filter(tc=>!kept.includes(tc))):[];
  return next;
}
function view(record) {
  required(record);
  return {mode:record.mode,pending:record.queue.length,confirmedRevision:record.confirmed.revision,
    state:record.queue.reduce((state,item)=>apply(state,item.edit),record.confirmed.state),
    observedCloud:clone(record.observedCloud),reason:record.reason??null};
}
function conflict(record,snapshot,reason) {
  record.mode='conflict';record.reason=reason;record.observedCloud=clone(snapshot);return record;
}

// The API is bound to the verified identity. Session tokens belong in that API,
// never in this account record. A production API must load history separately.
export function cloudSync({store,identityKey,api,makeId=()=>crypto.randomUUID()}) {
  if(typeof identityKey!=='string'||!identityKey||api.identityKey!==identityKey)throw Error('API/account identity mismatch');
  let running;
  const mutate=reduce=>store.change(identityKey,record=>reduce(required(record)));
  const updateHead=(id,reduce)=>mutate(record=>record.queue[0]?.edit.id===id?reduce(record):record);
  const refreshRecord=(record,snapshot)=>{
    if(record.confirmed.generation!==snapshot.generation)return conflict(record,snapshot,'cloud-generation-changed');
    if(snapshot.revision<record.confirmed.revision)throw Error('Stale cloud read');
    if(record.queue.length && snapshot.revision!==record.confirmed.revision){
      // A previously sent edit may already have committed. Retry its immutable
      // wire operation before deciding whether the advance is a device conflict.
      if(record.queue[0].wire){record.observedCloud=snapshot;return record;}
      return conflict(record,snapshot,'other-device-edit');
    }
    record.confirmed=snapshot;record.observedCloud=null;
    if(!paused(record)){record.mode=record.queue.length?'pending':'synced';record.reason=null;}
    return record;
  };
  const flush=async(limit)=>{
    if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid flush limit');
    for(let n=0;n<limit;n++){
      const record=await mutate(record=>{
        if(!record.queue.length||paused(record))return record;
        record.queue[0].wire??={...clone(record.queue[0].edit),expectedRevision:record.confirmed.revision};
        record.mode='pending';record.reason=null;return record;
      });
      if(!record.queue.length||paused(record))break;
      const head=record.queue[0],id=head.edit.id;let reply;
      try{reply=await api.operation(clone(head.wire));}catch{
        await updateHead(id,r=>{r.mode='offline';r.reason='network-unavailable';return r;});break;
      }
      if(reply.status!==200){
        const mode=[401,403].includes(reply.status)?'auth-required':reply.status===409?'conflict':reply.status>=500||reply.status===429?'offline':'rejected';
        let observed=null;
        if(mode==='conflict')try{observed=cloudSnapshot(await api.readSnapshot());}catch{}
        await updateHead(id,r=>{r.mode=mode;r.reason=mode==='conflict'?'other-device-edit':'http-'+reply.status;r.observedCloud=observed;return r;});break;
      }
      let snapshot;
      try{
        if(!Number.isInteger(reply.body?.revision)||reply.body.revision<=head.wire.expectedRevision)throw Error('Invalid acknowledgement');
        snapshot=cloudSnapshot(await api.readSnapshot());
        if(snapshot.revision<reply.body.revision)throw Error('Read has not reached acknowledged revision');
      }catch{
        // Keep the sent operation, including its exact expectedRevision. It is
        // safe to resend after reopening even if the server already committed.
        await updateHead(id,r=>{r.mode='offline';r.reason='confirmation-read-unavailable';return r;});break;
      }
      await updateHead(id,r=>{
        if(snapshot.generation!==r.confirmed.generation)return conflict(r,snapshot,'cloud-generation-changed');
        if(snapshot.revision<r.confirmed.revision)return r;
        r.queue.shift();r.confirmed=snapshot;r.observedCloud=null;
        if(r.queue.length && snapshot.revision!==reply.body.revision)return conflict(r,snapshot,'other-device-edit');
        r.mode=r.queue.length?'pending':'synced';r.reason=null;return r;
      });
    }
    return view(await store.read(identityKey));
  };
  return {
    async initialize(value){
      const snapshot=cloudSnapshot(value);
      const record=await store.change(identityKey,record=>record?refreshRecord(required(record),snapshot):{schema:1,confirmed:snapshot,queue:[],mode:'synced',observedCloud:null,reason:null});
      return view(record);
    },
    snapshot:async()=>view(await store.read(identityKey)),
    async enqueue(payload,{id=makeId()}={}){
      const operation=edit(payload,id);
      const record=await mutate(record=>{
        const prior=record.queue.find(q=>q.edit.id===id);
        if(prior){if(JSON.stringify(prior.edit)!==JSON.stringify(operation))throw Error('Operation ID reused');return record;}
        // Both display data (derived from this record) and the queue become
        // durable in the same IndexedDB transaction. Do not report saved sooner.
        record.queue.push({edit:operation,wire:null});
        if(!paused(record)){record.mode='pending';record.reason=null;}
        return record;
      });
      return view(record);
    },
    // A refresh reads outside the IndexedDB transaction, then checks the current
    // queue inside it, so concurrent local edits cannot disappear.
    async refresh(){const snapshot=cloudSnapshot(await api.readSnapshot());return view(await mutate(record=>refreshRecord(record,snapshot)));},
    flush({limit=20}={}){return running??=(flush(limit).finally(()=>{running=undefined;}));},
    exportPending:async()=>clone(required(await store.read(identityKey))),
  };
}
