'use strict';
// Exercise the REAL shadow cache and career-handoff code extracted from each
// engine, comparing disk snapshots while checking stale reference retention.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const [oldPath,newPath]=process.argv.slice(2);
if(!oldPath||!newPath)
  throw Error('Usage: node tests/shadow-cache-124i.test.cjs BEFORE.js AFTER.js');

function parts(path){
  const text=fs.readFileSync(path,'utf8');
  const a=text.indexOf('    let shadowSaveRevision121i=0,shadowZipCache121i=');
  const b=text.indexOf('    let worldUiMutationRevision097g=0,',a);
  const handoffStart=text.indexOf('        if(!reuseLoaded){flushMatchSaves();flushActiveSlotMeta096z();}',b);
  const handoffEnd=text.indexOf('        // Recovery activity is save-specific.',handoffStart);
  assert(a>=0&&b>a&&handoffStart>=0&&handoffEnd>handoffStart,'Cannot extract game engine buffer and slot logic');
  return {cache:text.slice(a,b),handoff:text.slice(handoffStart,handoffEnd)};
}
const old=parts(oldPath),now=parts(newPath);
assert(!old.cache.includes('releaseShadowSaveBuffers124i'),'Unexpected baseline');
assert(now.cache.includes('function releaseShadowSaveBuffers124i()'),'Missing buffer-release function');
assert(now.handoff.includes('if(requestedSlot!==activeSaveSlot||forceReload||freshSetup096y)'),
  'Must release caches on changes, same-slot imports, and new careers');
const initialRows=[{id:'shadow-a',clubId:'club-a',development:{potentialMax:90}},
  {id:'shadow-b',clubId:'club-a',development:{potentialMax:84}}];
const secondRows=[{id:'shadow-c',clubId:'club-b',development:{potentialMax:93}}];
const thirdRows=[{id:'shadow-d',clubId:'club-c',development:{potentialMax:88}}];
function execute(part){
  let zips=0,flushed=0,metadataFlushes=0;
  const ctx={
    worldState:{shadowProspects116:structuredClone(initialRows)},
    FDShadowCodec121i:{
      pack:rows=>rows.map(p=>({id:p.id,clubId:p.clubId,development:p.development})),
      zip:input=>{zips++;return 'Z'+input;}
    },
    record:null,
    flushMatchSaves(){flushed++;},
    flushActiveSlotMeta096z(){metadataFlushes++;}
  };
  const source=[
    "let lastShadowSidecar121i={slot:1,zip:'old-slot-sidecar'};",
    part.cache,
    "let activeSaveSlot=1;",
    "function handoff(next,{forced=false,newCareer=false}={}){",
    " const requestedSlot=next,forceReload=forced,freshSetup096y=newCareer;",
    " const reuseLoaded=next===activeSaveSlot&&!forced&&!newCareer;",
    part.handoff,
    "}",
    "const oldRows=worldState.shadowProspects116;",
    "const snapshotA=packedWorld121i();",
    "const snapshotARepeat=packedWorld121i();",
    "const cachedAfterFirst=shadowPackedRows121i===oldRows;",
    "handoff(1);",
    "const sameSlotRetainsCache=shadowPackedRows121i===oldRows;",
    "const zipBeforeSwitch=shadowZipCache121i;",
    "handoff(2);",
    "const oldArrayRetained=shadowPackedRows121i===oldRows;",
    "const oldZipRetained=shadowZipCache121i===zipBeforeSwitch;",
    "const oldSidecarRetained=lastShadowSidecar121i.zip==='old-slot-sidecar';",
    "worldState={shadowProspects116:JSON.parse(JSON.stringify(secondRows))};",
    "const snapshotB=packedWorld121i();",
    "const shadowB=shadowPackedRows121i===worldState.shadowProspects116;",
    "handoff(2,{forced:true});",
    "const forcedRetained=shadowPackedRows121i===worldState.shadowProspects116;",
    "worldState={shadowProspects116:JSON.parse(JSON.stringify(thirdRows))};",
    "const snapshotC=packedWorld121i();",
    "handoff(2,{newCareer:true});",
    "const freshRetained=shadowPackedRows121i===worldState.shadowProspects116;",
    "record={",
    " snapshots:JSON.stringify([snapshotA,snapshotARepeat,snapshotB,snapshotC]),",
    " cachedAfterFirst,sameSlotRetainsCache,oldArrayRetained,oldZipRetained,",
    " oldSidecarRetained,shadowB,forcedRetained,freshRetained,",
    " allBuffersCleared:shadowPackedRows121i===null&&shadowZipCache121i===''&&",
    " shadowPackedRevision121i===-1&&lastShadowSidecar121i.slot===0&&lastShadowSidecar121i.zip===null",
    "};"
  ].join('\n');
  // The snapshots are serializable disk payloads; never need real user saves.
  const context={...ctx,secondRows,thirdRows};
  vm.runInNewContext(source,context,{timeout:20000});
  return {...context.record,zips,flushed,metadataFlushes};
}
const baseline=execute(old);
const candidate=execute(now);
assert.equal(candidate.snapshots,baseline.snapshots,'Archive payloads changed across slots');
assert.equal(candidate.cachedAfterFirst,true);
assert.equal(candidate.sameSlotRetainsCache,true,'Fast same-slot resume should not flush buffers');
assert.equal(candidate.oldArrayRetained,false,'Old slot academy rows still strongly referenced');
assert.equal(candidate.oldZipRetained,false,'Old zip buffer remains after slot switch');
assert.equal(candidate.oldSidecarRetained,false,'Sidecar zip is retained after slot switch');
assert.equal(candidate.shadowB,true,'New slot should cache only its own active rows');
assert.equal(candidate.forcedRetained,false,'Force reload must clear old archive references');
assert.equal(candidate.freshRetained,false,'New career must clear old archive references');
assert.equal(candidate.allBuffersCleared,true,'Archive cache reset is incomplete');
assert.equal(baseline.oldArrayRetained,true,'Expected baseline reference retention');
assert.equal(baseline.oldZipRetained,true,'Expected baseline zip retention');
assert.equal(baseline.oldSidecarRetained,true,'Expected baseline sidecar retention');
assert.equal(candidate.zips,baseline.zips,'Do not add extra compression to normal path');
assert.equal(candidate.flushed,baseline.flushed,'Do not change old-slot save flush behavior');
assert.equal(candidate.metadataFlushes,baseline.metadataFlushes,'Do not change timestamp flush behavior');
console.log('PASS identical save snapshots; inactive archive references released on career handoff');
console.log('PASS same-slot resume cached; forced reload and new career release buffers');
console.log('PASS original save flush and compression counts unchanged');
