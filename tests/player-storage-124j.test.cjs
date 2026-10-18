'use strict';
/* 1.24j: test deployed LZW encoder on mature synthetic career snapshots. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const [beforePath,afterPath]=process.argv.slice(2);
if(!beforePath||!afterPath)throw Error('Usage: node tests/player-storage-124j.test.cjs BEFORE.js AFTER.js');
const original=fs.readFileSync(beforePath,'utf8'),updated=fs.readFileSync(afterPath,'utf8');
assert(!original.includes('fd-player-career-lzw-124j'),'Baseline should not use new save format');
assert(updated.includes("PLAYER_STATE_COMPRESSED_FORMAT_124J = 'fd-player-career-lzw-124j'"));
assert(updated.includes("if(key===PLAYER_STATE_STORAGE_KEY&&value?.format===PLAYER_STATE_COMPRESSED_FORMAT_124J)"));
assert(updated.includes("if(key===PLAYER_STATE_STORAGE_KEY&&value&&typeof value==='object'"));
assert(updated.includes("data['fd-player-career-state-v1']=expanded;"));
const start=updated.indexOf('const FDShadowCodec121i = (() => {');
const end=updated.indexOf("    if(typeof window!=='undefined')window.FDShadowCodec121i",start);
assert(start>=0&&end>start,'Missing actual bundled codec');
const codec=vm.runInNewContext(updated.slice(start,end)+'\nFDShadowCodec121i',
 {TextEncoder,TextDecoder,btoa,atob,Uint8Array,Map,Set,Error,JSON});
const source={};
for(let i=0;i<10000;i++){
  source['player-'+i]={
    id:'player-'+i,name:i%2?'Łukasz Pérez':'João Félix',
    age:18+i%18,clubId:'club-'+(i%120),overall:65+(i%28),
    positions:['CM','AM'],transferType:'Permanent',parentClubId:null,
    stats:{matches:i%35,goals:i%15,assists:i%9},
    attributes:{passing:70+(i%10),pace:60+(i%15),shooting:52+(i%13)},
    development:{potentialMax:85,professionalism:14,attitude:'ambitious'}
  };
}
for(const snapshot of [source,{}, {'unicode-ñ':{clubId:'Aéropôle',name:'李小龍',comment:'emoji ⚽🌟'}}]){
 const raw=JSON.stringify(snapshot),zip=codec.zip(raw);
 const restored=JSON.parse(codec.unzip(zip));
 assert.deepEqual(restored,snapshot,'Player data mutated by LZW compression');
 if(raw.length>180000)assert(zip.length<raw.length*.92,'Insufficient size reduction');
 console.log('PASS lossless UTF-8 player-state roundtrip, chars '+raw.length+' -> '+zip.length);
}
assert.throws(()=>codec.unzip('@@@@'),'Malformed compressed archive must fail');
console.log('PASS old plain JSON and versioned compressed format share object shape');
