'use strict';
/* 1.24j browser integration: advance time, reload saves, switch occupied slots.
 * All storage belongs to a fresh, disposable Chromium browser profile.
 */
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const {chromium} = require('playwright-core');
function chromePath() {
  for(const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){
    try{const p=execFileSync('which',[name],{encoding:'utf8'}).trim();if(p&&fs.existsSync(p))return p;}catch(_){}
  }
  return chromium.executablePath();
}
function tomorrow(date,n=1){
  const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);
  return d.toISOString().slice(0,10);
}
async function run(){
 const base=process.env.FD_SMOKE_URL||'http://127.0.0.1:8765';
 const browser=await chromium.launch({headless:true,executablePath:chromePath(),
   args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 const context=await browser.newContext({viewport:{width:1366,height:900},acceptDownloads:false});
 const page=await context.newPage(),errors=[],consoleErrors=[];
 page.setDefaultTimeout(90000);
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
 const read=async slot=>page.evaluate(slot=>{
   const k=name=>'fd-save-'+slot+'-'+name;
   const parse=name=>{const raw=localStorage.getItem(k(name));return raw===null?null:JSON.parse(raw);};
   const rawKeys=Object.keys(localStorage).filter(x=>x.startsWith('fd-save-'+slot+'-'));
   return {slot,club:parse('fd-manager-club-v1'),time:parse('fd-career-time-v1'),
      matches:parse('fd-match-saves-v3')||{},keyCount:rawKeys.length};
 },slot);
 async function showManager(){
   await page.locator('details.top-menu > summary').click();
   await page.locator('button[data-shell-page="Settings"]').click();
   await page.locator('#open-save-manager').click();
   await page.locator('.save-slot-grid .save-slot').first().waitFor({timeout:60000});
 }
 async function newClub(slot,choice){
   await page.locator('[data-new-slot="'+slot+'"]').click();
   await page.locator('.club-grid [data-choose-club]').nth(choice).waitFor({timeout:90000});
   const club=await page.locator('.club-grid [data-choose-club]').nth(choice)
      .getAttribute('data-choose-club');
   await page.locator('.club-grid [data-choose-club]').nth(choice).click();
   await page.locator('#mission-setup-start').waitFor({timeout:90000});
   await page.locator('#mission-setup-start').click();
   await page.locator('.app-shell .topbar').waitFor({timeout:90000});
   assert.equal((await read(slot)).club,club,'Wrong club in new slot '+slot);
   return club;
 }
 async function continueSlot(slot){
   await page.locator('[data-load-slot="'+slot+'"]').click();
   await page.locator('.app-shell .topbar').waitFor({timeout:90000});
   const snapshot=await read(slot);
   assert(snapshot.club,'Saved slot '+slot+' did not open');
   return snapshot;
 }
 async function advance(mode,slot,days){
   const before=await read(slot);
   await page.locator('.continue-menu > summary').click();
   await page.locator('[data-continue-mode="'+mode+'"]').click();
   // One-day run is synchronous after world hydration; week is batched.
   await page.waitForFunction(({slot,date})=>{
     const raw=localStorage.getItem('fd-save-'+slot+'-fd-career-time-v1');
     if(!raw)return false;
     try{return JSON.parse(raw).date>date;}catch{return false;}
   },{slot,date:before.time.date},{timeout:150000});
   if(mode==='week'){
     await page.waitForFunction(()=>!document.querySelector('#continue-stop'),null,{timeout:150000});
   }
   await page.locator('.app-shell .topbar').waitFor({timeout:30000});
   const after=await read(slot);
   const goal=tomorrow(before.time.date,days);
   assert(after.time.date>=goal || (mode==='week'&&after.time.date>before.time.date),
     'Calendar did not advance: '+before.time.date+' → '+after.time.date);
   assert.equal(after.club,before.club,'Advancement changed manager club');
   console.log('PASS '+mode+' advancement, slot '+slot+': '+before.time.date+' -> '+after.time.date);
   return after;
 }
 try{
   await page.goto(base+'/game/index.html',{waitUntil:'domcontentloaded',timeout:45000});
   await page.locator('#device-gate [data-device="pc"]').click();
   await page.locator('.save-slot-grid [data-new-slot="1"]').waitFor({timeout:90000});
   const club1=await newClub(1,0),start1=await read(1);
   assert(start1.time?.date,'First slot initial career time missing');
   console.log('PASS first career created with club '+club1+' on '+start1.time.date);
   const oneDay=await advance('day',1,1);
   assert.equal(oneDay.time.date,tomorrow(start1.time.date,1),
      'One-day advance should move exactly one calendar day');
   const week=await advance('week',1,7);
   assert(week.time.date>oneDay.time.date,'Week advance made no progress');
   const firstBeforeSwitch=await read(1);
   await showManager();
   assert.equal(await page.locator('.save-slot.occupied').count(),1);
   const club2=await newClub(2,1);
   assert.notEqual(club2,club1,'Test careers must be different clubs');
   const start2=await read(2);
   assert.equal(start2.time.date,start1.time.date,'New slot inherited previous calendar');
   assert.deepEqual(await read(1),firstBeforeSwitch,'New second career altered first slot');
   console.log('PASS second independent career created: '+club2);
   await advance('day',2,1);
   const secondAdvanced=await read(2);
   await showManager();
   const loaded1=await continueSlot(1);
   assert.deepEqual(loaded1,firstBeforeSwitch,'Switching back to slot 1 altered its saved state');
   console.log('PASS switching between occupied slots preserves first career');
   await showManager();
   const loaded2=await continueSlot(2);
   assert.deepEqual(loaded2,secondAdvanced,'Switching back to slot 2 altered its saved state');
   console.log('PASS switching between occupied slots preserves second career');
   await page.reload({waitUntil:'domcontentloaded',timeout:45000});
   const gate=page.locator('#device-gate [data-device="pc"]');
   if(await gate.isVisible())await gate.click();
   await page.locator('.save-slot-grid .save-slot').first().waitFor({timeout:90000});
   assert.equal(await page.locator('.save-slot.occupied').count(),2,'Saved slots missing after reload');
   const reopened1=await continueSlot(1);
   assert.deepEqual(reopened1,firstBeforeSwitch,'Reload changed first career');
   await showManager();
   const reopened2=await continueSlot(2);
   assert.deepEqual(reopened2,secondAdvanced,'Reload changed second career');
   console.log('PASS both careers survive full browser page reload');
   if(errors.length||consoleErrors.length)throw Error('Browser errors: '+[...errors,...consoleErrors].slice(-6).join(' | '));
   console.log('PASS no browser errors during calendar advance and slot switching');
 } catch(e) {
   const diag=await Promise.race([
     page.evaluate(()=>({visible:(document.querySelector('#app')?.innerText||'').slice(0,1200),
       storageKeys:Object.keys(localStorage).filter(k=>/fd-save-[12]-fd-(career-time|manager-club)-v1/.test(k)),
       databaseStatus:window.FD?.databaseStatus,
       loadMetrics:window.__FD_CAREER_LOAD_METRICS_122V,
       worldReady:window.__FD_CAREER_WORLD_READY_095B})).catch(x=>({evalError:String(x)})),
     new Promise(resolve=>setTimeout(()=>resolve({timeout:'unresponsive browser'}),7000))
   ]);
   console.error('1.24j INTEGRATION FAILURE',JSON.stringify({error:String(e),diag,errors:errors.slice(-8),consoleErrors:consoleErrors.slice(-10)}));
   throw e;
 } finally {
   await Promise.race([context.close(),new Promise(resolve=>setTimeout(resolve,7000))]);
   await browser.close().catch(()=>{});
 }
}
run().catch(e=>{console.error(e.stack||e);process.exit(1);});
