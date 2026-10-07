import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCanvas} from '@napi-rs/canvas';
import {RaidSim, HZ} from '../src/lib/engine.js';
import {ABILITIES, SLOT_KEYS, compileLoadout} from '../src/lib/catalogue.js';
import {spellReadiness, ICONS, drawSpellIcon} from '../src/lib/icons.js';
import {buildHud, maintenanceDots} from '../src/lib/hud.js';
import {ArenaRenderer} from '../src/lib/renderer.js';
import {registerTrainingTools} from '../src/lib/browser-tools.js';
import {DEFAULT_BINDINGS, keyLabel} from '../src/lib/keybindings.js';

const loadout = (abilities, talents = {}) => ({abilities, talents});
const fresh = (selection, options = {}) => {
  const sim = new RaidSim({mechanics: false, ...(selection ? {loadout: selection} : {}), ...options});
  sim.start(); return sim;
};
const hash = canvas => createHash('sha256').update(canvas.toBuffer('image/png')).digest('hex');
function recordingContext(width = 1000, height = 560) {
  const canvas = createCanvas(width, height), actual = canvas.getContext('2d'), words = [], arcs = [], labels = [];
  const context = new Proxy(actual, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...args) => {
        if (property === 'fillText') {
          words.push(String(args[0]));
          labels.push({text: String(args[0]), x: args[1], y: args[2], font: target.font,
            metrics: target.measureText(String(args[0])), transform: target.getTransform(), strokeWidth: target.lineWidth});
        }
        if (property === 'arc') arcs.push(args);
        return value.apply(target, args);
      };
    },
    set(target, property, value) { return Reflect.set(target, property, value, target); },
  });
  return {canvas, context, words, arcs, labels};
}

test('all eight canonical abilities have distinct real Canvas sigils', () => {
  assert.equal(ABILITIES.length, 8);
  assert.deepEqual(new Set(Object.keys(ICONS)), new Set(ABILITIES.map(spell => spell.id)));
  const images = new Set();
  for (const definition of ABILITIES) {
    const spell = compileLoadout(loadout([definition.id]))[0];
    assert.equal(spell.icon, spell.id);
    const canvas = createCanvas(80, 80);
    drawSpellIcon(canvas.getContext('2d'), spell.icon, 0, 0, 80, {key: false});
    images.add(hash(canvas));
    assert.ok(canvas.getContext('2d').getImageData(0, 0, 80, 80).data.some(value => value));
  }
  assert.equal(images.size, 8);
});

test('key labels follow loadout order and an explicit state key override', () => {
  const sim = fresh(loadout(['focused-energy', 'chain-strike', 'destructive-rift', 'veil-bolt', 'astral-flare']));
  assert.deepEqual(sim.spells.map(spell => spell.key), SLOT_KEYS);
  for (const spell of sim.spells) {
    const {context, words} = recordingContext(80, 80);
    drawSpellIcon(context, spell.id, 0, 0, 80, spellReadiness(sim, spell.id));
    assert.ok(words.includes(spell.key), `${spell.id} should display ${spell.key}`);
  }
  const {context, words} = recordingContext(80, 80);
  drawSpellIcon(context, 'astral-flare', 0, 0, 80, {key: 'Z'});
  assert.deepEqual(words, ['Z']);
  words.length = 0;
  drawSpellIcon(context, 'astral-flare', 0, 0, 80, {key: false});
  assert.deepEqual(words, []);
});

