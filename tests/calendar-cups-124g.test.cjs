'use strict';
/* Verify the actual FA Cup progression and rescheduling functions in both engines.
 * No mocked cup logic: fixtures, finances, inbox and save writes must match.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const [beforePath,afterPath]=process.argv.slice(2);
if(!beforePath||!afterPath)throw Error('Usage: node tests/calendar-cups-124g.test.cjs BEFORE AFTER');
const begin='    const FA_CUP_ROUNDS_078 = Object.freeze([';
const end='    function raceWatch078(competition){';
function extract(path){
 const txt=fs.readFileSync(path,'utf8'),a=txt.indexOf(begin),b=txt.indexOf(end,a);
 assert(a>=0&&b>a,'Failed to extract the game engine cup functions');
 return txt.slice(a,b);
}
const original=extract(beforePath),optimized=extract(afterPath);
assert(original.includes("seasonFixtures.filter(f=>f.competitionId==='eng-fa-cup'&&f.round===round"));
assert(optimized.includes('cupByRound124g')&&optimized.includes('leagueByDate124g'));
const future=(date,offset)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);};
const dayNumber=date=>Math.floor(Date.parse(date+'T12:00:00Z')/86400000);
function seed(str){let h=2166136261>>>0;for(const c of String(str)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return (h%100000)/100000;}
function fixtureInput({leagueCount=400,cupCount=32,scenario='pending',clubCount=128}={}){
 const clubs=Array.from({length:clubCount},(_,i)=>({id:'club-'+i,name:'Club '+i,reputation:65,league:'League X'}));
 const fixtures=[],results={};
 const dates=['2027-01-09','2027-01-14','2027-02-13','2027-03-06','2027-04-03','2027-04-24','2027-05-22','2027-02-01'];
 for(let i=0;i<leagueCount;i++){
  const home='club-'+(i*3%clubCount),away='club-'+((i*3+1)%clubCount);
  const f={id:'league-'+i,date:dates[i%dates.length],competitionId:'league-one',
   homeClubId:home,awayClubId:away,homeName:home,awayName:away,round:'Round '+(i%38)};
  fixtures.push(f);if(i%8===7)results[f.id]={finished:true,homeGoals:2,awayGoals:1};
 }
 const rounds=['Third Round','Fourth Round','Fifth Round','Quarter-final','Semi-final','Final'];
 const stageDates=['2027-01-09','2027-02-13','2027-03-06','2027-04-03','2027-04-24','2027-05-22'];
 if(scenario!=='none'){
  const stage=scenario==='final'?5:scenario==='fourth'?1:0;
  const count=scenario==='final'?1:scenario==='fourth'?4:cupCount;
  for(let i=0;i<count;i++){
   const home='club-'+((i*2)%clubCount),away='club-'+((i*2+1)%clubCount);
   const f={id:'cup-'+stage+'-'+i,date:scenario==='date-collision'&&i%2?'2027-01-14':stageDates[stage],
    competitionId:'eng-fa-cup',competitionName:'FA Cup',homeClubId:home,awayClubId:away,
    homeName:home,awayName:away,round:rounds[stage],cupSeason078:2026};
   fixtures.push(f);
   if(['finished','ties','final','fourth','complete'].includes(scenario)||(scenario==='mixed'&&i%3===0))
    results[f.id]={finished:true,homeGoals:i%3===0?1:2,awayGoals:i%3===0?1:0};
  }
  if(scenario==='complete')for(let stage=1;stage<rounds.length;stage++)for(let i=0;i<32/(2**stage);i++){
   const home='club-'+((i*2)%clubCount),away='club-'+((i*2+1)%clubCount);
   const f={id:'complete-'+stage+'-'+i,date:stageDates[stage],competitionId:'eng-fa-cup',
    competitionName:'FA Cup',homeClubId:home,awayClubId:away,homeName:home,awayName:away,
    round:rounds[stage],cupSeason078:2026};
   fixtures.push(f);results[f.id]={finished:true,homeGoals:stage===5?2:1,awayGoals:0};
  }
  fixtures.push({id:'old-cup',date:'2026-04-02',competitionId:'eng-fa-cup',
   round:'Third Round',cupSeason078:2025,homeClubId:'club-3',awayClubId:'club-4'});
  fixtures.push({id:'future-cup',date:'2028-04-02',competitionId:'eng-fa-cup',
   round:'Fourth Round',cupSeason078:2027,homeClubId:'club-5',awayClubId:'club-6'});
 }
 fixtures.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 return {clubs,fixtures,results};
}
function run(source,scenario,passes){
 const initial=fixtureInput(scenario),resultStore=structuredClone(initial.results),clubs=structuredClone(initial.clubs);
 const index=new Map(clubs.map(c=>[c.id,c]));
 const fixtures=structuredClone(initial.fixtures),inbox=[],writes=[];
 let competitionReads=0,resultReads=0;
 for(const f of fixtures){
  let id=f.competitionId;
  Object.defineProperty(f,'competitionId',{configurable:true,enumerable:true,
   get(){competitionReads++;return id;},set(value){id=value;}});
 }
 const worldState={domesticCupTrophies078:[],news:[],finances:{'club-0':{budget:20,received:0}}};
 const context={
  state:{selectedClubId:'club-0',currentDate:'2027-01-10'},
  seasonFixtures:fixtures,matchSaves:resultStore,worldState,
  fixtureIndexSource:{},domesticTableRevision:2,
  FD:{competitions:[{id:'eng-fa-cup',nextStage:'Third Round'}],getClub:id=>index.get(id),
   deterministic01:seed,formatDate:date=>date,advanceDate:future,dayNumber,
   clamp:(x,a,b)=>Math.min(b,Math.max(a,x))},
  resultFor(f){resultReads++;return resultStore[f.id]||null;},
  leagueCompetitionIds062b:()=>new Set(['league-one']),
  // Moving Jan 9 -> Jan 14 can create another conflict in this call.
  findLeagueRescheduleDate062b:(fixture,all,date)=>future(date,5),
  seasonYear:()=>2026,normalizeWorldState:()=>{},clubGrowthRecord072:()=>null,
  board062RecordTrophy:(...args)=>writes.push(['trophy',...args]),
  club:()=>index.get('club-0'),
  saveMatches:(...args)=>writes.push(['saveMatches',...args]),
  saveWorld:()=>writes.push(['saveWorld']),
  addInbox:message=>inbox.push(message),
 };
 vm.runInNewContext(source+'\nprogressDomesticCups078(state.currentDate);',context,{timeout:30000});
 for(let i=1;i<passes;i++)vm.runInNewContext('progressDomesticCups078(state.currentDate);',context,{timeout:30000});
 const snapshot=JSON.parse(JSON.stringify({fixtures:context.seasonFixtures,results:resultStore,worldState,
  club:clubs.find(x=>x.id==='club-0'),inbox,writes,competition:context.FD.competitions,
  revision:context.domesticTableRevision}));
 return {snapshot,competitionReads,resultReads};
}
for(const s of [
 {scenario:'none',leagueCount:0,cupCount:0},
 {scenario:'none',leagueCount:2800,cupCount:0},
 {scenario:'pending',leagueCount:400,cupCount:32},
 {scenario:'mixed',leagueCount:1200,cupCount:32},
 {scenario:'finished',leagueCount:1800,cupCount:16},
 {scenario:'ties',leagueCount:280,cupCount:8},
 {scenario:'complete',leagueCount:1300,cupCount:32},
 {scenario:'date-collision',leagueCount:500,cupCount:10},
 {scenario:'fourth',leagueCount:280,cupCount:8},
 {scenario:'final',leagueCount:220,cupCount:1},
 {scenario:'pending',leagueCount:3100,cupCount:64},
]){
 const name=s.scenario+' league='+s.leagueCount+' cups='+s.cupCount;
 const baseline=run(original,s,s.scenario==='finished'?3:2);
 const candidate=run(optimized,s,s.scenario==='finished'?3:2);
 assert.deepEqual(candidate.snapshot,baseline.snapshot,'Cup fixture or save state diverged: '+name);
 if(s.leagueCount>=200&&s.cupCount>=8){
  assert(candidate.competitionReads<baseline.competitionReads,'No reduction in fixture scans: '+name);
  if(s.leagueCount>=1000)assert(candidate.competitionReads<baseline.competitionReads/3,
   'Index did not reduce large-calendar reads: '+name);
 }
 console.log('PASS '+name+' competition-ID reads '+baseline.competitionReads+' -> '+
  candidate.competitionReads+'; match results '+baseline.resultReads+' -> '+candidate.resultReads);
}
console.log('PASS 1.24g original-vs-candidate calendar and cup equivalence');
