'use strict';
// Execute the REAL daily-training routine before/after 1.24d, with identical fixtures.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const [oldPath,newPath]=process.argv.slice(2);
if(!oldPath||!newPath)throw Error('Usage: node tests/training-day-124d.test.cjs BEFORE.js AFTER.js');
function extract(path){
 const s=fs.readFileSync(path,'utf8');
 const start=s.indexOf('    function applyTrainingDay() {');
 const end=s.indexOf('\n    function transferValueBreakdown(p) {',start);
 assert(start>=0&&end>start,'Unable to extract actual daily training code');
 return s.slice(start,end);
}
const old=extract(oldPath),now=extract(newPath);
assert(old.includes('arr.findIndex(x => x.id === p.id)'),'Unexpected baseline training code');
assert(now.includes('seenTrainingIds124d'),'Optimized deduplication absent');
const player=(id,extra={})=>({id,name:'Player '+id,age:18,overall:65,baseOverall:65,clubId:'our-club',positions:['CM'],morale:72,fitness:89,
 attributes:{technical:12,mental:12,physical:12},development:{professionalism:13,currentAbility:65,potentialMax:85},...extra});
function test(source,roster,hasPlan=false) {
 const rows=structuredClone(roster), saved=[];let reads=0;
 for(const p of [...rows.first,...rows.second]){
   let id=p.id;
   Object.defineProperty(p,'id',{enumerable:true,configurable:true,get(){reads++;return id;},set(x){id=x;}});
 }
 const plans=hasPlan?{starter:{focus:'Passing',load:'Normal',days:2,roleProgress:{},targetPosition:'',targetRole:'',objective100:{status:'active'}}}:{};
 const trainingState={lastProcessedDate:'',teamPlan:{focus:'Balanced',intensity:'Normal'},
   players:plans,preparation067:{focus:'Balanced',days:0},reports:[]};
 const index=new Map([...rows.first,...rows.second].map(p=>[p.id,p]));
 const ctx={
  trainingState,state:{currentDate:'2026-10-17',selectedClubId:'our-club'},
  currentPlayers:()=>rows.first,academyPlayers:()=>rows.second,
  normalizeTrainingState:()=>{},teamTrainingPlan:()=>trainingState.teamPlan,
  TEAM_TRAINING_FOCUS:{Balanced:{tech:.34,mental:.34,physical:.32}},TEAM_TRAINING_INTENSITY:{Normal:1},
  TRAINING_FOCUS:{Balanced:{tech:.42,mental:.32,physical:.26},Passing:{tech:.7,mental:.25,physical:.05}},
  TRAINING_LOAD:{Normal:1},board062StaffTrainingMultiplier:()=>1,
  specialistCoachBonus063h:()=>1,specialistCoachGroup063h:()=> 'midfield',trainingAgeFactor:()=>1,
  trainingPhysicalFactor076:()=>1,FD:{clamp:(v,lo,hi)=>Math.min(hi,Math.max(lo,v)),getPlayer:id=>index.get(id)},
  applyTrainingAttributeGain063h:(p,k,amount)=>{p.attributes[k]+=amount;},
  refreshDynamicOverall:p=>{p.refreshed=(p.refreshed||0)+1;},
  mentorBonus:()=>0,developmentGoalTrainingBoost100:()=>1,adjacentPositionFactor:()=>1,
  trainingPlan:id=>trainingState.players[id]||null,checkDevelopmentGoal100:(p,plan)=>{plan.checked=true;},
  savePlayerCareerState:players=>saved.push(players.map(p=>p.id)),saveTraining:()=>saved.push('training-saved'),
  shortPlayerName:name=>name
 };
 vm.runInNewContext(source+'\napplyTrainingDay();',ctx,{timeout:30000});
 // Normalize realm-specific array prototypes for precise JSON state comparison.
 const snapshot=JSON.parse(JSON.stringify({first:rows.first,second:rows.second,saved,trainingState}));
 return {snapshot,reads};
}
const samples=[
 ['pending, parent-loan, injured, duplicate and individual plan',{
   first:[player('starter'),player('pending',{profilePending:true}),player('loan',{transferType:'Loan',parentClubId:'our-club'}),player('injured',{injuryDays:5}),player('same')],
   second:[player('same'),player('pending'),player('loan'),player('fresh')]
 },true],
 ['empty training roster',{first:[],second:[]},false],
 ['400 duplicated academy IDs',{first:Array.from({length:400},(_,i)=>player('senior-'+i)),second:Array.from({length:400},(_,i)=>player('senior-'+i))},false],
 ['1200 unique players',{first:Array.from({length:400},(_,i)=>player('senior-'+i)),second:Array.from({length:800},(_,i)=>player('academy-'+i))},false]
];
for(const [label,rows,hasPlan] of samples){
 const baseline=test(old,rows,hasPlan),optimized=test(now,rows,hasPlan);
 assert.deepEqual(optimized.snapshot,baseline.snapshot,'Training results or save payload changed: '+label);
 const count=rows.first.length+rows.second.length;
 if(count>500)assert(optimized.reads<baseline.reads/10,'Expected fewer player ID comparisons');
 console.log('PASS '+label+' player-ID reads: '+baseline.reads+' -> '+optimized.reads);
}
