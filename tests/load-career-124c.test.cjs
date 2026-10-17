#!/usr/bin/env node
'use strict';
/* Compare the actual extracted restore functions, including live alias resolution. */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) throw Error('Usage: node tests/load-career-124c.test.cjs BEFORE.js AFTER.js');
function restoreCode(file) {
  const src = fs.readFileSync(file,'utf8');
  const start = src.indexOf('    function applyCareerPlayerState() {');
  const end = src.indexOf('    function repairCareerIdentityCollisions()',start);
  assert(start !== -1 && end > start,'Restore function could not be extracted');
  return src.slice(start,end);
}
const before=restoreCode(beforePath), after=restoreCode(afterPath);
assert(before.includes('byId.get(id) || FD.getPlayer(id)'), 'Unexpected baseline');
assert(after.includes('byId.get(id) || byId.get(resolved124c)'), 'Optimized path missing');
const candidate=fs.readFileSync(afterPath,'utf8');
const aliasStart=candidate.indexOf('    FD.resolvePlayerIdAlias124c = id => {');
const aliasEnd=candidate.indexOf('\n    // Club membership', aliasStart);
assert(aliasStart>0 && aliasEnd>aliasStart, 'Alias helper missing');
const aliasCode=candidate.slice(aliasStart,aliasEnd);
function run(source, enabled, size, missed) {
  const playerList=Array.from({length:size}, (_,i)=>({
    id:'active-'+i, name:'Player '+i, overall:50, positions:['LB'],
    attributes:{pace:50},development:{potentialMax:80},clubId:'team-a',source:'EA roster'
  }));
  const direct=playerList[7]; direct.id='legacy-direct';
  const aliasTarget=playerList[8]; aliasTarget.id='canonical-id';
  const conflicting=playerList[9];conflicting.id='alias-shadow';
  const aliases = new Map([
    ['legacy-alias','canonical-id'],['legacy-direct','alias-shadow'],
    ['multi-a','multi-b'],['multi-b','canonical-id'],['missing-alias','missing-result']
  ]);
  const saved={};
  saved['active-1']={overall:81,positions:['LB','LM'],attributes:{pace:85},development:{potentialMax:95},age:20};
  saved['legacy-alias']={overall:92,positions:['RB','RM'],age:19};
  saved['legacy-direct']={overall:77,age:20};
  saved['multi-a']={fitness:95,age:21};
  saved['missing-alias']={overall:30};
  for(let i=0;i<missed;i++) saved['retired-'+i]={overall:49,age:37};
  const index = new Map(playerList.map(p=>[p.id,p]));
  let calls=0, scanned=0;
  const ctx={
    playerCareerState:saved,
    CAREER_SAVE_FIELDS_122W:['overall','age','fitness','clubId'],
    window:{FDPlayerAge111:{hydrate(p){p.hydrated=true}}},
    state:{currentDate:'2038-10-17'},seasonYear:()=>2038,
    transferState:{history:[]},
    FD:{allPlayers:playerList,CAREER_START_DATE:'2026-07-01',
      getPlayer(id){
        calls++;
        let resolved=id,guard=0;
        while (aliases.has(resolved) && guard++<8)resolved=aliases.get(resolved);
        scanned+=playerList.length;
        return index.get(resolved) || index.get(id) ||
          playerList.find(p=>p.id===resolved) || playerList.find(p=>p.id===id);
      }}
  };
  const helper=enabled ? 'const playerIdAliases = new Map('+JSON.stringify([...aliases])+');\n'+aliasCode : '';
  vm.runInNewContext(helper+'\n'+source+'\napplyCareerPlayerState();',ctx,{timeout:30000});
  return {players:JSON.parse(JSON.stringify(playerList)),calls,scanned};
}
for (const [size,missed] of [[30,0],[50,10],[1200,600]]) {
  const a=run(before,false,size,missed);
  const b=run(after,true,size,missed);
  assert.deepEqual(b.players,a.players,'Loaded career diverged with retired or aliased IDs');
  assert.equal(b.calls,0,'New restore path must not scan roster for missing IDs');
  assert.equal(a.calls,missed+3,'Expected baseline fallback lookup count');
  console.log('PASS players='+size+' orphanSaveRows='+missed+
    ' baselineFallbackCalls='+a.calls+' candidateFallbackCalls='+b.calls);
}
