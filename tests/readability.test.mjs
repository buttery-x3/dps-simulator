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

const loadout = (abilities, talents = {}) => ({abilities, talents});
const fresh = (selection, options = {}) => {
  const sim = new RaidSim({mechanics: false, ...(selection ? {loadout: selection} : {}), ...options});
  sim.start(); return sim;
};
const hash = canvas => createHash('sha256').update(canvas.toBuffer('image/png')).digest('hex');
function recordingContext(width = 1000, height = 560) {
  const canvas = createCanvas(width, height), actual = canvas.getContext('2d'), words = [], arcs = [];
  const context = new Proxy(actual, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...args) => {
        if (property === 'fillText') words.push(String(args[0]));
        if (property === 'arc') arcs.push(args);
        return value.apply(target, args);
      };
    },
    set(target, property, value) { return Reflect.set(target, property, value, target); },
  });
  return {canvas, context, words, arcs};
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

test('stored spell charges and serial recharge are separate from shared VOID', () => {
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
  assert.deepEqual(view.resource, {value: 0, max: 3, label: 'VOID', hasGenerator: true, hasSpender: true});
  assert.equal(Object.hasOwn(view, 'proc'), false);
  assert.deepEqual(view.abilities.map(spell => spell.id), sim.spells.map(spell => spell.id));
  assert.match(view.abilities[2].label, /3\/3 charges/);
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
  assert.ok(words.includes('Q')); assert.ok(words.includes('E')); assert.ok(!words.includes('5'));
  sim.resource.value = 0; sim.spellCharges['astral-flare'].current = 0; words.length = 0;
  renderer.player(context, sim);
  assert.deepEqual(words, ['YOU']);
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
