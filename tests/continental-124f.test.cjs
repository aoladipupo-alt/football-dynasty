'use strict';
/* Compare the actual continental engine, goals, tables, knockouts and saves.
   Synthetic tests are deterministic and do not modify user careers. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const [beforePath,afterPath]=process.argv.slice(2);
if(!beforePath||!afterPath)throw Error('Usage: node tests/continental-124f.test.cjs BEFORE AFTER');
const START='/* ===== continental.js ===== */',END='/* ===== world-evolution.js ===== */';
function continental(file){
 const txt=fs.readFileSync(file,'utf8'),a=txt.indexOf(START),b=txt.indexOf(END,a);
 assert(a>=0&&b>a,'Missing continental module');
 const sandbox={};
 vm.runInNewContext('function loanUnavailable085b(p){return Boolean(p && !p.retired && p.transferType === "Loan" && p.loanDestinationPending === true);}\n'+txt.slice(a,b),sandbox,{timeout:30000});
 assert(sandbox.FDContinental,'Missing exported continental module');
 return sandbox.FDContinental;
}
const baseline=continental(beforePath),candidate=continental(afterPath);
function normalized(x){return JSON.parse(JSON.stringify(x));}
const comps=baseline.COMPS;
function sample({reservePlayers=750,duplicateIds=false,onlyUser=false,empty=false}={}){
 const clubs=[],players=[],season={
  year:2026,seed:'repeatability-test',entrants:{},clubInfo:{},fixtures:[],
  results:{},players:{},champions:{},runners:{},
  phase:{ucl:'league',uel:'league',uecl:'league'}
 };
 for(let c=0;c<108;c++){
  const id='club-'+c,club={id,name:'Team '+c,reputation:60+(c%35),league:'Test League'};
  clubs.push(club);season.clubInfo[id]=club;
 }
 for(let c=0;c<108;c++)for(let i=0;i<9;i++){
  const p={id:'p-'+c+'-'+i,clubId:'club-'+c,overall:62+i*2+c%5,
   age:i%4===0?15:20+i,positions:[['ST','RW','CM','GK'][i%4]],
   registrationGroup:i%5===0?'U21':'Senior',profilePending:i%13===0,
   transferType:i%7===0?'Loan':undefined,loanDestinationPending:i%11===0};
  players.push(p);
  if(duplicateIds&&i===7)players.push({...p,id:p.id+'-second',overall:p.overall});
 }
 for(let i=0;i<reservePlayers;i++)players.push({
  id:'outside-'+i,clubId:'outsider-'+i%70,overall:55+i%35,age:20,positions:['CM']
 });
 for(let co=0;co<comps.length;co++){
  const comp=comps[co],entrantIds=clubs.slice(co*36,co*36+36).map(c=>c.id);
  season.entrants[comp.key]=entrantIds;
  for(let md=0;md<2;md++)for(let i=0;i<36;i++){
   if(onlyUser&&i!==0)continue;
   const home=entrantIds[i],away=entrantIds[(i+md+1)%36];
   season.fixtures.push({
    id:'match-'+comp.key+'-'+md+'-'+i,
    date:md?'2027-01-27':'2026-10-07',
    competitionId:comp.id,competitionName:comp.name,
    homeClubId:home,awayClubId:away,stage:'league',round:'League MD'+md
   });
  }
 }
 if(empty)season.fixtures=[];
 const count={reads:0};
 for(const p of players){
  let club=p.clubId;
  Object.defineProperty(p,'clubId',{enumerable:true,configurable:true,
   get(){count.reads++;return club;},set(v){club=v;}});
 }
 return {season,clubs,players,count};
}
function execute(api,opts,{stages=['2026-10-07','2027-06-01'],selectedClubId=null,mutate=false}={}){
 const model=sample(opts),{season,clubs,players,count}=model,stats=[];
 for(let t=0;t<stages.length;t++){
  if(mutate&&t>0){players[0].clubId='club-55';players[0].overall=99;}
  stats.push(normalized(api.advance(season,{
   throughDate:stages[t],clubs,players,selectedClubId
  })));
 }
 const reads=count.reads;
 return {snapshot:normalized({season,stats,summary:api.summary(season),
  tables:comps.map(c=>api.leagueTable(season,c.key))}),reads};
}
const scenarios=[
 {label:'full league-to-final season',opts:{reservePlayers:1200},cfg:{}},
 {label:'club user fixtures remain unplayed',opts:{reservePlayers:1200},cfg:{selectedClubId:'club-0'}},
 {label:'duplicate players and changed club membership between days',opts:{reservePlayers:300,duplicateIds:true},cfg:{mutate:true}},
 {label:'no pending fixtures',opts:{reservePlayers:1600,empty:true},cfg:{stages:['2026-11-01']}},
 {label:'no matches before date',opts:{reservePlayers:1600},cfg:{stages:['2026-09-30']}},
 {label:'small fixture batch',opts:{reservePlayers:1900,onlyUser:true},cfg:{stages:['2026-10-07']}}
];
for(const {label,opts,cfg} of scenarios){
 const b=execute(baseline,opts,cfg),a=execute(candidate,opts,cfg);
 assert.deepEqual(a.snapshot,b.snapshot,'Game results diverged: '+label);
 if(label==='full league-to-final season'){
  assert(Object.keys(a.snapshot.season.champions).length===3,'Knockout champions missing');
  assert(a.reads<b.reads/20,'Club index not reused across fixtures');
 }
 if(label==='no pending fixtures'||label==='no matches before date'){
  assert.equal(a.reads,0,'Do not build a player index when no fixture needs simulation');
 }
 console.log('PASS '+label+' club-ID reads '+b.reads+' -> '+a.reads+
  ', results '+Object.keys(a.snapshot.season.results).length);
}
const fixtureCase=sample({reservePlayers:150}),f=fixtureCase.season.fixtures[0];
assert.deepEqual(
 normalized(candidate.simulateFixture(fixtureCase.season,f,fixtureCase.clubs,fixtureCase.players)),
 normalized(baseline.simulateFixture(fixtureCase.season,f,fixtureCase.clubs,fixtureCase.players)),
 'Direct fixture simulation API diverged'
);
console.log('PASS direct simulateFixture API and deterministic goal events');
