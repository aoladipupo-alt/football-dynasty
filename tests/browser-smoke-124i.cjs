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

  // Use a throwaway localStorage profile to verify that a real club career can
  // be created and then loaded after navigation. Never import user backups.
  const chosenClub=await page.locator('.club-grid [data-choose-club]').first()
    .getAttribute('data-choose-club');
  assert(chosenClub,'No playable club selected');
  await page.locator('.club-grid [data-choose-club]').first().click();
  await page.locator('#mission-setup-start').waitFor({timeout:90000});
  await page.locator('#mission-setup-start').click();
  await page.locator('.app-shell .topbar').waitFor({timeout:120000});
  const savedClub=await page.evaluate(()=>JSON.parse(
    localStorage.getItem('fd-save-1-fd-manager-club-v1')||'null'));
  assert.equal(savedClub,chosenClub,'Created career saved the wrong club');
  console.log('PASS create new local career and persist correct club identity');

  await page.reload({waitUntil:'domcontentloaded',timeout:45000});
  const gate=page.locator('#device-gate [data-device="pc"]');
  if(await gate.isVisible())await gate.click();
  await page.locator('.save-slot-grid [data-load-slot="1"]')
    .waitFor({timeout:90000});
  await page.locator('.save-slot-grid [data-load-slot="1"]').click();
  try {
    await page.locator('.app-shell .topbar').waitFor({timeout:45000});
  } catch (error) {
    const diagnostic=await Promise.race([page.evaluate(()=>({
      title:document.title,
      appText:(document.querySelector('#app')?.innerText||'').slice(0,700),
      bootText:(document.querySelector('#boot-status')?.innerText||'').slice(0,250),
      saveManagerVisible:Boolean(document.querySelector('.save-slot-grid')),
      selectorVisible:Boolean(document.querySelector('.club-grid')),
      shellVisible:Boolean(document.querySelector('.app-shell')),
      slot1Club:localStorage.getItem('fd-save-1-fd-manager-club-v1'),
      loadTrace:window.__FD_CAREER_LOAD_DETAIL_122V||null,
      worldReady:window.__FD_CAREER_WORLD_READY_095B ?? null,
      dbStatus:window.FD?.databaseStatus||null
    })).catch(e=>({diagnosticError:String(e)})),
      new Promise(resolve=>setTimeout(()=>resolve({diagnosticTimeout:'Browser main thread not responding'}),8000))]);
    console.error('BROWSER CAREER REOPEN DIAGNOSTICS',JSON.stringify({diagnostic,jsErrors:jsErrors.slice(0,8)}));
    await Promise.race([
      page.screenshot({path:'dist/inspection-124i/browser-reload-failure.png'}).catch(()=>{}),
      new Promise(resolve=>setTimeout(resolve,5000))
    ]);
    throw error;
  }
  assert.equal(await page.evaluate(()=>JSON.parse(
      localStorage.getItem('fd-save-1-fd-manager-club-v1')||'null')),
    chosenClub,'Reloaded career changed club');
  console.log('PASS persisted career reopens after browser reload');
  if(jsErrors.length)throw Error('Browser JavaScript errors: '+jsErrors.slice(0,5).join(' | '));
  console.log('PASS no uncaught browser JavaScript exceptions');
 }finally{
  await context.close();
  await browser.close();
 }
}
run().catch(e=>{console.error(e.stack||e);process.exit(1);});
