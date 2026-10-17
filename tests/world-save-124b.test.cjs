#!/usr/bin/env node
/* 1.24b: Compare world-save behavior in the original and patched primary engine. */
'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) throw Error('Usage: node tests/world-save-124b.test.cjs BEFORE.js AFTER.js');
function saveFunction(path) {
  const text = fs.readFileSync(path, 'utf8');
  const start = text.indexOf('    function persistWorld071p() {');
  const end = text.indexOf('\n    function saveWorld() {', start);
  assert(start >= 0 && end > start, 'world-save implementation missing');
  return text.slice(start, end);
}
const original = saveFunction(beforePath), patched = saveFunction(afterPath);
assert(original.includes('for (const y of youth)'), 'Baseline was changed');
assert(patched.includes('resolvedYouth124b'), 'Candidate performance change missing');
function run(source, scenario) {
  let lookups = 0, normalizations = 0;
  const writes = [], warnings = [];
  const players = Object.fromEntries([
    {id:'regen-a', goals:1.8, positions:['LW'], attributes:{pace:81}, development:{potentialMax:92}},
    {id:'regen-b', goals:5.2, positions:['GK'], attributes:{pace:42}, development:{potentialMax:78}}
  ].map(p=>[p.id,p]));
  const worldState = { youth: scenario.youth.map(id=>({id, goals:-1})), shadowProspects116:[] };
  const ctx = {
    FD: { getPlayer(id) {lookups++; return players[id] || null;},
      normalizeIntegerPlayerStats(rows) {normalizations++;rows.forEach(p => {p.goals = Math.round(p.goals);});} },
    worldState,
    WORLD_STORAGE_KEY:'world-test',
    packedWorld121i() { return worldState; },
    writeCareerStored(key,payload) { writes.push(JSON.stringify({key,payload}));return !scenario.writeFails; },
    console: {warn(message) {warnings.push(message);} },
    worldUiMutationRevision097g:0
  };
  vm.runInNewContext(source+'\npersistWorld071p();',ctx);
  return {youth:JSON.stringify(worldState.youth),writes,lookups,normalizations,
    revision:ctx.worldUiMutationRevision097g, warnings};
}
for (const scenario of [
  {youth:[],writeFails:false},
  {youth:['regen-a'],writeFails:false},
  {youth:['regen-a','missing','regen-b','regen-a'],writeFails:false},
  {youth:['missing','missing'],writeFails:false},
  {youth:['regen-a','regen-b'],writeFails:true}
]) {
  const a=run(original,scenario), b=run(patched,scenario);
  assert.equal(b.youth,a.youth, 'Saved youth diverged');
  assert.deepEqual(b.writes,a.writes, 'Persisted payload diverged');
  assert.equal(b.normalizations,a.normalizations,'Player stat normalization diverged');
  assert.equal(b.revision,a.revision,'World revision behavior changed');
  assert.deepEqual(b.warnings,a.warnings,'Save failure warnings changed');
  assert.equal(a.lookups,scenario.youth.length*2,'Expected two baseline lookups');
  assert.equal(b.lookups,scenario.youth.length,'Candidate must resolve each youth ID once');
  console.log('PASS youth='+scenario.youth.length+' failedWrite='+scenario.writeFails+
              ' lookups='+a.lookups+' -> '+b.lookups);
}
