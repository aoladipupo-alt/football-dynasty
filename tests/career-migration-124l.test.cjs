'use strict';
/* Chromium durability/migration tests against the actual game-hosted vault.
 * Synthetic seasons test storage growth, NOT the game's season simulator.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs'),{execFileSync}=require('node:child_process');
const {chromium}=require('playwright-core');
function chromePath(){
 for(const n of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){
  try{const path=execFileSync('which',[n],{encoding:'utf8'}).trim();if(fs.existsSync(path))return path;}catch(_){}
 }
 return chromium.executablePath();
}
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:chromePath(),
  args:['--no-sandbox','--disable-dev-shm-usage','--enable-precise-memory-info']});
 const context=await browser.newContext({viewport:{width:1366,height:768}});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(String(error)));
 page.setDefaultTimeout(80000);
 try{
  const url=(process.env.FD_SMOKE_URL||'http://127.0.0.1:8765')+'/game/index.html';
  const started=Date.now();
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  assert.equal(response.status(),200);
  await page.waitForFunction(()=>!!window.FDCareerVault124k&&!!window.FDShadowCodec121i);
  const coldMs=Date.now()-started;
  // Test six realistic save formats/payloads without modifying any user's
  // localStorage. Real careers are tested separately by career-vault-124k.
  const migrated=await page.evaluate(async()=>{
   const vault=window.FDCareerVault124k,codec=window.FDShadowCodec121i;
   const players={};
   for(let i=0;i<1000;i++)players['player-'+i]={
    id:'player-'+i,clubId:'club-'+i%40,name:i%3?'João Silva':'李山',
    attributes:{passing:65+i%30,pace:60+i%30,position:'CM'},
    development:{potential:70+i%26},careerStats:{goals:i%13}
   };
   const sidecar={academyProspects:Array.from({length:180},(_,i)=>({
    id:'academy-'+i,nationality:i%2?'Ghana':'Japan',name:'Youth '+i,potential:75+i%20
   }))};
   const raw={
    'fd-manager-club-v1':JSON.stringify('club-1'),
    'fd-career-time-v1':JSON.stringify({date:'2026-07-07',season:2026}),
    'fd-player-career-state-v1':JSON.stringify({format:'fd-player-career-lzw-124j',
      zip:codec.zip(JSON.stringify(players))}),
    'fd-world-state-v043':JSON.stringify({year:2026,shadowSidecar121i:true,
      youth:[{id:'academy-0'}],history:[{playerId:'player-1',from:'club-1',to:'club-2'}]}),
    'fd-shadow-prospects-v121i':JSON.stringify({format:'fd-shadow-sidecar-121i',
      zip:codec.zip(JSON.stringify(sidecar))}),
    'fd-match-saves-v3':JSON.stringify({'fixture-1':{finished:true,homeGoals:2,awayGoals:1}}),
    'fd-transfer-state-v1':JSON.stringify({transfers:[{playerId:'player-1',clubId:'club-2'}]}),
    'fd-training-state-v1':JSON.stringify({}),
    'fd-tactics-v2':JSON.stringify({}),
    'fd-027-dismissed-mail':JSON.stringify([])
   };
   const key=(slot,field)=>'fd-save-'+slot+'-'+field;
   const legacy={getItem(k){const match=/^fd-save-1-(.*)$/.exec(k);return match?raw[match[1]]??null:null;}};
   const before=JSON.stringify(raw);
   const meta=await vault.migrateLegacy(1,legacy);
   const duplicate=await vault.migrateLegacy(1,legacy);
   const portable=await vault.exportPortable(1);
   const after=JSON.stringify(raw);
   const slot2=await vault.importPortable(2,portable);
   const portable2=await vault.exportPortable(2);
   const tampered={...raw,'fd-shadow-prospects-v121i':null};
   const badStore={getItem(k){const m=/^fd-save-3-(.*)$/.exec(k);return m?tampered[m[1]]??null:null;}};
   let rejected=false;
   try{await vault.migrateLegacy(3,badStore);}catch(e){rejected=/sidecar/i.test(String(e));}
   window.__fdStorageFixture={players,sidecar,raw};
   return {meta,duplicate,slot2,originalIntact:before===after,rejected,
    playerCount:Object.keys(portable.data['fd-player-career-state-v1']).length,
    youth:portable.data['fd-world-state-v043'].shadowZip121i,
    match:portable.data['fd-match-saves-v3']['fixture-1'],
    roundtrip:JSON.stringify(portable.data)===JSON.stringify(portable2.data),
    badVault:await vault.readVerified(3)};
  });
  assert(migrated.originalIntact&&migrated.meta.originalPreserved);
  assert.equal(migrated.meta.revision,1);
  assert(migrated.duplicate.alreadyMigrated&&migrated.duplicate.revision===1);
  assert.equal(migrated.playerCount,1000);
  assert.equal(migrated.match.homeGoals,2);
  assert(migrated.youth&&migrated.roundtrip&&migrated.rejected);
  assert.equal(migrated.badVault,null);
  console.log('PASS raw + 1.24j compressed + shadow sidecar migrated intact; portable import roundtrip');

  // Continue seasons in both occupied slots. This is an IDB capacity/recovery
  // stress test: it does not call or replace the actual game simulation.
  const sustained=await page.evaluate(async()=>{
   const vault=window.FDCareerVault124k;
   const annual=[];
   for(let season=2027;season<=2036;season++){
    for(let slot=1;slot<=2;slot++){
     const current=await vault.readVerified(slot);
     const rows={...current.record.entries};
     const key='fd-world-state-v043';
     const world=JSON.parse(rows[key]);
     world.year=season;
     world.youth.push({id:'prospect-'+slot+'-'+season,clubId:'club-'+slot});
     world.history.push({playerId:'player-'+season,from:'club-'+slot,to:'club-'+(slot+1)});
     rows[key]=JSON.stringify(world);
     const matches=JSON.parse(rows['fd-match-saves-v3']);
     for(let fixture=0;fixture<40;fixture++)
      matches['fixture-'+slot+'-'+season+'-'+fixture]={
       finished:true,homeGoals:fixture%4,awayGoals:(fixture+1)%3,season,
       home:'club-'+slot,away:'club-'+(slot+1)};
     rows['fd-match-saves-v3']=JSON.stringify(matches);
     rows['fd-career-time-v1']=JSON.stringify({date:season+'-07-07',season});
     const saved=await vault.checkpoint(slot,rows);
     const loaded=await vault.readVerified(slot);
     if(loaded.source!=='head'||loaded.record.sha256!==saved.sha256)throw Error('Lost season '+season);
    }
    const report=await vault.storageReport();
    annual.push({season,localCharacters:report.legacyCharacters,
      slot1Characters:report.slots[0].characters,slot2Characters:report.slots[1].characters,
      originUsageBytes:report.originUsageBytes});
   }
   const state=await Promise.all([vault.readVerified(1),vault.readVerified(2)]);
   const invariant=state.map(row=>{
    const entries=row.record.entries;
    const matches=JSON.parse(entries['fd-match-saves-v3']);
    const world=JSON.parse(entries['fd-world-state-v043']);
    return {revision:row.record.revision,date:JSON.parse(entries['fd-career-time-v1']).date,
     finished:Object.values(matches).filter(m=>m.finished).length,transfers:world.history.length,
     youth:world.youth.length,checksum:row.record.sha256};
   });
   return {annual,invariant,localKeys:Object.keys(localStorage).filter(k=>k.startsWith('fd-save-'))};
  });
  assert.equal(sustained.annual.length,10);
  assert.equal(sustained.invariant[0].date,'2036-07-07');
  assert.equal(sustained.invariant[1].date,'2036-07-07');
  assert(sustained.invariant.every(row=>row.finished===401&&row.transfers===11&&row.youth===11));
  assert.deepEqual(sustained.localKeys,[]);
  console.log('PASS 10 synthetic seasons × two slots, verified matches/transfers/youth, no live localStorage growth');
  const failure=await page.evaluate(async()=>{
   const vault=window.FDCareerVault124k;
   const initial=(await vault.readVerified(1)).record;
   const rows={...initial.entries,'fd-career-time-v1':JSON.stringify({date:'2037-07-07'})};
   const put=IDBObjectStore.prototype.put;
   let aborted=false,quota=false;
   IDBObjectStore.prototype.put=function(value,key){
    if(key==='1:head'){const r=put.call(this,value,key);this.transaction.abort();return r;}
    return put.call(this,value,key);
   };
   try{await vault.checkpoint(1,rows);}catch(e){aborted=true;}
   finally{IDBObjectStore.prototype.put=put;}
   const afterAbort=(await vault.readVerified(1)).record.sha256===initial.sha256;
   IDBObjectStore.prototype.put=function(value,key){
    if(key==='1:head')throw new DOMException('Storage is full','QuotaExceededError');
    return put.call(this,value,key);
   };
   try{await vault.checkpoint(1,rows);}catch(e){quota=/quota|full/i.test(String(e));}
   finally{IDBObjectStore.prototype.put=put;}
   const afterQuota=(await vault.readVerified(1)).record.sha256===initial.sha256;
   return {aborted,quota,afterAbort,afterQuota};
  });
  assert(failure.aborted&&failure.quota&&failure.afterAbort&&failure.afterQuota);
  console.log('PASS aborted transaction + synthetic QuotaExceededError preserve the last verified state');
  await page.reload({waitUntil:'domcontentloaded',timeout:60000});
  const warmStart=Date.now();
  await page.waitForFunction(()=>!!window.FDCareerVault124k);
  const afterReload=await page.evaluate(async()=>{
   const vault=window.FDCareerVault124k;
   const rows=await Promise.all([vault.readVerified(1),vault.readVerified(2)]);
   return {state:rows.map(row=>{
     const e=row.record.entries,w=JSON.parse(e['fd-world-state-v043']);
     return {revision:row.record.revision,date:JSON.parse(e['fd-career-time-v1']).date,
      finished:Object.values(JSON.parse(e['fd-match-saves-v3'])).filter(x=>x.finished).length,
      transfers:w.history.length,youth:w.youth.length,checksum:row.record.sha256};
   }),report:await vault.storageReport(),heapBytes:performance.memory?.usedJSHeapSize??null};
  });
  assert.deepEqual(afterReload.state,sustained.invariant);
  assert(afterReload.report.slots.every(s=>s.revision===11));
  assert.equal(afterReload.report.legacyCharacters,0);
  assert.equal(errors.length,0,'Unexpected browser errors: '+errors.join(' | '));
  console.log('PASS durable reload invariants: '+JSON.stringify(afterReload.state));
  console.log('BENCHMARK '+JSON.stringify({viewport:'1366x768',coldStartupMs:coldMs,
   postReloadReadMs:Date.now()-warmStart,heapBytes:afterReload.heapBytes,
   afterTenSeasons: sustained.annual.at(-1),browser:browser.version()}));
 }finally{await context.close();await browser.close();}
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