test('runtime bindings default to number codes, validate atomically, and never alias caller arrays', () => {
  const sim = new RaidSim();
  assert.deepEqual(sim.keybindings, ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5']);
  assert.deepEqual(sim.spells.map(spell => spell.key), SLOT_KEYS);
  assert.deepEqual(sim.spells.map(spell => spell.keyCode), DEFAULT_BINDINGS);
  const codes = ['KeyQ', 'KeyE', 'KeyR', 'Digit4', 'Digit5'];
  sim.configureKeybindings(codes);
  const expected = [...codes];
  codes[0] = 'KeyZ';
  assert.deepEqual(sim.keybindings, expected);
  assert.deepEqual(sim.spells.map(spell => spell.key), ['Q', 'E', 'R', '4', '5']);
  const retainedSpells = sim.spells, retainedMap = sim.spellMap, before = sim.snapshot();
  for (const invalid of [null, [], ['KeyQ'], ['KeyQ', 'KeyQ', 'KeyR', 'Digit4', 'Digit5'], ['KeyW', 'KeyE', 'KeyR', 'Digit4', 'Digit5']]) {
    assert.throws(() => sim.configureKeybindings(invalid));
    assert.deepEqual(sim.snapshot(), before);
    assert.equal(sim.spells, retainedSpells);
    assert.equal(sim.spellMap, retainedMap);
    assert.throws(() => new RaidSim({keybindings: invalid}));
  }
  const custom = new RaidSim({keybindings: expected});
  expected[0] = 'KeyZ';
  assert.equal(custom.spells[0].keyCode, 'KeyQ');
  const snapshot = custom.snapshot();
  snapshot.keybindings[0] = 'KeyX';
  snapshot.keyLabels[0] = 'X';
  snapshot.availableSpells[0].key = 'X';
  assert.equal(custom.keybindings[0], 'KeyQ');
  assert.equal(custom.metrics().keyLabels[0], 'Q');
  assert.equal(custom.spells[0].key, 'Q');
});

test('paused rebinding changes only slot labels, preserving a cast and combat state through resume', () => {
  const sim = fresh();
  sim.use('veil-bolt'); sim.advance(.4);
  const beforeRunning = sim.snapshot();
  const codes = ['KeyQ', 'KeyE', 'KeyR', 'Digit4', 'Digit5'];
  assert.throws(() => sim.configureKeybindings(codes), /Pause/);
  assert.deepEqual(sim.snapshot(), beforeRunning);
  sim.pause();
  const spells = sim.spells, spellMap = sim.spellMap, cast = sim.cast;
  const definitions = sim.spells.map(({key, keyCode, ...spell}) => structuredClone(spell));
  const state = JSON.stringify({tick: sim.tick, time: sim.time, gcd: sim.gcdUntil, rng: sim.rngState,
    cooldowns: sim.cooldowns, charges: sim.spellCharges, resource: sim.resource, events: sim.events,
    targets: sim.targets, damage: sim.totalDamage, loadout: sim.loadout});
  sim.configureKeybindings(codes);
  assert.equal(sim.phase, 'paused');
  assert.equal(sim.spells, spells); assert.equal(sim.spellMap, spellMap); assert.equal(sim.cast, cast);
  assert.equal(cast.spellDef, sim.spellMap.get('veil-bolt'));
  assert.equal(cast.spellDef.key, 'Q');
  assert.deepEqual(sim.spells.map(({key, keyCode, ...spell}) => spell), definitions);
  assert.equal(JSON.stringify({tick: sim.tick, time: sim.time, gcd: sim.gcdUntil, rng: sim.rngState,
    cooldowns: sim.cooldowns, charges: sim.spellCharges, resource: sim.resource, events: sim.events,
    targets: sim.targets, damage: sim.totalDamage, loadout: sim.loadout}), state);
  sim.resume(); sim.advance(1.1);
  assert.equal(sim.totalDamage, 640); assert.equal(sim.cast, null);
  assert.equal(sim.spells[0].key, 'Q');
});

test('slot bindings follow loadout reorder, reduced loadouts, reset and restart', () => {
  const codes = ['KeyQ', 'KeyE', 'KeyR', 'Digit4', 'Digit5'];
  const sim = new RaidSim({keybindings: codes});
  const selection = loadout(['focused-energy', 'chain-strike', 'astral-flare']);
  sim.configureLoadout(selection);
  assert.deepEqual(sim.spells.map(spell => [spell.id, spell.key, spell.keyCode]), [
    ['focused-energy', 'Q', 'KeyQ'], ['chain-strike', 'E', 'KeyE'], ['astral-flare', 'R', 'KeyR'],
  ]);
  for (const spell of sim.spells) assert.equal(sim.spellMap.get(spell.id), spell);
  sim.start(); sim.use('focused-energy'); sim.stop();
  sim.configureLoadout(loadout(['astral-flare', 'focused-energy', 'chain-strike']));
  assert.equal(sim.spells[0].keyCode, 'KeyQ');
  sim.start();
  assert.deepEqual(sim.keybindings, codes);
  assert.deepEqual(sim.spells.map(spell => spell.keyCode), codes.slice(0, 3));
  assert.equal(sim.summary, null); assert.equal(sim.totalDamage, 0);
  sim.stop(); sim.configureLoadout(loadout(['astral-flare'])); sim.start();
  assert.equal(sim.spells.length, 1); assert.equal(sim.spells[0].key, 'Q');
  assert.deepEqual(sim.keybindings, codes);
});

test('stopped summary freezes key labels while snapshots report current bindings and spells', () => {
  const oldCodes = ['KeyQ', 'KeyE', 'KeyR', 'Digit4', 'Digit5'];
  const sim = fresh(undefined, {keybindings: oldCodes});
  sim.use('astral-flare'); sim.advance(1); sim.stop();
  const summary = structuredClone(sim.summary);
  assert.deepEqual(summary.keyLabels, ['Q', 'E', 'R', '4', '5']);
  assert.deepEqual(summary.keybindings, oldCodes);
  sim.configureKeybindings(DEFAULT_BINDINGS);
  sim.configureLoadout(loadout(['focused-energy', 'astral-flare']));
  assert.deepEqual(sim.summary, summary); assert.deepEqual(sim.metrics(), summary);
  const snapshot = sim.snapshot();
  assert.deepEqual(snapshot.keybindings, DEFAULT_BINDINGS);
  assert.deepEqual(snapshot.keyLabels, SLOT_KEYS);
  assert.deepEqual(snapshot.availableSpells.map(({id, key, keyCode}) => ({id, key, keyCode})), [
    {id: 'focused-energy', key: '1', keyCode: 'Digit1'},
    {id: 'astral-flare', key: '2', keyCode: 'Digit2'},
  ]);
  const metrics = sim.metrics(); metrics.keyLabels[0] = 'Z'; metrics.keybindings[0] = 'KeyZ';
  assert.deepEqual(sim.summary, summary);
  sim.start(); sim.stop();
  assert.deepEqual(sim.summary.keyLabels, SLOT_KEYS);
  assert.deepEqual(sim.summary.loadout.abilities, ['focused-energy', 'astral-flare']);
});

test('long key names fit complete Canvas icon bounds at HUD and above-player sizes', () => {
  const codes = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Semicolon', 'KeyQ',
    ...Array.from({length: 10}, (_, digit) => `Numpad${digit}`),
    'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide', 'NumpadDecimal', 'NumpadComma', 'NumpadEqual'];
  for (const size of [42, 58, 80]) for (const code of codes) {
    const key = keyLabel(code);
    const {context, labels, canvas} = recordingContext(size, size);
    drawSpellIcon(context, 'astral-flare', 0, 0, size, {key, cooldown: 4, cooldownMax: 8, storedCharges: true, charges: 2, maxCharges: 3});
    const text = labels.find(label => label.text === key);
    assert.ok(text, `${code} is drawn in full`);
    const {metrics, transform, strokeWidth} = text;
    const left = (text.x - metrics.actualBoundingBoxLeft - strokeWidth / 2) * transform.a + transform.e;
    const right = (text.x + metrics.actualBoundingBoxRight + strokeWidth / 2) * transform.a + transform.e;
    const top = (text.y - metrics.actualBoundingBoxAscent - strokeWidth / 2) * transform.d + transform.f;
    const bottom = (text.y + metrics.actualBoundingBoxDescent + strokeWidth / 2) * transform.d + transform.f;
    assert.ok(left >= 0 && right <= size && top >= 0 && bottom <= size,
      `${code} ${size}px bounds ${left},${right},${top},${bottom}`);
    if (key.length === 1) {
      assert.equal(text.x, 13); assert.equal(text.y, 14); assert.match(text.font, /15px/);
    }
    assert.ok(canvas.getContext('2d').getImageData(0, 0, size, size).data.some(value => value));
  }
});

