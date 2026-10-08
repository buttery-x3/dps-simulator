import test from 'node:test';
import assert from 'node:assert/strict';
import {createDrill, createMechanic, createAddWave, DRILL_LIMITS, DRILL_HZ as HZ} from '../src/lib/drills.js';
import {DrillRuntime, sweptProjectileHit} from '../src/lib/drill-runtime.js';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const rule = (kind, options = {}) => createMechanic(kind, {first: 0, frequency: 100, ...options});
function fresh(mechanics = [], options = {}) {
  const definition = createDrill({addWaves: [], mechanics, ...options});
  const sim = {phase: 'ready', tick: 0, time: 0, player: {x: 500, y: 445, r: 12, speed: 195},
    targets: [], damageTaken: 0, hitsTaken: 0, events: [], emit(type, data) { this.events.push({type, tick: this.tick, ...data}); }};
  sim.runtime = new DrillRuntime(sim, definition); sim.runtime.reset();
  sim.start = () => { sim.phase = 'running'; sim.runtime.start(); };
  sim.steps = (ticks, movement = {x: 0, y: 0}) => {
    for (let i = 0; i < ticks; i++) {
      if (sim.phase !== 'running') continue;
      const previous = {...sim.player}; sim.tick++; sim.time = sim.tick / HZ;
      sim.player.x += movement.x; sim.player.y += movement.y;
      sim.runtime.step(previous);
      sim.targets = sim.targets.filter(target => !target.expires || sim.tick < target.expires);
    }
  };
  sim.start(); return sim;
}

test('permanent bosses/player are copied and zero-first schedules fire at start only once', () => {
  const sim = fresh([rule('circle', {delay: 2})], {playerStart: {x: 120, y: 300}, bosses: [{id: 'alpha', name: 'First', x: 350, y: 180}, {id: 'beta', name: 'Second', x: 650, y: 180}]});
  assert.equal(sim.player.x, 120); assert.equal(sim.selectedId, 'alpha'); assert.equal(sim.targets.length, 2);
  assert.ok(sim.targets.every(target => target.kind === 'dummy' && target.hp === Infinity));
  assert.equal(sim.hazards.length, 1); sim.runtime.start(); assert.equal(sim.hazards.length, 1);
  sim.steps(1); assert.equal(sim.hazards.length, 1);
});

test('circle impact happens at the exact delay boundary and cannot hit twice', () => {
  const sim = fresh([rule('circle', {delay: 1, placement: {mode: 'player'}, damage: 345})]);
  sim.steps(59); assert.equal(sim.damageTaken, 0);
  sim.steps(1); assert.equal(sim.damageTaken, 345); assert.equal(sim.hitsTaken, 1);
  sim.steps(33); assert.equal(sim.damageTaken, 345); assert.equal(sim.hazards.length, 0);
});

test('zero-delay and recurring rules use exact first/frequency ticks', () => {
  const sim = fresh([rule('circle', {first: .5, frequency: .5, delay: 0, placement: {mode: 'player'}, damage: 1})]);
  sim.steps(29); assert.equal(sim.hitsTaken, 0);
  sim.steps(1); assert.equal(sim.hitsTaken, 1);
  sim.steps(30); assert.equal(sim.hitsTaken, 2);
  const immediate = fresh([rule('circle', {delay: 0, placement: {mode: 'player'}, damage: 10})]);
  assert.equal(immediate.damageTaken, 10);
});

test('line rotation and player radius participate in collision', () => {
  const sim = fresh([rule('line', {delay: 0, width: 20, angle: 90, placement: {x: 515, y: 100}})]);
  assert.equal(sim.hitsTaken, 1);
  const missed = fresh([rule('line', {delay: 0, width: 20, angle: 0, placement: {x: 515, y: 100}})]);
  assert.equal(missed.hitsTaken, 0);
});

test('projectiles are hostile runtime objects separate from spell visual effects', () => {
  const sim = fresh([rule('projectiles', {pattern: 'fan', count: 3, spread: 60, angle: 90, speed: 120})]);
  assert.equal(sim.hostileProjectiles.length, 3);
  const shots = sim.hostileProjectiles;
  near(Math.atan2(shots[0].vy, shots[0].vx) * 180 / Math.PI, 60);
  near(Math.atan2(shots[1].vy, shots[1].vx) * 180 / Math.PI, 90);
  near(Math.atan2(shots[2].vy, shots[2].vx) * 180 / Math.PI, 120);
  assert.equal(shots[0].born, 0); sim.steps(1); near(shots[1].y, 282);
});

