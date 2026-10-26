'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright-core');
function chromePath(){
 for(const cmd of ['google-chrome','chromium','google-chrome-stable','chromium-browser']){
  try{const p=execFileSync('which',[cmd],{encoding:'utf8'}).trim();if(fs.existsSync(p))return p;}catch(_){}
 }
 return chromium.executablePath();
}
async function loadTactics(browser,base,viewport){
 const context=await browser.newContext({viewport});
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 page.setDefaultTimeout(90000);
 try{
  const response=await page.goto(base+'/game/index.html',{waitUntil:'domcontentloaded',timeout:60000});
  assert.equal(response.status(),200);
  const gate=page.locator('#device-gate [data-device="pc"]');
  if(await gate.isVisible())await gate.click();
  await page.locator('[data-new-slot="1"]').waitFor({timeout:90000});
  await page.locator('[data-new-slot="1"]').click();
  await page.locator('.club-grid [data-choose-club]').first().click();
  await page.locator('#mission-setup-start').click();
  await page.locator('.app-shell .topbar').waitFor({timeout:100000});
  const links=await page.evaluate(()=>[...document.querySelectorAll('button,a,[role="button"]')]
   .filter(x=>/tactic|squad|settings/i.test((x.textContent||'').trim()))
   .slice(0,18).map(x=>({text:(x.textContent||'').trim().slice(0,70),
     html:x.outerHTML.slice(0,260)})));
  console.log('NAV CANDIDATES '+JSON.stringify(links));
  const tacticsButton=page.getByRole('button',{name:/^tactics$/i}).first();
  await tacticsButton.click({timeout:15000});
  await page.locator('.tactics-pitch-card-063m .tactics-pitch-063m').waitFor({timeout:90000});
  const metric=await page.evaluate(()=>{
   const pitch=document.querySelector('.tactics-pitch-card-063m .tactics-pitch-063m');
   const body=pitch.closest('.card-body'),card=pitch.closest('.tactics-pitch-card-063m');
   const workspace=pitch.closest('.tactics-workspace-063m');
   const squad=workspace.querySelector('.tactics-squad-panel-063m');
   const faces=[...pitch.querySelectorAll('.player-face-shell,.face-img,.face')];
   const slots=[...pitch.querySelectorAll('.pitch-slot')];
   const player=slots.find(x=>x.querySelector('.player-bubble.facecard'));
   const box=el=>{const r=el.getBoundingClientRect();return {width:Math.round(r.width),height:Math.round(r.height),top:Math.round(r.top),bottom:Math.round(r.bottom)};};
   const overlapPairs=[];
   for(let i=0;i<slots.length;i++)for(let j=i+1;j<slots.length;j++){
    const a=slots[i].getBoundingClientRect(),b=slots[j].getBoundingClientRect();
    const overlapX=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left));
    const overlapY=Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
    if(overlapX>8&&overlapY>8)overlapPairs.push([i,j,Math.round(overlapX),Math.round(overlapY)]);
   }
   return {pitch:box(pitch),card:box(card),squad:box(squad),
     slot:player?box(player):null,face:faces.length?box(faces[0]):null,
     slotCount:slots.length,roleControls:pitch.querySelectorAll('.role-picker').length,
     selectControls:pitch.querySelectorAll('.slot-picker').length,
     workspaceColumns:getComputedStyle(workspace).gridTemplateColumns,
     bodyClientWidth:body.clientWidth,bodyScrollWidth:body.scrollWidth,
     documentScrollWidth:document.documentElement.scrollWidth,
     windowWidth:innerWidth,overlapPairs};
  });
  assert.equal(errors.length,0,'Uncaught browser errors: '+errors.join(' | '));
  return {metric,page,context};
 }catch(error){await context.close();throw error;}
}
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:chromePath(),
  args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 try{
  const width={width:1364,height:768};
  const baseline=await loadTactics(browser,'http://127.0.0.1:8766',width);
  const old=baseline.metric;
  console.log('BASELINE '+JSON.stringify(old));
  await baseline.context.close();
  const updated=await loadTactics(browser,'http://127.0.0.1:8765',width);
  const metric=updated.metric;
  console.log('LARGER-XI '+JSON.stringify(metric));
  assert.equal(metric.slotCount,11,'Expected all 11 starting players');
  assert.equal(metric.roleControls,11,'Expected 11 role selection controls');
  assert.equal(metric.selectControls,11,'Expected 11 player pickers');
  assert(metric.pitch.width>old.pitch.width*1.5,
   'Pitch was not enlarged enough vs older two-column board');
  assert(metric.pitch.width>=800,'Desktop pitch is still too narrow');
  assert(metric.slot.width>=150,'Player card is still too narrow');
  if(metric.face)assert(metric.face.width>=80,'Portraits were not enlarged');
  assert(metric.squad.top>=metric.pitch.bottom,
   'Squad panel still steals width from formation');
  assert(metric.overlapPairs.length===0,'XI player cards collide: '+JSON.stringify(metric.overlapPairs));
  fs.mkdirSync('dist/qa-124m',{recursive:true});
  await updated.page.screenshot({path:'dist/qa-124m/tactics-desktop.png',fullPage:true});
  await updated.page.setViewportSize({width:800,height:768});
  const medium=await updated.page.evaluate(()=>{
   const pitch=document.querySelector('.tactics-pitch-063m');
   const body=pitch.closest('.card-body');
   return {pitchWidth:Math.round(pitch.getBoundingClientRect().width),
    bodyClientWidth:body.clientWidth,bodyScrollWidth:body.scrollWidth,
    documentWidth:document.documentElement.scrollWidth,windowWidth:innerWidth};
  });
  console.log('MID-SIZE '+JSON.stringify(medium));
  assert(medium.pitchWidth>=900,'Medium screen shrank the XI');
  assert(medium.bodyScrollWidth>medium.bodyClientWidth,'Medium viewport should pan the pitch');
  assert(medium.documentWidth<=medium.windowWidth+5,'Pitch caused document-wide horizontal overflow');
  await updated.context.close();
  console.log('PASS 1.24m full-width XI, larger player cards, controls and responsive pitch pan');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