test('starting composition retains enemies above the player for both layouts', () => {
  for (const layout of ['spread', 'clustered']) {
    const sim = fresh(undefined, {layout}); sim.spawnWave(); sim.spawnWave();
    assert.ok(sim.player.y > 400); assert.equal(sim.player.x, 500);
    assert.ok(sim.targets.every(target => target.y < sim.player.y - 150));
  }
});

test('shared resource readiness follows the resolved spender cost and consumption', () => {
  const sim = fresh(loadout(['destructive-rift']));
  assert.equal(spellReadiness(sim, 'destructive-rift').ready, null);
  sim.resource.value = 2;
  assert.equal(spellReadiness(sim, 'destructive-rift').locked, true);
  sim.resource.value = 3;
  assert.equal(spellReadiness(sim, 'destructive-rift').ready, 'resource');
  assert.equal(sim.use('destructive-rift').ok, true);
  assert.equal(spellReadiness(sim, 'destructive-rift').ready, null);
  const flexible = fresh(loadout(['destructive-rift'], {'destructive-rift': 'v1'}));
  flexible.resource.value = 1;
  assert.equal(spellReadiness(flexible, 'destructive-rift').ready, 'resource');
  assert.equal(spellReadiness(flexible, 'destructive-rift').resourceRequired, 1);
  assert.equal(spellReadiness(flexible, 'veil-bolt').locked, true);
});

