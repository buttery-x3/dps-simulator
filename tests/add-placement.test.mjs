import test from 'node:test';
import assert from 'node:assert/strict';
import {ADD_RADIUS, ADD_SPAWN_GAP, findAddSpawnPosition, isAddSpawnPointFree} from '../src/lib/add-placement.js';
import {createDrill, createAddWave, createMechanic, DEFAULT_DRILL, DRILL_LIMITS} from '../src/lib/drills.js';
import {RaidSim} from '../src/lib/engine.js';

const point = ({x, y}) => ({x, y});
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const obstacle = (x, y, extra = {}) => ({x, y, r: 20, hp: 1, kind: 'add', ...extra});
const points = [{x: 200, y: 250}, {x: 400, y: 250}, {x: 600, y: 250}, {x: 800, y: 250}];
const list = (selection, values = points) => ({mode: 'points', selection, points: values});
const wave = (placement = list('ordered'), extra = {}) => createAddWave({id: 'points-wave', first: 0, frequency: .25, count: 1,
  lifetime: .1, placement, ...extra});
const fresh = (addWaves, extra = {}) => {
  const sim = new RaidSim({drill: createDrill({addWaves, mechanics: [], ...extra})});
  sim.start(); return sim;
};
const adds = sim => sim.targets.filter(target => target.kind === 'add');
function assertClear(targets) {
  for (const target of targets.filter(target => target.kind === 'add')) {
    assert.ok(target.x >= 30 - 1e-7 && target.x <= 970 + 1e-7 && target.y >= 30 - 1e-7 && target.y <= 530 + 1e-7);
    for (const other of targets) if (target !== other) {
      assert.ok(Math.hypot(target.x - other.x, target.y - other.y) >= target.r + other.r + ADD_SPAWN_GAP - 1e-6,
        `overlap at ${target.x},${target.y} / ${other.x},${other.y}`);
    }
  }
}

test('free requested points stay exact and out-of-bounds requests clamp safely', () => {
  assert.deepEqual(findAddSpawnPosition({x: 150, y: 150}, []), {x: 150, y: 150});
  assert.deepEqual(findAddSpawnPosition({x: -100, y: 900}, []), {x: 30, y: 530});
  assert.equal(findAddSpawnPosition({x: NaN, y: 100}, []), null);
  assert.equal(findAddSpawnPosition({x: 500, y: 250}, [], 0, 501), null);
});

test('equal-distance cardinal ties choose up, then left, then down, then right', () => {
  for (const [origin, expected] of [
    [{x: 500, y: 250}, {x: 500, y: 208}],
    [{x: 500, y: 30}, {x: 458, y: 30}],
    [{x: 30, y: 30}, {x: 30, y: 72}],
    [{x: 30, y: 530}, {x: 30, y: 488}],
  ]) assert.deepEqual(findAddSpawnPosition(origin, [obstacle(origin.x, origin.y)]), expected);
  // Only the right-facing arc fits, so the closest candidate on that arc wins.
  const result = findAddSpawnPosition({x: 30, y: 280}, [obstacle(30, 280, {r: 260})]);
  assert.ok(result.x > 30); assert.equal(isAddSpawnPointFree(result, [obstacle(30, 280, {r: 260})]), true);
});

test('closest offset uses exact radial or intersecting-circle boundary, not a coarse grid', () => {
  const radial = findAddSpawnPosition({x: 510, y: 250}, [obstacle(500, 250)]);
  assert.deepEqual(radial, {x: 542, y: 250});
  const targets = [obstacle(480, 250), obstacle(520, 250)];
  const intersection = findAddSpawnPosition({x: 500, y: 250}, targets);
  near(intersection.x, 500); near(intersection.y, 250 - Math.sqrt(42 ** 2 - 20 ** 2));
  assert.equal(isAddSpawnPointFree(intersection, targets), true);
});

test('boss radii count as occupancy, while dead and expired adds release their points', () => {
  assert.deepEqual(findAddSpawnPosition({x: 500, y: 160}, [obstacle(500, 160, {kind: 'dummy', r: 24, hp: Infinity})]), {x: 500, y: 114});
  const origin = {x: 500, y: 250};
  assert.deepEqual(findAddSpawnPosition(origin, [obstacle(500, 250, {hp: 0}), obstacle(500, 250, {expires: 60})], 60), origin);
  assert.equal(isAddSpawnPointFree(origin, [obstacle(500, 250, {expires: 61})], 60), false);
});

test('bounded resolver terminates in a completely covered arena without overlap', () => {
  const targets = [obstacle(500, 280, {kind: 'dummy', hp: Infinity, r: 2000})];
  assert.equal(findAddSpawnPosition({x: 500, y: 280}, targets), null);
  // Coincident circles have no division-by-zero or infinite retry path.
  assert.deepEqual(findAddSpawnPosition({x: 500, y: 250}, Array.from({length: 72}, () => obstacle(500, 250))), {x: 500, y: 208});
});

test('resolver packs 64 edge-requested adds deterministically with full clearance', () => {
  function fill() {
    const targets = [obstacle(30, 30, {kind: 'dummy', hp: Infinity, r: 24})];
    for (let i = 0; i < DRILL_LIMITS.liveAdds; i++) {
      const spot = findAddSpawnPosition({x: 30, y: 30}, targets);
      assert.ok(spot, `room remains for add ${i + 1}`);
      targets.push(obstacle(spot.x, spot.y));
    }
    assertClear(targets); return targets;
  }
  assert.deepEqual(fill(), fill());
});

