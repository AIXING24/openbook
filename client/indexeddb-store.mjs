// One record per authenticated account: cache and pending edits commit together.
export function indexedDbStore({indexedDB=globalThis.indexedDB,name='gaintrace-cloud-cache-v1'}={}) {
  let database;
  const open=()=>database??=new Promise((resolve,reject)=>{
    if(!indexedDB){reject(Error('IndexedDB unavailable'));return;}
    const request=indexedDB.open(name,1);
    let finished=false;
    const fail=error=>{if(!finished){finished=true;clearTimeout(timer);reject(error);}};
    const timer=setTimeout(()=>fail(Error('IndexedDB open timed out')),5000);
    request.onupgradeneeded=()=>request.result.createObjectStore('accounts');
    request.onerror=()=>fail(request.error);
    request.onblocked=()=>fail(Error('IndexedDB upgrade blocked'));
    request.onsuccess=()=>{
      if(finished){request.result.close();return;}
      finished=true;clearTimeout(timer);
      const db=request.result;db.onversionchange=()=>db.close();resolve(db);
    };
  });
  const transaction=async(key,mode,reduce)=>{
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('accounts',mode),store=tx.objectStore('accounts');
      const request=store.get(key);let result,error;
      request.onsuccess=()=>{
        try{
          result=reduce?reduce(request.result??null):request.result??null;
          if(result?.then)throw Error('IndexedDB reducer must be synchronous');
          if(reduce)store.put(result,key);
        }catch(cause){error=cause;tx.abort();}
      };
      tx.oncomplete=()=>resolve(structuredClone(result));
      tx.onabort=()=>reject(error||tx.error||Error('IndexedDB transaction aborted'));
      tx.onerror=()=>{error??=tx.error;};
    });
  };
  return {
    read:key=>transaction(key,'readonly'),
    change:(key,reduce)=>transaction(key,'readwrite',reduce),
    close:async()=>{if(database)(await database).close();database=undefined;},
  };
}