test('stored spell charges and serial recharge are separate from shared Astral charges', () => {
  const sim = fresh(loadout(['astral-flare', 'destructive-rift'], {'astral-flare': 'v3'}));
  sim.resource.value = 2;
  assert.equal(spellReadiness(sim, 'astral-flare').ready, 'charges');
  assert.equal(spellReadiness(sim, 'astral-flare').charges, 3);
  sim.use('astral-flare');
  const partial = spellReadiness(sim, 'astral-flare');
  assert.equal(partial.charges, 2); assert.equal(partial.maxCharges, 3);
  assert.equal(partial.cooldown, 0); assert.equal(partial.recharge, 10);
  assert.equal(partial.ready, 'charges'); assert.equal(sim.resource.value, 2);
  sim.advance(1.2); sim.use('astral-flare'); sim.advance(1.2); sim.use('astral-flare');
  const empty = spellReadiness(sim, 'astral-flare');
  assert.equal(empty.charges, 0); assert.equal(empty.locked, true); assert.equal(empty.ready, null);
  assert.equal(empty.cooldown, 7.6);
  const {context, words} = recordingContext(80, 80);
  drawSpellIcon(context, 'astral-flare', 0, 0, 80, empty);
  assert.ok(words.includes('0'), 'zero stored charges must remain visible');
  sim.advance(7.6);
  const recharged = spellReadiness(sim, 'astral-flare');
  assert.equal(recharged.charges, 1); assert.equal(recharged.recharge, 10); assert.equal(recharged.cooldown, 0);
  assert.equal(spellReadiness(sim, 'destructive-rift').ready, null);
});

test('a cost and stored-charge combination needs both resources before a ready cue', () => {
  const sim = fresh(loadout(['destructive-rift']));
  sim.resource.value = 3;
  sim.spellCharges['destructive-rift'] = {current: 0, max: 2, nextRecharge: HZ * 5};
  assert.equal(spellReadiness(sim, 'destructive-rift').ready, null);
  sim.spellCharges['destructive-rift'].current = 1;
  assert.equal(spellReadiness(sim, 'destructive-rift').ready, 'resource');
  sim.resource.value = 2;
  assert.equal(spellReadiness(sim, 'destructive-rift').ready, null);
});

test('cooldown, captured GCD duration and pause remain independent', () => {
  const sim = fresh(loadout(['focused-energy', 'astral-flare']));
  sim.use('focused-energy'); sim.advance(1.2); sim.use('astral-flare');
  const state = spellReadiness(sim, 'astral-flare');
  assert.equal(state.cooldown, 8); assert.equal(state.cooldownMax, 8);
  assert.equal(state.gcdMax, sim.gcdDuration); assert.ok(state.gcdMax < 1.2);
  assert.equal(state.gcd, sim.gcdDuration);
  sim.advance(.4); const before = spellReadiness(sim, 'astral-flare');
  sim.pause(); sim.advance(100); assert.deepEqual(spellReadiness(sim, 'astral-flare'), before);
  sim.resume(); sim.advance(7.6); assert.equal(spellReadiness(sim, 'astral-flare').cooldown, 0);
});