test('ordered selection advances for each add and wraps across wave occurrences', () => {
  const sim = fresh([wave(list('ordered'), {count: 3})]);
  assert.deepEqual(adds(sim).map(point), points.slice(0, 3));
  sim.advance(.25); assert.deepEqual(adds(sim).map(point), [points[3], points[0], points[1]]);
  sim.advance(.25); assert.deepEqual(adds(sim).map(point), [points[2], points[3], points[0]]);
  sim.pause(); sim.advance(10); assert.equal(sim.drillRuntime.schedules[0].pointCursor, 1);
  sim.resume(); sim.advance(.25); assert.deepEqual(adds(sim).map(point), points.slice(1));
  sim.start(); assert.deepEqual(adds(sim).map(point), points.slice(0, 3));
});

test('each ordered wave rule owns an independent cursor', () => {
  const sim = fresh([wave(list('ordered'), {id: 'fast', count: 2}), wave(list('ordered'), {id: 'slow', count: 1, first: .25, frequency: .5})]);
  sim.advance(.25);
  assert.deepEqual(adds(sim).filter(target => target.ruleId === 'fast').map(point), points.slice(2));
  assert.deepEqual(adds(sim).filter(target => target.ruleId === 'slow').map(point), points.slice(0, 1));
});

test('random point selection draws independently per add, repeats by seed and fresh Start', () => {
  const definition = [wave(list('random'), {count: 8})];
  const a = fresh(definition, {seed: 1234}), b = fresh(definition, {seed: 1234});
  const first = adds(a).map(point);
  assert.deepEqual(first, adds(b).map(point));
  const requested = [];
  const select = a.drillRuntime.addPosition.bind(a.drillRuntime);
  a.drillRuntime.addPosition = schedule => { const p = select(schedule); requested.push(p); return p; };
  a.advance(.25); b.advance(.1); b.advance(.15);
  assert.equal(requested.length, 8); assert.ok(new Set(requested.map(p => p.x)).size > 1);
  assert.deepEqual(adds(a).map(point), adds(b).map(point)); assertClear(a.targets);
  a.start(); assert.deepEqual(adds(a).map(point), first);
  const different = fresh(definition, {seed: 4321});
  assert.notDeepEqual(adds(different).map(point), first);
});

test('priority fills the first free point per add, reusing it after a kill or expiry', () => {
  const sim = fresh([wave(list('priority'), {count: 2, lifetime: 1})]);
  assert.deepEqual(adds(sim).map(point), points.slice(0, 2));
  const killed = adds(sim)[0]; sim.damage(killed, killed.hp, 'test');
  sim.advance(.25);
  assert.deepEqual(adds(sim).slice(-2).map(point), [points[0], points[2]]);
  sim.targets = sim.targets.filter(target => target.kind !== 'add');
  sim.advance(.25); assert.deepEqual(adds(sim).map(point), points.slice(0, 2));
  const expiring = fresh([wave(list('priority'), {count: 2, lifetime: .25})]);
  expiring.advance(.25); assert.deepEqual(adds(expiring).map(point), points.slice(0, 2));
});

test('all authored priority points occupied falls back to the first and closest free center', () => {
  const sim = fresh([wave(list('priority', points.slice(0, 2)), {count: 3, lifetime: 1})]);
  assert.deepEqual(adds(sim).map(point), [points[0], points[1], {x: 200, y: 208}]);
  assertClear(sim.targets);
});

for (const mode of ['fixed', 'player', 'random', 'points']) test(`${mode} placement avoids same-wave, other-wave and boss overlap at density cap`, () => {
  const placement = mode === 'points' ? list('random', [{x: 30, y: 30}]) : {mode, x: 30, y: 30};
  const sim = fresh([wave(placement, {id: 'a', count: 32, lifetime: 120}), wave(placement, {id: 'b', count: 32, lifetime: 120})],
    {playerStart: {x: 30, y: 30}, bosses: [{id: 'boss', name: 'Edge boss', x: 30, y: 30}]});
  assert.equal(adds(sim).length, DRILL_LIMITS.liveAdds); assertClear(sim.targets);
  sim.advance(.25); assert.equal(adds(sim).length, DRILL_LIMITS.liveAdds); assertClear(sim.targets);
});

test('completely full arena skips the occurrence without growing a queue or consuming ordered cursor', () => {
  const sim = fresh([wave(list('ordered'), {first: .25, count: 32})]);
  sim.targets[0].r = 2000; sim.advance(.25);
  assert.equal(adds(sim).length, 0); assert.equal(sim.drillRuntime.schedules.length, 1);
  assert.equal(sim.drillRuntime.schedules[0].pointCursor, 0);
  sim.targets[0].r = 24; sim.advance(.25);
  assert.equal(adds(sim).length, 32); assert.deepEqual(point(adds(sim)[0]), points[0]);
  assertClear(sim.targets);
});

test('default Sentinel points flank the boss and remain separate over overlapping waves', () => {
  const sim = new RaidSim({drill: DEFAULT_DRILL}); sim.start(); sim.advance(14);
  assert.deepEqual(adds(sim).map(point), [{x: 430, y: 180}, {x: 570, y: 180}]); assertClear(sim.targets);
  sim.advance(30); assert.equal(adds(sim).length, 4); assertClear(sim.targets);
});

test('ADD occupancy never relocates ground, projectile or safe-zone placements', () => {
  const placement = {mode: 'fixed', x: 500, y: 160};
  const mechanics = ['circle', 'line', 'projectiles', 'safe-deadline', 'safe-hold'].map((kind, i) =>
    createMechanic(kind, {id: `mechanic-${i}`, first: 0, placement, ...(kind === 'projectiles' ? {count: 1} : {})}));
  const sim = fresh([wave(placement)], {mechanics});
  assertClear(sim.targets);
  for (const item of [...sim.hazards, ...sim.hostileProjectiles, ...sim.safeZones]) assert.deepEqual(point(item), {x: 500, y: 160});
});
