import test from 'node:test';
import assert from 'node:assert/strict';
import {RaidSim, HZ} from '../src/lib/engine.js';
import {createDrill, createMechanic, createAddWave} from '../src/lib/drills.js';
const clean = overrides => createDrill({addWaves: [], mechanics: [], ...overrides});
test('drill run snapshots isolate caller edits and pause preserves casts and metrics', () => {
  const drill = clean({name: 'Original', mechanics: [createMechanic('safe-hold', {first:0,delay:0,duration:10,placement:{mode:'player'}})]});
  const sim = new RaidSim({drill}); drill.name = 'Changed'; drill.playerStart.x = 100;
  sim.start(); assert.equal(sim.drill.name, 'Original'); assert.equal(sim.player.x, 500);
  sim.use('veil-bolt'); sim.advance(.5); sim.pause(); const cast = {...sim.cast}; const metrics = sim.metrics();
  sim.advance(20); assert.deepEqual(sim.cast, cast); assert.deepEqual(sim.metrics(), metrics);
  assert.throws(() => sim.configureDrill(clean()), /Stop/);
  sim.resume(); sim.advance(1); assert.equal(sim.totalDamage, 1150);
  sim.stop(); const summary = sim.metrics(); sim.configureDrill(clean({name:'Next'}));
  assert.deepEqual(sim.metrics(),summary); assert.equal(sim.summary.drill.name,'Original');
  sim.start(); assert.equal(sim.metrics().drillName,'Next'); assert.equal(sim.time,0);
});
test('council bosses are permanent targets and lost adds fall back to a live boss', () => {
  const drill = clean({bosses:[{id:'north',name:'North',x:480,y:160},{id:'south',name:'South',x:560,y:160}],addWaves:[createAddWave({first:0,count:1,lifetime:1,placement:{x:500,y:250}})]});
  const sim = new RaidSim({drill}); sim.start(); assert.equal(sim.selectedId,'north');
  sim.cycleTarget(); assert.equal(sim.selectedId,'south');
  const add = sim.targets.find(target => target.kind === 'add'); sim.select(add.id); sim.use('veil-bolt');
  sim.advance(1); assert.equal(sim.selectedId,'north'); assert.equal(sim.cast,null); assert.equal(sim.escaped,1);
  assert.equal(sim.cooldowns['veil-bolt'],0); assert.equal(sim.targets.length,2);
  sim.damage(sim.target('south'),1e10,'test'); assert.equal(sim.target('south').hp,Infinity);
  sim.removeTarget('north'); sim.removeTarget('south'); assert.equal(sim.cycleTarget(),false); assert.equal(sim.selectedId,null);
});
test('actual engine reproducibility is independent of frame chunking and spell RNG', () => {
  const drill = clean({mechanics:[createMechanic('projectiles',{first:0,frequency:2,pattern:'wall',direction:'sequence',angleStep:30,count:7,spacing:90}),createMechanic('safe-deadline',{first:0,frequency:3,placement:{mode:'random'}})]});
  const a = new RaidSim({drill}), b = new RaidSim({drill}); a.start(); b.start();
  a.advance(10); for(let n=0;n<600;n++) b.advance(1/HZ);
  assert.deepEqual(a.snapshot(),b.snapshot());
  b.start(); for(let n=0;n<17;n++) b.rand(); b.advance(10);
  assert.deepEqual(a.hostileProjectiles,b.hostileProjectiles); assert.deepEqual(a.safeZones,b.safeZones);
});
test('endless drill has no automatic end and live-only per-target detail is reclaimed', () => {
  const sim = new RaidSim({drill:clean({addWaves:[createAddWave({first:0,count:1,frequency:1,lifetime:.5})]})}); sim.start();
  for(let n=0;n<300;n++){const add=sim.targets.find(target=>target.kind==='add');if(add)sim.damage(add,1,'test');sim.advance(1);}
  assert.equal(sim.phase,'running'); assert.equal(sim.time,300); assert.ok(Object.keys(sim.targetDamage).length<=sim.targets.length);
  sim.stop(); assert.equal(sim.phase,'stopped');
});
