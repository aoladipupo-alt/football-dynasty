'use strict';
// Verify the restored career-module normalizer is EXACTLY the same algorithm
// already used by the roster-loading module in the same game engine.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const [before,after]=process.argv.slice(2);
if(!before||!after)throw Error('Usage: node tests/roster-normalizer-124i.test.cjs BEFORE AFTER');
const regex=/    function normalizeRosterName\(value\) \{[\s\S]*?\n    \}/g;
const originals=fs.readFileSync(before,'utf8').match(regex)||[];
const candidates=fs.readFileSync(after,'utf8').match(regex)||[];
assert.equal(originals.length,1,'Expected one baseline normalizer in roster closure');
assert.equal(candidates.length,2,'New candidate must provide one normalizer per closure');
assert.equal(candidates[0],originals[0],'Original compiled roster normalizer must be unchanged');
assert.equal(candidates[1],originals[0],'Career normalizer must exactly match original algorithm');
const inputs=[
 'Fábio Fernandes', 'Łukasz Piszczek','Søren Åkesson','Đorđe Petrović',
 'Straße', 'Ægir Þórsson', 'José Mourinho', 'Jean-Philippe Mateta',
 'João Félix', 'Ødegaard', '  Salah!!  ', null, undefined, '李 小龍',
 'Camavinga', '', "Lamine Yamal"
];
for(const input of inputs){
 const globals={input};
 const roster=vm.runInNewContext(originals[0]+'\nnormalizeRosterName(input)',globals);
 const repair=vm.runInNewContext(candidates[1]+'\nnormalizeRosterName(input)',globals);
 assert.equal(repair,roster,'Legacy player identity normalization diverged: '+String(input));
}
console.log('PASS career migrations reuse identical built-in Unicode roster normalizer ('+inputs.length+' cases)');
