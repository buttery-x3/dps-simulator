import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDrillImport} from '../src/lib/drill-storage.js';
import {DEFAULT_DRILL, DRILL_LIMITS, MECHANIC_KINDS, createDrill, createAddWave, createMechanic, validateDrill, compileDrill, exportDrill} from '../src/lib/drills.js';
const clone = value => JSON.parse(JSON.stringify(value));
const invalid = (edit, pattern) => { const value = clone(DEFAULT_DRILL); edit(value); const result = validateDrill(value); assert.equal(result.valid, false); assert.equal(result.value, null); assert.match(result.errors.join('; '), pattern); };

test('default and every complete factory validate and canonically round trip', () => {
  const value = createDrill({mechanics: MECHANIC_KINDS.map(kind => createMechanic(kind)), addWaves: [createAddWave()]});
  assert.equal(validateDrill(DEFAULT_DRILL).valid, true);
  assert.deepEqual(JSON.parse(exportDrill(value)), validateDrill(value).value);
  assert.equal(value.bosses[0].id, 'dummy');
  assert.equal(value.addWaves[0].first, 14);
  assert.throws(() => createMechanic('executable-script'), /Unknown mechanic/);
});

test('factories are independent clones and preserve nested placement defaults', () => {
  const a = createDrill(), b = createDrill();
  a.playerStart.x = 75; a.bosses[0].x = 80; a.mechanics[0].placement.x = 90;
  assert.equal(b.playerStart.x, 500); assert.equal(b.bosses[0].x, 500); assert.equal(b.mechanics[0].placement.x, 500);
  const mechanic = createMechanic('circle', {placement: {mode: 'player'}});
  assert.deepEqual(mechanic.placement, {mode: 'player', x: 500, y: 280});
  assert.notEqual(a.id, b.id);
});

test('compile snapshots are deeply immutable, isolated and use integer tick schedules', () => {
  const input = createDrill({mechanics: [createMechanic('safe-hold', {first: .123, frequency: 1.234, delay: .456, duration: .789})]});
  const compiled = compileDrill(input), schedule = compiled.schedules.at(-1);
  assert.equal(schedule.firstTick, 7); assert.equal(schedule.frequencyTicks, 74);
  assert.equal(schedule.delayTicks, 27); assert.equal(schedule.durationTicks, 47);
  input.playerStart.x = 31; assert.equal(compiled.drill.playerStart.x, 500);
  assert.throws(() => { compiled.drill.bosses[0].x = 31; }, TypeError);
  assert.throws(() => { compiled.schedules.push({}); }, TypeError);
});

test('rejects unsupported versions, unknown fields and executable/unsafe identifiers', () => {
  invalid(d => { d.version = 2; }, /unsupported version/);
  invalid(d => { d.duration = 120; }, /unknown field/);
  invalid(d => { d.mechanics[0].script = 'alert(1)'; }, /unknown field/);
  invalid(d => { d.bosses[0].id = '__proto__'; }, /safe identifier/);
  invalid(d => { d.bosses[0].id = 'constructor'; }, /safe identifier/);
  invalid(d => { d.bosses[0].id = 'toString'; }, /safe identifier/);
  invalid(d => { d.bosses[0].id = 'hasOwnProperty'; }, /safe identifier/);
  invalid(d => { d.mechanics[0].kind = 'function'; }, /unsupported mechanic/);
  invalid(d => { d.mechanics[0].placement.mode = 'eval'; }, /must be one of/);
  const polluted = JSON.parse(exportDrill(DEFAULT_DRILL));
  Object.defineProperty(polluted, '__proto__', {value: {}, enumerable: true});
  assert.equal(validateDrill(polluted).valid, false);
  assert.throws(() => compileDrill({version: 2}), /Invalid drill/);
});

for (const value of [NaN, Infinity, -Infinity, '6', null, {}, [], undefined]) test(`rejects malformed numbers: ${String(value)}`, () => {
  invalid(d => { d.mechanics[0].frequency = value; }, /finite number/);
});

