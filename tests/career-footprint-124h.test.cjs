'use strict';
// The save growth report must never read non-career keys, log values, or mutate saves.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const script=fs.readFileSync(process.argv[2]||'diagnostics/career-footprint-124h.js','utf8');
assert(!/\.setItem\(|\.removeItem\(|\.clear\(/.test(script),'Diagnostic must not write to storage');
const rows=new Map([
 ['fd-save-1-fd-world-state-v043','{"academy":"example"}'],
 ['fd-save-1-fd-match-saves-v3','{"games":[1,2,3]}'],
 ['fd-save-2-fd-player-career-state-v1','{"p":1}'],
 ['fd-save-7-fd-player-career-state-v1','ignored invalid slot'],
 ['google-signin-token','do-not-include']
]);
let writes=0,reads=0;
const localStorage={
 get length(){return rows.size;},
 key:i=>[...rows.keys()][i]??null,
 getItem:k=>{reads++;return rows.get(k)??null;},
 setItem(){writes++;throw Error('Not allowed');},
 removeItem(){writes++;throw Error('Not allowed');}
};
const prints=[],window={localStorage};
vm.runInNewContext(script,{window,console:{table:x=>prints.push(x),info(){},warn(){}}});
assert(window.FDStorageFootprint124h?.report,'Expected browser diagnostic');
const report=window.FDStorageFootprint124h.report();
assert.equal(report.slots.length,5);
assert.equal(report.slots[0].saveKeys,2);
assert.equal(report.slots[1].saveKeys,1);
assert.equal(report.slots[2].saveKeys,0);
assert.equal(reads,3,'Only read valid slot payloads');
assert.equal(writes,0,'Must never touch career saves');
assert.equal(report.totalApproximateBytes,
 [...rows].filter(([k])=>/^fd-save-[1-5]-/.test(k)).reduce((sum,[key,val])=>sum+(key.length+val.length)*2,0));
assert(!JSON.stringify(prints).includes('academy'), 'Should log sizes only, not save data');
console.log('PASS read-only save footprint inspection for all five slots');
