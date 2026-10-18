'use strict';
// Compare actual historical-transfer replay from the 1.24g and 1.24h engines.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const [oldFile,newFile]=process.argv.slice(2);
if(!oldFile||!newFile)throw Error('Usage: node tests/transfer-replay-124h.test.cjs OLD NEW');
function routine(path){
 const s=fs.readFileSync(path,'utf8');
 const a=s.indexOf('    function applyCareerTransferHistory() {'),b=s.indexOf('    function processLoanReturnsDaily() {',a);
 assert(a>=0&&b>a,'Missing real career transfer replay');
 return s.slice(a,b);
}
const before=routine(oldFile),after=routine(newFile);
assert(before.includes('byId.get(h.playerId) || FD.getPlayer(h.playerId)'));
assert(after.includes('FD.resolvePlayerIdAlias124c?.(h.playerId)'));
function fixture(playerCount,historyCount,years){
 const clubs=Array.from({length:50},(_,i)=>({id:'club-'+i,name:'Club '+i,league:'League '+(i%5)}));
 const players=Array.from({length:playerCount},(_,i)=>({
  id:'player-'+i,clubId:'club-0',teamName:'Club 0',leagueName:'League 0',transferType:'Loan',
  parentClubId:'old-parent',parentClubName:'Old Parent',loanDestinationPending:true,retired:i%33===0
 }));
 if(players[5])players[5].id='alias-direct';
 const aliases=new Map([['retired-alias','player-3'],['alias-a','alias-b'],['alias-b','player-4'],
  ['alias-direct','player-5'],['missing-alias','retired-unknown']]);
 const history=[];
 for(let i=0;i<historyCount;i++){
  const playerId=[
   'retired-'+i,'player-'+(i%playerCount),'alias-a','missing-alias',
   'retired-alias','alias-direct','unknown-'+(i%300)
  ][i%7];
  history.push({kind:i%11===0?'completed-loan':'completed-transfer',playerId,
   toClubId:'club-'+(i%49+1),date:(2027+i%years)+'-07-01',fee:i%20*1.5});
 }
 history.push({kind:'completed-transfer',playerId:'player-2',toClubId:'unknown-club',date:'2028-07-01'});
 history.push({kind:'completed-transfer',playerId:'player-4',toClubId:'club-9',date:'2031-07-01'});
 return {clubs,players,history,aliases};
}
function execute(source,scenario){
 const players=structuredClone(scenario.players);
 const transferState={history:structuredClone(scenario.history)};
 const byId=new Map(players.map(p=>[p.id,p]));
 const clubs=structuredClone(scenario.clubs),byClub=new Map(clubs.map(c=>[c.id,c]));
 let lookups=0,fullScans=0,invalidations=0;
 const resolve=id=>{let current=id,guard=0;
  while(scenario.aliases.has(current)&&guard++<8)current=scenario.aliases.get(current);
  return current;};
 const FD={
  allPlayers:players,resolvePlayerIdAlias124c:resolve,
  getPlayer(id){
   lookups++;const resolved=resolve(id);
   let found=byId.get(resolved)||byId.get(id);
   if(!found){fullScans+=players.length;found=players.find(p=>p.id===resolved)||players.find(p=>p.id===id);}
   return found;
  },
  getClub:id=>byClub.get(id)||clubs[0],
  invalidatePlayerClubIndex(){invalidations++;}
 };
 vm.runInNewContext(source+'\napplyCareerTransferHistory();',{FD,transferState},{timeout:30000});
 return {players:JSON.parse(JSON.stringify(players)),history:JSON.parse(JSON.stringify(transferState.history)),
  lookups,fullScans,invalidations};
}
for(const [label,players,history,years] of [
 ['empty',150,0,1],['1 season',90,150,1],['5 seasons',400,1600,5],
 ['10 seasons',1500,5500,10],['20 seasons',2000,10000,20]
]){
 const data=fixture(players,history,years),old=execute(before,data),now=execute(after,data);
 assert.deepEqual(now.players,old.players,label+' player assignments changed');
 assert.deepEqual(now.history,old.history,label+' transfer records changed');
 assert.equal(now.invalidations,old.invalidations,label+' invalidation changed');
 assert.equal(now.lookups,0,label+' performed fallback lookup');
 if(history)assert(old.lookups>0,label+' expected baseline fallback lookups');
 console.log('PASS '+label+' historical lookups '+old.lookups+' -> '+now.lookups+
  '; full roster player comparisons '+old.fullScans+' -> '+now.fullScans);
}
