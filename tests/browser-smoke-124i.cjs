'use strict';
/* Fresh, disposable Chromium smoke test for the opt-in 1.24i site.
 * Opens the actual HTML and starts UI navigation; never imports or uses
 * real career data. Requires playwright-core and installed Chrome.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright-core');

function chromePath(){
  for(const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){
    try{
      const path=execFileSync('which',[name],{encoding:'utf8'}).trim();
      if(path&&fs.existsSync(path))return path;
    }catch(_){}
  }
  return chromium.executablePath();
}
async function run(){
 const base=process.env.FD_SMOKE_URL||'http://127.0.0.1:8765';
 const browser=await chromium.launch({
  headless:true,executablePath:chromePath(),
  args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
 });
 const context=await browser.newContext({
   viewport:{width:1366,height:900},acceptDownloads:false
 });
 const page=await context.newPage();
 page.setDefaultTimeout(90000);
 const jsErrors=[];
 page.on('pageerror',error=>jsErrors.push(String(error)));
 try{
  const hub=await page.goto(base+'/',{waitUntil:'domcontentloaded',timeout:30000});
  assert.equal(hub.status(),200,'Career hub route failed');
  assert.match(await page.title(),/Football Dynasty/i);
  console.log('PASS public career hub opens');

  const game=await page.goto(base+'/game/index.html',{waitUntil:'domcontentloaded',timeout:45000});
  assert.equal(game.status(),200,'Game route failed');
  await page.locator('#device-gate [data-device="pc"]').waitFor();
  await page.locator('#device-gate [data-device="pc"]').click();
  await page.locator('.save-slot-grid .save-slot').first().waitFor({timeout:90000});
  assert.equal(await page.locator('.save-slot-grid .save-slot').count(),5,
    'Five save slots did not load');
  console.log('PASS actual game engine boot and five-slot career manager');

  await page.locator('[data-new-slot="1"]').click();
  await page.locator('.club-grid [data-choose-club]').first().waitFor({timeout:90000});
  const clubCount=await page.locator('.club-grid [data-choose-club]').count();
  assert(clubCount>=2,'No available clubs for new career');
  console.log('PASS new career navigates to playable club selection ('+clubCount+' clubs)');

  const keys=await page.evaluate(()=>Object.keys(localStorage));
  const sensitive=keys.some(k=>/^fd-save-[1-5]-fd-manager-club-v1$/.test(k));
  assert(!sensitive,'Smoke test should not start/persist a career');
  console.log('PASS no saved career created during startup smoke test');

  if(jsErrors.length)throw Error('Browser JavaScript errors: '+jsErrors.slice(0,5).join(' | '));
  console.log('PASS no uncaught browser JavaScript exceptions');
 }finally{
  await context.close();
  await browser.close();
 }
}
run().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
