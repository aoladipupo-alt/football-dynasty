/* Football Dynasty 1.24k - independent atomic IndexedDB safety checkpoints.
 * This first phase mirrors, never removes or rewrites, localStorage careers.
 * No cloud sync, no automatic fallback that might conceal a corrupt save.
 */
(() => {
  'use strict';
  const DATABASE = 'football-dynasty-career-vault-124k';
  const STORE = 'checkpoints';
  const FORMAT = 'fd-career-vault-124k';
  const FIELDS = Object.freeze([
    'fd-manager-club-v1','fd-tactics-v2','fd-career-time-v1',
    'fd-match-saves-v3','fd-transfer-state-v1','fd-player-career-state-v1',
    'fd-training-state-v1','fd-world-state-v043','fd-027-dismissed-mail',
    'fd-shadow-prospects-v121i'
  ]);
  const encoder = new TextEncoder();
  let dbPromise = null;
  const inflight = new Map();
  const requireSlot = slot => {
    if (!Number.isInteger(slot) || slot < 1 || slot > 5) throw Error('Invalid save slot');
    return slot;
  };
  const keyFor = (slot, field) => 'fd-save-'+slot+'-'+field;
  const canonical = (slot, entries) => JSON.stringify({slot,entries: FIELDS.map(field => [field,entries[field] ?? null])});
  const hash = async plain => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(plain))))
    .map(x=>x.toString(16).padStart(2,'0')).join('');
  const req = r => new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||Error('IndexedDB request failed'));});
  function open(){
    if(dbPromise)return dbPromise;
    dbPromise=new Promise((resolve,reject)=>{
      if(!('indexedDB' in window)){reject(Error('IndexedDB unavailable; no data was changed'));return;}
      const request=indexedDB.open(DATABASE,1);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE);
      };
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};
      request.onerror=()=>reject(request.error||Error('Cannot open IndexedDB'));
      request.onblocked=()=>reject(Error('Close other Football Dynasty tabs to update the save vault'));
    }).catch(error=>{dbPromise=null;throw error;});
    return dbPromise;
  }
  async function records(slot){
    requireSlot(slot);
    const db=await open();
    const tx=db.transaction(STORE,'readonly'),store=tx.objectStore(STORE);
    const [head,previous]=await Promise.all([req(store.get(slot+':head')),req(store.get(slot+':previous'))]);
    return {head,previous};
  }
  function safeEntries(slot, entries){
    requireSlot(slot);
    if(!entries || typeof entries!=='object' || Array.isArray(entries)) throw Error('Checkpoint has no save fields');
    const copy=Object.create(null);
    for(const field of FIELDS){
      const value=Object.hasOwn(entries,field)?entries[field]:null;
      if(value!==null&&typeof value!=='string')throw Error('Checkpoint requires raw JSON strings');
      if(value!==null)JSON.parse(value);
      copy[field]=value;
    }
    const club=copy[FIELDS[0]];
    if(!club || typeof JSON.parse(club)!=='string' || !JSON.parse(club))throw Error('No valid occupied career in this slot');
    return copy;
  }
  async function valid(record, slot){
    if(!record || record.format!==FORMAT || record.slot!==slot ||
       !Number.isSafeInteger(record.revision) || record.revision<1 ||
       typeof record.sha256!=='string' || !record.entries)return false;
    try {
      const entries=safeEntries(slot,record.entries);
      return await hash(canonical(slot,entries))===record.sha256;
    } catch {return false;}
  }
  async function readVerified(slot){
    requireSlot(slot);
    const {head,previous}=await records(slot);
    if(await valid(head,slot))return {record:head,source:'head',recovered:false};
    if(await valid(previous,slot))return {record:previous,source:'previous',recovered:!!head};
    if(head||previous)throw Error('Both saved checkpoints failed verification; vault has not modified them');
    return null;
  }
  function transact(db,slot,expectedRevision,expectedHash,record,verifiedPrevious){
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);
      let problem=null;
      tx.oncomplete=()=>resolve(record);
      tx.onabort=()=>reject(problem||tx.error||Error('Vault checkpoint transaction aborted'));
      tx.onerror=()=>{problem=problem||tx.error;};
      const request=store.get(slot+':head');
      request.onsuccess=()=>{
        const current=request.result;
        const actual=current?.revision||0;
        if(actual!==expectedRevision || (current?.sha256||null)!==expectedHash){
          problem=Error('Career checkpoint changed in another tab; nothing was overwritten');tx.abort();return;
        }
        if(verifiedPrevious)store.put(verifiedPrevious,slot+':previous');
        store.put(record,slot+':head');
      };
      request.onerror=()=>{problem=request.error||Error('Unable to read checkpoint head');tx.abort();};
    });
  }
  async function checkpointImpl(slot, entries){
    const copy=safeEntries(slot,entries);
    const old=await records(slot);
    if(old.head && !(await valid(old.head,slot)))throw Error('Existing checkpoint failed integrity verification; no data changed');
    const revision=(old.head?.revision||0)+1;
    const record={format:FORMAT,slot,revision,createdAt:new Date().toISOString(),entries:copy,
      sha256:await hash(canonical(slot,copy))};
    const db=await open();
    await transact(db,slot,revision-1,old.head?.sha256||null,record,old.head||null);
    const committed=await readVerified(slot);
    if(!committed || committed.record.sha256!==record.sha256 || committed.source!=='head')
      throw Error('Checkpoint was not verified after commit');
    return Object.freeze({slot,revision,createdAt:record.createdAt,sha256:record.sha256,
      totalRawCharacters:canonical(slot,copy).length});
  }
  function checkpoint(slot,entries){
    requireSlot(slot);
    const prior=inflight.get(slot)||Promise.resolve();
    const next=prior.catch(()=>{}).then(()=>checkpointImpl(slot,entries));
    inflight.set(slot,next);
    next.finally(()=>{if(inflight.get(slot)===next)inflight.delete(slot);}).catch(()=>{});
    return next;
  }
  function snapshotLocal(slot,storage=localStorage){
    requireSlot(slot);
    const entries=Object.create(null);
    for(const field of FIELDS)entries[field]=storage.getItem(keyFor(slot,field));
    return entries;
  }
  async function checkpointLocal(slot,storage=localStorage){
    return checkpoint(slot,snapshotLocal(slot,storage));
  }
  async function exportPortable(slot,validator){
    const verified=await readVerified(slot);
    if(!verified)throw Error('This career has no protected checkpoint');
    const data=Object.create(null);
    for(const field of FIELDS)data[field]=verified.record.entries[field]===null?null:JSON.parse(verified.record.entries[field]);
    if(data['fd-player-career-state-v1']?.format==='fd-player-career-lzw-124j'){
      const zip=data['fd-player-career-state-v1'].zip;
      if(typeof zip!=='string')throw Error('Protected player snapshot missing archive');
      data['fd-player-career-state-v1']=JSON.parse(window.FDShadowCodec121i.unzip(zip));
    }
    if(data['fd-world-state-v043']?.shadowSidecar121i){
      const sidecar=data['fd-shadow-prospects-v121i'];
      if(sidecar?.format!=='fd-shadow-sidecar-121i'||typeof sidecar.zip!=='string')
        throw Error('Protected foreign academy archive missing');
      data['fd-world-state-v043']={...data['fd-world-state-v043'],shadowZip121i:sidecar.zip};
      delete data['fd-world-state-v043'].shadowSidecar121i;
    }
    // Sidecar is an internal storage key; portable imports expect nine fields.
    delete data['fd-shadow-prospects-v121i'];
    const backup={format:'football-dynasty-restored-career',version:1,
      createdAt:new Date().toISOString(),data};
    if(validator)validator(JSON.stringify(backup));
    return backup;
  }
  window.FDCareerVault124k=Object.freeze({open,checkpoint,checkpointLocal,readVerified,
    snapshotLocal,exportPortable,fields:FIELDS,version:1});
})();
