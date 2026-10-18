'use strict';
/* Playwright browser integration for 1.24k protected, non-destructive vault. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),{execFileSync}=require('node:child_process');
const {chromium}=require('playwright-core');
function chromePath(){for(const n of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){
 try{const p=execFileSync('which',[n],{encoding:'utf8'}).trim();if(fs.existsSync(p))return p;}catch(_){}}
 return chromium.executablePath();}
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:chromePath(),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 const context=await browser.newContext({viewport:{width:1366,height:900}}),page=await context.newPage();
 const problems=[];page.on('pageerror',error=>problems.push(String(error)));
 page.setDefaultTimeout(85000);
 const host=process.env.FD_SMOKE_URL||'http://127.0.0.1:8765';
 try{
  const response=await page.goto(host+'/game/index.html',{waitUntil:'domcontentloaded'});
  assert.equal(response.status(),200);
  await page.locator('#device-gate [data-device="pc"]').click();
  await page.locator('[data-new-slot="1"]').waitFor();
  await page.locator('[data-new-slot="1"]').click();
  await page.locator('.club-grid [data-choose-club]').first().click();
  await page.locator('#mission-setup-start').click();
  await page.locator('.app-shell .topbar').waitFor({timeout:100000});
  console.log('PASS normal career startup and first save');
  const before=await page.evaluate(()=>window.FDCareerVault124k.snapshotLocal(1));
  assert(before['fd-manager-club-v1']);
  await page.locator('details.top-menu > summary').click();
  await page.locator('button[data-shell-page="Settings"]').click();
  const button=page.locator('#stable-backups button').filter({hasText:'Protect career (IndexedDB)'});
  await button.waitFor();await button.click();
  await page.locator('#stable-status').getByText('protected in IndexedDB').waitFor({timeout:60000});
  const first=await page.evaluate(async()=>{
   const v=await window.FDCareerVault124k.readVerified(1);
   const backup=await window.FDCareerVault124k.exportPortable(1,window.FDStablePolish.validateBackup);
   return {revision:v.record.revision,source:v.source,recovered:v.recovered,
    backupKeys:Object.keys(backup.data).length,club:backup.data['fd-manager-club-v1'],
    unchanged:JSON.stringify(window.FDCareerVault124k.snapshotLocal(1))===JSON.stringify(v.record.entries)};
  });
  assert.equal(first.source,'head');assert.equal(first.revision,1);
  assert.equal(first.backupKeys,9);assert.equal(typeof first.club,'string');assert(first.unchanged);
  console.log('PASS Settings button creates verified portable career checkpoint without modifying local saves');
  const second=await page.evaluate(async()=>{
   const vault=window.FDCareerVault124k;
   const entries=vault.snapshotLocal(1);
   entries['fd-career-time-v1']=JSON.stringify({date:'2027-01-03',hour:0});
   const result=await vault.checkpoint(1,entries),verified=await vault.readVerified(1);
   return {result,headDate:JSON.parse(verified.record.entries['fd-career-time-v1']).date};
  });
  assert.equal(second.result.revision,2);assert.equal(second.headDate,'2027-01-03');
  console.log('PASS atomic second checkpoint retains current revision');
  const multi=await page.evaluate(async()=>{
   const vault=window.FDCareerVault124k,rows={
    'fd-manager-club-v1':JSON.stringify('arsenal'),
    'fd-player-career-state-v1':JSON.stringify({players:'football dynasty '.repeat(480000)})};
   const meta=await vault.checkpoint(2,rows),record=await vault.readVerified(2);
   return {meta,club:JSON.parse(record.record.entries['fd-manager-club-v1']),
    stored:record.record.entries['fd-player-career-state-v1'].length};
  });
  assert.equal(multi.club,'arsenal');assert(multi.stored>7000000);
  const slots=await page.evaluate(()=>Object.keys(localStorage).filter(x=>x.startsWith('fd-save-2-')));
  assert.equal(slots.length,0,'IndexedDB-only synthetic slot should not consume localStorage quota');
  console.log('PASS >7MB second-slot archive written to IndexedDB without using localStorage quota');
  await page.reload({waitUntil:'domcontentloaded'});
  const persist=await page.evaluate(async()=>{
   const slot1=await window.FDCareerVault124k.readVerified(1),slot2=await window.FDCareerVault124k.readVerified(2);
   return {r1:slot1.record.revision,r2:slot2.record.revision};
  });
  assert.deepEqual(persist,{r1:2,r2:1});
  console.log('PASS both verified checkpoints survive full page reload');
  const corrupted=await page.evaluate(async()=>{
   const vault=window.FDCareerVault124k,db=await vault.open();
   await new Promise((resolve,reject)=>{
    const tx=db.transaction('checkpoints','readwrite'),store=tx.objectStore('checkpoints');
    const request=store.get('1:head');
    request.onsuccess=()=>{const row=request.result;row.sha256='00'.repeat(32);store.put(row,'1:head');};
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
   });
   const previous=await vault.readVerified(1);
   let prevented=false;
   try{await vault.checkpointLocal(1);}catch{prevented=true;}
   return {previous:previous.recovered,source:previous.source,
    revision:previous.record.revision,date:JSON.parse(previous.record.entries['fd-career-time-v1']).date,
    prevented};
  });
  assert.equal(corrupted.previous,true);assert.equal(corrupted.source,'previous');
  assert.equal(corrupted.revision,1);assert(corrupted.prevented);
  console.log('PASS integrity check rejects corrupted head, recovers prior checkpoint and blocks overwrite');
  const one=await page.evaluate(async()=>{
   const vault=window.FDCareerVault124k;
   const archive=await vault.exportPortable(1);
   return {keys:Object.keys(archive.data).length,club:archive.data['fd-manager-club-v1']};
  });
  assert.equal(one.keys,9);assert.equal(one.club,first.club);
  assert.equal(problems.length,0,'Uncaught browser errors: '+problems.join(' | '));
  console.log('PASS verified prior checkpoint export and no browser errors');
 }finally{await context.close();await browser.close();}
}
main().catch(e=>{console.error(e.stack||e);process.exit(1);});