test('radial distributes full-circle spokes, aimed tracks player at emission', () => {
  const radial = fresh([rule('projectiles', {pattern: 'radial', count: 4, angle: 0, speed: 120})]);
  const velocities = radial.hostileProjectiles.map(p => [p.vx, p.vy]);
  for (const [i, expected] of [[120, 0], [0, 120], [-120, 0], [0, -120]].entries()) {
    near(velocities[i][0], expected[0]); near(velocities[i][1], expected[1]);
  }
  const aimed = fresh([rule('projectiles', {pattern: 'aimed', count: 1, angle: 0, speed: 120, placement: {x: 400, y: 445}})]);
  near(aimed.hostileProjectiles[0].vx, 120); near(aimed.hostileProjectiles[0].vy, 0);
});

for (const angle of [0, 35, 90, 135, 180, 270]) test(`wall ${angle}° is outside, equidistant and perpendicular`, () => {
  const sim = fresh([rule('projectiles', {pattern: 'wall', count: 7, angle, spacing: 70, size: 9, speed: 180})]);
  const shots = sim.hostileProjectiles;
  assert.ok(shots.every(p => p.x < 0 || p.x > 1000 || p.y < 0 || p.y > 560));
  for (let i = 1; i < shots.length; i++) {
    const dx = shots[i].x - shots[i - 1].x, dy = shots[i].y - shots[i - 1].y;
    near(Math.hypot(dx, dy), 70); near(dx * shots[i].vx + dy * shots[i].vy, 0);
  }
});

test('sequence rotates per rule and resets every run', () => {
  const sim = fresh([rule('projectiles', {pattern: 'wall', count: 1, direction: 'sequence', angle: 10, angleStep: 30, frequency: .25, lifetime: .1})]);
  near(Math.atan2(sim.hostileProjectiles[0].vy, sim.hostileProjectiles[0].vx) * 180 / Math.PI, 10);
  sim.steps(15); near(Math.atan2(sim.hostileProjectiles[0].vy, sim.hostileProjectiles[0].vx) * 180 / Math.PI, 40);
  sim.tick = 0; sim.runtime.reset(); sim.start();
  near(Math.atan2(sim.hostileProjectiles[0].vy, sim.hostileProjectiles[0].vx) * 180 / Math.PI, 10);
});

test('projectile collision sweeps across fast movement and only damages once', () => {
  assert.equal(sweptProjectileHit({x: 0, y: 0}, {x: 200, y: 0}, {x: 100, y: 0}, {x: 100, y: 0}, 1), true);
  assert.equal(sweptProjectileHit({x: 0, y: 0}, {x: 200, y: 0}, {x: 100, y: 20}, {x: 100, y: 20}, 1), false);
  assert.equal(sweptProjectileHit({x: 50, y: 50}, {x: 50, y: 50}, {x: 0, y: 50}, {x: 100, y: 50}, 1), true);
  const sim = fresh([rule('projectiles', {pattern: 'aimed', count: 1, angle: 0, speed: 1200, size: 2,
    placement: {x: 481, y: 445}, damage: 99})]);
  sim.steps(1); assert.equal(sim.damageTaken, 99); assert.equal(sim.hostileProjectiles.length, 0);
  sim.steps(10); assert.equal(sim.damageTaken, 99); assert.equal(sim.runtime.metrics().projectileHits, 1);
});

test('projectile TTL removes offscreen shots at exact boundary', () => {
  const sim = fresh([rule('projectiles', {pattern: 'wall', count: 2, angle: 180, lifetime: .5})]);
  sim.steps(29); assert.equal(sim.hostileProjectiles.length, 2);
  sim.steps(1); assert.equal(sim.hostileProjectiles.length, 0);
});