test('real clock drawing uses numeric labels, remaining sectors and remapped keys', () => {
  const {context, words, arcs} = recordingContext(80, 80);
  drawSpellIcon(context, 'astral-flare', 0, 0, 80, {cooldown: 4, cooldownMax: 8, gcd: .6, gcdMax: 1.2, key: 'R'});
  assert.ok(words.includes('4.0')); assert.ok(words.includes('CD')); assert.ok(words.includes('R'));
  assert.ok(arcs.some(arc => Math.abs(arc[3] - Math.PI / 2) < 1e-9 && Math.abs(arc[4] - Math.PI * 1.5) < 1e-9));
  words.length = 0;
  drawSpellIcon(context, 'lingering-glimmer', 0, 0, 80, {gcd: .9, gcdMax: 1.2, key: '5'});
  assert.ok(words.includes('GCD')); assert.ok(words.includes('0.9')); assert.ok(words.includes('5'));
});

test('HUD derives generator, spender, charge, buff and ability labels from selected definitions', () => {
  const sim = fresh(loadout(['gloam-thread', 'destructive-rift', 'astral-flare', 'focused-energy'], {'gloam-thread': 'v2', 'astral-flare': 'v3'}));
  let view = buildHud(sim);
  assert.deepEqual(view.resource, {value: 0, max: 3, label: 'Astral charges', hasGenerator: true, hasSpender: true});
  assert.equal(Object.hasOwn(view, 'proc'), false);
  assert.deepEqual(view.abilities.map(spell => spell.id), sim.spells.map(spell => spell.id));
  assert.match(view.abilities[2].label, /3\/3 stored charges/);
  sim.use('focused-energy'); view = buildHud(sim);
  assert.equal(view.buffs[0].name, 'Focused Energy'); assert.equal(view.buffs[0].seconds, 15);
  const multiplier = fresh(loadout(['focused-energy'], {'focused-energy': 'v3'}));
  assert.equal(buildHud(multiplier).resource.hasGenerator, false);
  assert.equal(buildHud(multiplier).resource.hasSpender, false);
  assert.equal(buildHud(multiplier).metrics.dotCoverage, null);
});

test('HUD tracks every selected maintenance DoT with missing and refresh warnings', () => {
  const sim = fresh(loadout(['veil-bolt', 'lingering-glimmer'], {'veil-bolt': 'v2', 'lingering-glimmer': 'v3'}));
  assert.equal(maintenanceDots(sim.spells).length, 2);
  let target = buildHud(sim).targets[0];
  assert.equal(target.dots.length, 2); assert.equal(target.dotClass, 'missing');
  assert.match(target.dot, /No Lingering Touch/); assert.match(target.dot, /No Lingering Glimmer/);
  sim.use('lingering-glimmer'); sim.advance(1.2); sim.use('veil-bolt'); sim.advance(1.5);
  target = buildHud(sim).targets[0];
  assert.equal(target.dotClass, ''); assert.ok(target.dots.every(dot => !dot.missing));
  assert.match(target.dot, /Lingering Touch 18\.0s/); assert.match(target.dot, /Lingering Glimmer 33\.3s/);
  sim.tick = sim.target().dots['lingering-touch'].expires - HZ;
  target = buildHud(sim).targets[0];
  assert.equal(target.dotClass, 'refresh');
  const {context, words} = recordingContext();
  const renderer = new ArenaRenderer(createCanvas(1000, 560));
  renderer.target(context, sim.target(), sim);
  assert.ok(words.some(word => word.startsWith('LT ')));
  assert.ok(words.some(word => word.startsWith('LG ')));
});

test('arena ready cues reflect selected spells, current charges and remapped keys', () => {
  const sim = fresh(loadout(['destructive-rift', 'astral-flare', 'veil-bolt'], {'astral-flare': 'v3'}));
  sim.resource.value = 3;
  const renderer = new ArenaRenderer(createCanvas(1000, 560));
  const {context, words} = recordingContext();
  renderer.player(context, sim);
  assert.ok(words.includes('1')); assert.ok(words.includes('2')); assert.ok(!words.includes('5'));
  sim.resource.value = 0; sim.spellCharges['astral-flare'].current = 0; words.length = 0;
  renderer.player(context, sim);
  assert.deepEqual(words, ['YOU']);
});