test('requires fields, sane arena coordinates, identifiers and at least one permanent boss', () => {
  invalid(d => { delete d.seed; }, /seed/);
  invalid(d => { d.seed = 0; }, /seed/);
  invalid(d => { d.seed = 1.5; }, /integer/);
  invalid(d => { d.playerStart.x = 29; }, /playerStart.x/);
  invalid(d => { d.bosses[0].y = 531; }, /bosses\[0\].y/);
  invalid(d => { d.bosses = []; }, /1–8 items/);
  invalid(d => { d.mechanics[0].id = d.bosses[0].id; }, /duplicate/);
  invalid(d => { d.name = ' '; }, /nonempty/);
  invalid(d => { d.name = 'a'.repeat(101); }, /at most/);
  invalid(d => { d.name = 'name\nscript'; }, /nonempty/);
});

test('DOS safeguards bound rules, entities, cadence, lifespan and damage inputs', () => {
  invalid(d => { d.mechanics = Array(100000).fill(d.mechanics[0]); }, /0–32 items/);
  invalid(d => { d.addWaves = Array(100000).fill(d.addWaves[0]); }, /0–16 items/);
  invalid(d => { d.mechanics[0].frequency = 0; }, /frequency/);
  invalid(d => { d.mechanics[0].first = 1e15; }, /first/);
  invalid(d => { d.addWaves[0].count = 1e7; }, /count/);
  invalid(d => { d.addWaves[0].lifetime = 1e7; }, /lifetime/);
  invalid(d => { d.mechanics[0].damage = -1; }, /damage/);
  invalid(d => { d.mechanics = [createMechanic('projectiles', {speed: 1e9})]; }, /speed/);
  assert.equal(DRILL_LIMITS.liveProjectiles, 256);
});

test('walls always leave at least a player-width clear gap', () => {
  const value = createDrill({mechanics: [createMechanic('projectiles', {pattern: 'wall', size: 20, spacing: 65})]});
  assert.match(validateDrill(value).errors.join(' '), /wall gaps/);
  value.mechanics[0].spacing = 66;
  assert.equal(validateDrill(value).valid, true);
});

test('each variant strictly excludes irrelevant fields and accepts zero-damage practice', () => {
  invalid(d => { d.mechanics[0].duration = 5; }, /unknown field/);
  const value = createDrill({mechanics: MECHANIC_KINDS.map(kind => createMechanic(kind, {damage: 0}))});
  assert.equal(validateDrill(value).valid, true);
});


test('malformed root/object/array shapes fail safely, including sparse arrays', () => {
  for (const input of [null, undefined, 1, 'json', [], new Date()]) assert.equal(validateDrill(input).valid, false);
  invalid(d => { d.mechanics = Array(2); }, /unsupported mechanic/);
  invalid(d => { d.bosses = Array(1); }, /plain object/);
  invalid(d => { d.playerStart = []; }, /plain object/);
  invalid(d => { d.mechanics[0].placement = null; }, /plain object/);
  invalid(d => { for (let i = 0; i < 100; i++) d['extra' + i] = i; }, /too many fields/);
});


test('poisoned wall numeric objects and arrays are rejected without coercion or import crashes', () => {
  const poisons = [{toString: 1}, {toString: null, valueOf: null}, [{toString: 1}], [[{toString: 1}]], {}, [], null, true, '60'];
  for (const key of ['size', 'spacing']) for (const poison of poisons) {
    const value = createDrill({mechanics: [createMechanic('projectiles', {pattern: 'wall'})]});
    value.mechanics[0][key] = poison;
    const result = validateDrill(value);
    assert.equal(result.valid, false); assert.equal(result.value, null);
    assert.match(result.errors.join('; '), new RegExp(key));
    const imported = parseDrillImport(JSON.stringify(value));
    assert.equal(imported.ok, false); assert.match(imported.reason, new RegExp(key));
  }
});

test('all numeric schema fields reject poisoned JSON values without throwing', () => {
  const definition = createDrill({mechanics: MECHANIC_KINDS.map(kind => createMechanic(kind)), addWaves: [createAddWave()]});
  const paths = [];
  const collect = (value, path = []) => {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'number') paths.push([...path, key]);
      else if (item && typeof item === 'object') collect(item, [...path, key]);
    }
  };
  collect(definition);
  for (const path of paths) for (const poison of [{toString: 1}, {valueOf: 1, toString: 1}, [{toString: 1}]]) {
    const value = clone(definition);
    const target = path.slice(0, -1).reduce((node, key) => node[key], value);
    target[path.at(-1)] = poison;
    const result = validateDrill(value);
    assert.equal(result.valid, false, path.join('.'));
    assert.equal(parseDrillImport(JSON.stringify(value)).ok, false, path.join('.'));
  }
});