test('deadline checks only at expiry, records reached/opportunities/misses independently', () => {
  const sim = fresh([rule('safe-deadline', {delay: 1, radius: 50, placement: {mode: 'player'}, damage: 222}),
    rule('safe-deadline', {delay: 1, placement: {x: 50, y: 50}, damage: 333})]);
  sim.steps(59); assert.equal(sim.runtime.metrics().safeDeadlineOpportunities, 0);
  sim.steps(1); const m = sim.runtime.metrics();
  assert.equal(m.safeDeadlineOpportunities, 2); assert.equal(m.safeDeadlineReached, 1); assert.equal(m.safeDeadlineMisses, 1);
  assert.equal(m.safeDeadlineRatio, .5); assert.equal(sim.damageTaken, 333); assert.equal(sim.safeZones.length, 0);
});

test('deadline requires entire player within boundary, snapshot placement does not follow', () => {
  const sim = fresh([rule('safe-deadline', {delay: 1, radius: 30, placement: {mode: 'player'}})]);
  sim.player.x += 20; sim.steps(60);
  assert.equal(sim.runtime.metrics().safeDeadlineMisses, 1);
});

test('safe hold excludes countdown, counts exact duration, and uses union for overlaps', () => {
  const sim = fresh([rule('safe-hold', {delay: 1, duration: 2, placement: {mode: 'player'}}),
    rule('safe-hold', {delay: 1, duration: 2, placement: {x: 50, y: 50}})]);
  sim.steps(60); assert.equal(sim.runtime.metrics().safeHoldActiveSeconds, 0);
  sim.steps(120); const m = sim.runtime.metrics();
  assert.equal(m.safeHoldActiveSeconds, 2); assert.equal(m.safeHoldInsideSeconds, 2); assert.equal(m.safeHoldRatio, 1);
  assert.equal(sim.damageTaken, 0); assert.equal(sim.safeZones.length, 0);
});

test('overlapping unsafe holds produce one penalty each second and independent deadline scores', () => {
  const sim = fresh([rule('safe-hold', {delay: 0, duration: 2, placement: {x: 50, y: 50}, damage: 100}),
    rule('safe-hold', {delay: 0, duration: 2, placement: {x: 150, y: 50}, damage: 200}),
    rule('safe-deadline', {delay: 1, placement: {mode: 'player'}})]);
  sim.steps(59); assert.equal(sim.damageTaken, 0);
  sim.steps(1); assert.equal(sim.damageTaken, 200);
  sim.steps(60); assert.equal(sim.damageTaken, 400); assert.equal(sim.hitsTaken, 2);
  const m = sim.runtime.metrics(); assert.equal(m.safeHoldOutsideSeconds, 2); assert.equal(m.safeHoldActiveSeconds, 2);
  assert.equal(m.safeHoldRatio, 0); assert.equal(m.safeDeadlineRatio, 1);
});

test('safe hold coverage reflects movement in/out and staggered overlapping windows', () => {
  const sim = fresh([rule('safe-hold', {delay: 0, duration: 2, placement: {mode: 'player'}}),
    rule('safe-hold', {delay: 1, duration: 2, placement: {mode: 'player'}})]);
  sim.steps(60); sim.player.x = 50; sim.steps(120);
  const m = sim.runtime.metrics(); assert.equal(m.safeHoldActiveSeconds, 3); assert.equal(m.safeHoldInsideSeconds, 1);
  assert.equal(m.safeHoldOutsideSeconds, 2); near(m.safeHoldRatio, 1 / 3);
});

test('ready and paused phases never accrue mechanics, time or damage', () => {
  const sim = fresh([rule('safe-hold', {delay: 0, duration: 5})]);
  sim.phase = 'paused'; sim.steps(600); sim.runtime.step();
  assert.equal(sim.tick, 0); assert.equal(sim.runtime.metrics().safeHoldActiveSeconds, 0); assert.equal(sim.damageTaken, 0);
  sim.phase = 'ready'; sim.steps(600); sim.runtime.step();
  assert.equal(sim.runtime.metrics().safeHoldActiveSeconds, 0);
  sim.phase = 'running'; sim.steps(60); assert.equal(sim.runtime.metrics().safeHoldActiveSeconds, 1);
});