test('custom labels stay identical across HUD, readiness and complete arena renders', () => {
  const codes = ['ArrowRight', 'Space', 'Numpad0', 'Semicolon', 'KeyQ'];
  const sim = fresh(loadout(['destructive-rift', 'astral-flare', 'area-pulse'], {'astral-flare': 'v3', 'area-pulse': 'v3'}), {keybindings: codes});
  sim.resource.value = 3;
  const {canvas, context, words} = recordingContext();
  canvas.getBoundingClientRect = () => ({left: 0, top: 0, width: 1000, height: 560});
  const renderer = new ArenaRenderer(canvas); renderer.ctx = context;
  const check = () => {
    const view = buildHud(sim);
    assert.deepEqual(view.abilities.map(spell => spell.key), sim.keybindings.slice(0, 3).map(keyLabel));
    for (const spell of view.abilities) {
      assert.equal(spell.state.key, spell.key);
      assert.equal(spellReadiness(sim, spell.id).key, spell.key);
      assert.equal(spell.keyCode, sim.keybindings[spell.index]);
    }
    words.length = 0; renderer.draw(sim);
    for (const spell of view.abilities) assert.ok(words.includes(spell.key), `${spell.key} appears above the player`);
    assert.ok(canvas.getContext('2d').getImageData(0, 0, 1000, 560).data.some(value => value));
  };
  check(); sim.pause(); sim.configureKeybindings(DEFAULT_BINDINGS); check();
  sim.resume(); check();
});

test('all generic effect visuals, maintenance rings, links and hazards draw on a real canvas', () => {
  const sim = fresh(loadout(['veil-bolt', 'lingering-glimmer', 'chain-strike'], {'veil-bolt': 'v2', 'chain-strike': 'v1'}));
  sim.spawnWave(); sim.spawnHazard();
  sim.use('lingering-glimmer'); sim.advance(1.2); sim.use('veil-bolt'); sim.advance(1.5);
  sim.links = [{sourceId: 'dummy', targetIds: [sim.targets[1].id], spellId: 'chain-strike', expires: sim.tick + HZ * 10, fraction: .1}];
  const canvas = createCanvas(1000, 560);
  canvas.getBoundingClientRect = () => ({left: 0, top: 0, width: 1000, height: 560});
  const renderer = new ArenaRenderer(canvas);
  renderer.draw(sim); const baseline = hash(canvas);
  for (const [index, type] of ['projectile', 'pulse', 'dot', 'beam', 'link', 'buff', 'death'].entries()) {
    sim.effect(type, {x: 130 + index * 110, y: 320}, {color: '#ff99cc', radius: 60, duration: 1, start: sim.tick - HZ * .3});
  }
  renderer.draw(sim);
  assert.notEqual(hash(canvas), baseline);
  assert.ok(renderer.ctx.getImageData(0, 0, 1000, 560).data.some(value => value));
});

test('browser tools expose dynamic loadouts and reject unselected spell attempts', async () => {
  const sim = fresh(loadout(['chain-strike', 'focused-energy']));
  const registry = new Map(), configured = [], casted = [];
  let signal;
  const unregister = registerTrainingTools({registerTool(tool, options) { registry.set(tool.name, tool); signal = options.signal; }}, {
    sim, configure: input => configured.push(input), castSpell: id => casted.push(id),
    startSession() {}, pauseSession() {}, resumeSession() {}, stopSession() {}, selectTarget() {},
  });
  const configure = registry.get('configure_training_session');
  assert.equal(configure.inputSchema.properties.loadout.type, 'object');
  assert.deepEqual(configure.inputSchema.properties.layout.enum, ['spread', 'clustered']);
  const input = {loadout: loadout(['veil-bolt'], {'veil-bolt': 'v3'}), layout: 'clustered'};
  await configure.execute(input); assert.deepEqual(configured, [input]);
  const cast = registry.get('cast_training_spell');
  assert.equal(cast.inputSchema.properties.spell.enum, undefined);
  await assert.rejects(cast.execute({spell: 'veil-bolt'}), /not in the selected loadout/);
  await cast.execute({spell: 'chain-strike'}); assert.deepEqual(casted, ['chain-strike']);
  sim.spells = compileLoadout(loadout(['veil-bolt']));
  await cast.execute({spell: 'veil-bolt'}); assert.deepEqual(casted, ['chain-strike', 'veil-bolt']);
  unregister(); assert.equal(signal.aborted, true);
});

