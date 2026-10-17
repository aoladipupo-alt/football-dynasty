'use strict';
// Compare actual autoAssign() code from 1.24d and 1.24e game engines.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const [beforePath,afterPath]=process.argv.slice(2);
if(!beforePath||!afterPath)throw Error('Usage: node tests/ai-lineups-124e.test.cjs BEFORE AFTER');
const start='    function autoAssign(playerIds, formation) {';
const end='    function defaultClubPlan() {';
function extract(s,a,b){
  const i=s.indexOf(a),j=s.indexOf(b,i);
  assert(i>=0&&j>i,'Missing engine routine '+a);
  return s.slice(i,j);
}
const original=fs.readFileSync(beforePath,'utf8'),candidate=fs.readFileSync(afterPath,'utf8');
const before=extract(original,start,end),after=extract(candidate,start,end);
assert(before.includes('playerSlotScore(p, slotPos)'), 'Baseline differs from expected engine');
assert(after.includes('cachedSlotScore124e'), 'No candidate lineup cache');
const formations=extract(original,'    const FORMATIONS = {','    const ROLE_OPTIONS = {');
const actualSlotScorer=extract(original,'    function playerSlotScore(p, slotPos) {',start);
const positions=['GK','CB','LB','RB','LWB','RWB','DM','CM','LM','RM','AM','LW','RW','ST'];
function roster(size,duplicateCount=0){
  const players=Array.from({length:size},(_,i)=>({
    id:'player-'+i,overall:50+(i*17)%44,profilePending:i%31===3,
    positions:[positions[i%positions.length]],age:17+i%19
  }));
  for(let i=0;i<duplicateCount;i++)players.push(players[i%players.length]);
  return players;
}
function run(fn,players,formation,fromSelectionPool=false){
  const index=new Map(players.map(p=>[p.id,p]));let reads=0;
  const context={
    FD:{getPlayer:id=>index.get(id),clamp:(n,l,h)=>Math.min(h,Math.max(l,n))},
    selectionPool:()=>players,
    positionSuitability063m(p,pos){
      reads++;
      const natural=p.positions?.[0];
      return {penalty:natural===pos?0:natural==='CB'&&['LB','RB'].includes(pos)
        ?3:Math.abs(positions.indexOf(natural)-positions.indexOf(pos))%11+2};
    },
    ids:fromSelectionPool?[]:players.map(p=>p.id),formation
  };
  vm.runInNewContext(formations+actualSlotScorer+fn+
    '\nresult = autoAssign(ids, formation);',context,{timeout:30000});
  return {assignments:JSON.parse(JSON.stringify(context.result)),reads};
}
for(const [size,shape,duplicates] of [
  [34,'4-2-3-1',0],[45,'3-5-2',8],[120,'4-3-3',0],
  [240,'5-3-2',20],[16,'4-4-2',0],[0,'4-2-3-1',0]
]){
  const players=roster(size,duplicates);
  for(const fromPool of [true,false]){
    const a=run(before,players,shape,fromPool),b=run(after,players,shape,fromPool);
    assert.deepEqual(b.assignments,a.assignments,'Starting XI differs');
    if(size>=34)assert(b.reads<a.reads,'Suitability calculations not reduced');
    console.log('PASS '+shape+' players='+players.length+' pool='+fromPool+
      ' suitability='+a.reads+' -> '+b.reads);
  }
}
const changing=roster(35);
run(after,changing,'4-3-3');
changing[0].overall=99;
assert.deepEqual(run(after,changing,'4-3-3').assignments,
                 run(before,changing,'4-3-3').assignments,
                 'Cache incorrectly persists across manager lineup decisions');
console.log('PASS fresh cache after player rating change');