test('seeded random schedule outcomes are independent of frame chunking and reset identically', () => {
  const definition = {seed: 1234, mechanics: [rule('line', {direction: 'random', placement: {mode: 'random'}, frequency: .5}),
    rule('projectiles', {direction: 'random', pattern: 'wall', count: 3, frequency: .75})]};
  const a = fresh(definition.mechanics, {seed: definition.seed}), b = fresh(definition.mechanics, {seed: definition.seed});
  a.steps(600); for (let i = 0; i < 20; i++) b.steps(30);
  assert.deepEqual(a.events, b.events); assert.deepEqual(a.hostileProjectiles, b.hostileProjectiles);
  assert.deepEqual(a.runtime.metrics(), b.runtime.metrics());
  const original = JSON.stringify(a.events.filter(e => e.type === 'projectile_wave'));
  a.tick = 0; a.time = 0; a.events = []; a.damageTaken = 0; a.hitsTaken = 0; a.runtime.reset(); a.start(); a.steps(600);
  assert.equal(JSON.stringify(a.events.filter(e => e.type === 'projectile_wave')), original);
});

test('live caps bound endless waves, hazards, projectiles, safe zones and schedule counts', () => {
  const sim = fresh([
    rule('circle', {delay: 120, frequency: .25}),
    rule('projectiles', {pattern: 'wall', count: 32, frequency: .25, lifetime: 120, speed: 10}),
    rule('safe-hold', {delay: 120, duration: 120, frequency: .25}),
  ], {addWaves: [createAddWave({first: 0, frequency: .25, count: 32, lifetime: 120})]});
  sim.steps(1800);
  assert.equal(sim.hazards.length, DRILL_LIMITS.liveHazards);
  assert.equal(sim.targets.filter(t => t.kind === 'add').length, DRILL_LIMITS.liveAdds);
  assert.equal(sim.hostileProjectiles.length, DRILL_LIMITS.liveProjectiles);
  assert.equal(sim.safeZones.length, DRILL_LIMITS.liveSafeZones);
  assert.equal(sim.runtime.schedules.length, 4);
});

test('add placement and lifetime are bounded, wave caps preserve permanent bosses', () => {
  const sim = fresh([], {addWaves: [createAddWave({first: 0, frequency: 100, count: 32, lifetime: 1, placement: {x: 30, y: 30}})]});
  const adds = sim.targets.filter(t => t.kind === 'add'); assert.equal(adds.length, 32);
  assert.ok(adds.every(t => t.x >= 30 && t.x <= 970 && t.y >= 30 && t.y <= 530 && t.hp === 6200 && t.expires === 60));
  sim.steps(60); assert.equal(sim.targets.length, 1); assert.equal(sim.targets[0].kind, 'dummy');
});


test('zero-damage practice still records collisions without adding damage', () => {
  const sim = fresh([rule('circle', {delay: 0, placement: {mode: 'player'}, damage: 0})]);
  assert.equal(sim.damageTaken, 0); assert.equal(sim.hitsTaken, 1);
});

test('different rules advance their own sequence counters independently', () => {
  const sim = fresh([rule('projectiles', {id: 'fast-rule', pattern: 'wall', count: 1, direction: 'sequence', angle: 0, angleStep: 30, frequency: .25}),
    rule('projectiles', {id: 'slow-rule', pattern: 'wall', count: 1, direction: 'sequence', angle: 90, angleStep: -45, frequency: .5})]);
  sim.steps(30);
  const fast = sim.events.filter(e => e.type === 'projectile_wave' && e.ruleId === 'fast-rule');
  const slow = sim.events.filter(e => e.type === 'projectile_wave' && e.ruleId === 'slow-rule');
  assert.equal(fast.length, 3); assert.equal(slow.length, 2);
  near(fast[2].angle, Math.PI / 3); near(slow[1].angle, Math.PI / 4);
});


test('switching factory fan to aimed ignores retained angle and direction', () => {
  for (const direction of ['fixed', 'random', 'sequence']) {
    const projectile = createMechanic('projectiles', {first: 0, pattern: 'aimed', count: 1, direction, placement: {x: 400, y: 445}});
    assert.equal(projectile.angle, 90);
    const sim = fresh([projectile]);
    near(sim.hostileProjectiles[0].vx, projectile.speed); near(sim.hostileProjectiles[0].vy, 0);
  }
});