test('new stopped-preview spells have finite readiness before session reset', () => {
  const sim = fresh(loadout(['veil-bolt']));
  sim.advance(1); sim.stop();
  sim.configureLoadout(loadout(['astral-flare'], {'astral-flare': 'v3'}));
  const state = spellReadiness(sim, 'astral-flare');
  for (const field of ['cooldown', 'cooldownMax', 'gcd', 'gcdMax', 'charges', 'maxCharges', 'recharge']) assert.ok(Number.isFinite(state[field]), field);
  assert.equal(buildHud(sim).abilities[0].name, 'Astral Flare');
});

test('clustered maintenance badges avoid actors and one another', () => {
  const sim = fresh(loadout(['veil-bolt', 'lingering-glimmer'], {'veil-bolt': 'v2'}), {layout: 'clustered'});
  sim.spawnWave(); sim.spawnWave();
  sim.use('lingering-glimmer'); sim.advance(1.2); sim.use('veil-bolt'); sim.advance(1.5);
  for (const target of sim.targets) target.dots = {...sim.target().dots};
  const canvas = createCanvas(1000, 560);
  canvas.getBoundingClientRect = () => ({left: 0, top: 0, width: 1000, height: 560});
  const renderer = new ArenaRenderer(canvas); renderer.draw(sim);
  assert.equal(renderer.dotLabelBounds.length, sim.targets.length);
  const intersects = (a, b) => Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x)
    && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
  const actors = sim.targets.map(target => ({x: target.x - target.r - 13, y: target.y - target.r - 20, width: target.r * 2 + 26, height: target.r + 84}));
  renderer.dotLabelBounds.forEach((badge, index, badges) => {
    assert.ok(actors.every(actor => !intersects(badge, actor)));
    assert.ok(badges.slice(index + 1).every(other => !intersects(badge, other)));
  });
});

test('hostile circle and lane warning colors are red, while target and friendly spell colors stay distinct', () => {
  const sim = fresh();
  const renderer = new ArenaRenderer(createCanvas(1000, 560));
  const actual = createCanvas(1000, 560).getContext('2d');
  const colors = [];
  const context = new Proxy(actual, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, property, value) {
      if (property === 'fillStyle' || property === 'strokeStyle') colors.push(value);
      return Reflect.set(target, property, value, target);
    },
  });
  const isRed = color => {
    if (typeof color !== 'string' || !/^#[a-f\d]{6}([a-f\d]{2})?$/i.test(color)) return false;
    const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
    return r > g && r > b && b >= g;
  };
  for (const type of ['circle', 'line']) for (const live of [false, true]) {
    colors.length = 0;
    const hazard = {type, x: 500, y: 350, r: 76, angle: 0, width: 72, born: 0, impact: HZ * 2, ends: HZ * 3};
    sim.tick = live ? HZ * 2 : HZ;
    renderer.hazard(context, hazard, sim, false);
    renderer.hazard(context, hazard, sim, true);
    assert.ok(colors.length > 2);
    assert.ok(colors.every(isRed), `${type} ${live ? 'impact' : 'warning'} must use a coherent red palette: ${colors}`);
  }
  colors.length = 0;
  renderer.target(context, sim.target(), sim);
  assert.ok(colors.includes('#d9c58f'), 'selected target retains its gold outline');
  colors.length = 0;
  sim.effect('pulse', sim.target(), {color: '#bc9dff', duration: 1, radius: 220});
  sim.tick += HZ / 4;
  renderer.magic(context, sim);
  assert.ok(colors.some(color => String(color).startsWith('#bc9dff')), 'friendly area spell retains its ability color');
});

test('HUD falls back to Astral charges and distinguishes stored spell readiness', () => {
  const sim = new RaidSim({mechanics: false, loadout: {abilities: ['destructive-rift', 'astral-flare'], talents: {'astral-flare': 'v3'}}});
  sim.resource.label = '';
  const view = buildHud(sim);
  assert.equal(view.resource.label, 'Astral charges');
  assert.equal(view.abilities[0].label, '0/3 Astral charges');
  assert.match(view.abilities[1].label, /3\/3 stored charges/);
});
