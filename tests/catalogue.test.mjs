import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ABILITIES, CATALOGUE, DEFAULT_LOADOUT, SLOT_KEYS, compileAbility, compileLoadout, validateCatalogue, validateLoadout} from '../src/lib/catalogue.js';

const copy = value => structuredClone(value);
const changed = mutate => { const catalogue = copy(CATALOGUE); mutate(catalogue); return catalogue; };
const invalid = (catalogue, pattern) => {
  const result = validateCatalogue(catalogue);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length);
  if (pattern) assert.match(result.errors.join('\n'), pattern);
};

test('versioned catalogue has the eight approved bases and exactly 24 talent choices', () => {
  assert.deepEqual(validateCatalogue(CATALOGUE), {valid: true, errors: []});
  assert.equal(CATALOGUE.schemaVersion, 1);
  assert.deepEqual(CATALOGUE.resource, {id: 'void', max: 3});
  assert.equal(ABILITIES, CATALOGUE.abilities);
  assert.equal(ABILITIES.length, 8);
  assert.equal(ABILITIES.flatMap(ability => ability.talents).length, 24);
  assert.deepEqual(ABILITIES.map(ability => ability.id), ['veil-bolt', 'lingering-glimmer', 'gloam-thread', 'astral-flare', 'destructive-rift', 'area-pulse', 'chain-strike', 'focused-energy']);
  for (const ability of ABILITIES) {
    assert.equal(ability.icon, ability.id);
    assert.deepEqual(ability.talents.map(talent => talent.id), ['v1', 'v2', 'v3']);
  }
});

for (const ability of ABILITIES) for (const talentId of [null, ...ability.talents.map(talent => talent.id)]) {
  test(`compiles ${ability.id}/${talentId ?? 'base'} without changing source data`, () => {
    const original = JSON.stringify(CATALOGUE);
    const result = compileAbility(ability.id, talentId);
    assert.equal(result.id, ability.id);
    assert.equal(result.talentId, talentId);
    assert.equal(result.detail, result.description);
    assert.ok(result.type.length > 0);
    assert.equal(result.talentName, talentId ? ability.talents.find(talent => talent.id === talentId).name : 'Base');
    result.effects[0].amount = 999;
    assert.equal(JSON.stringify(CATALOGUE), original);
  });
}

test('player-facing catalogue uses Astral charges while preserving compatibility IDs and ability names', () => {
  assert.equal(CATALOGUE.resource.id, 'void');
  assert.equal(ABILITIES.find(ability => ability.id === 'lingering-glimmer').talents[0].name, 'Lingering Resource');
  for (const ability of ABILITIES) for (const talentId of [null, ...ability.talents.map(talent => talent.id)]) {
    const compiled = compileAbility(ability.id, talentId);
    assert.doesNotMatch(`${compiled.name} ${compiled.description} ${compiled.type}`, /\bvoid\b/i);
    const gains = [...compiled.effects, ...compiled.triggers.flatMap(trigger => trigger.effects)]
      .some(effect => effect.type === 'resource' || effect.modifiers?.resourceGain);
    if (gains || compiled.cost && ['base', 'v1', 'v2'].includes(talentId ?? 'base')) {
      assert.match(compiled.description, /Astral charge/);
    }
    if (compiled.charges > 1) assert.match(compiled.type, /stored spell charges/);
  }
  const warning = validateLoadout({abilities: ['veil-bolt'], talents: {'veil-bolt': 'v3'}}).warnings.join(' ');
  assert.match(warning, /generates Astral charges/);
  assert.doesNotMatch(warning, /\bvoid\b/i);
});

test('source catalogue and default loadout are deeply frozen', () => {
  assert.ok(Object.isFrozen(CATALOGUE));
  assert.ok(Object.isFrozen(ABILITIES[0].talents[0].patch.effects[0]));
  assert.ok(Object.isFrozen(DEFAULT_LOADOUT.abilities));
  assert.throws(() => { CATALOGUE.resource.max = 4; }, TypeError);
});

test('compiler recursively merges plain objects and replaces arrays', () => {
  const mobile = compileAbility('astral-flare', 'v2');
  assert.deepEqual(mobile.activation, {kind: 'cast', duration: 1, moving: true});
  assert.deepEqual(mobile.effects, [{type: 'damage', amount: 520}]);
  assert.equal(mobile.cooldown, 0);
  const thread = compileAbility('gloam-thread', 'v3');
  assert.equal(thread.targeting.range, 700);
  assert.equal(thread.targeting.additional, 1);
  assert.equal(thread.targeting.secondaryMultiplier, 0.5);
  const chaos = compileAbility('destructive-rift', 'v2');
  assert.deepEqual(chaos.cost, {min: 3, amount: 3, spend: 'fixed', retainedOutcomes: [0, 1, 2, 3]});
  assert.deepEqual(compileAbility('veil-bolt', 'base'), compileAbility('veil-bolt'));
});

test('all Glimmer variants stay instant DoTs with correctly scoped triggers', () => {
  for (const id of [null, 'v1', 'v2', 'v3']) {
    const ability = compileAbility('lingering-glimmer', id);
    assert.equal(ability.activation.kind, 'instant');
    assert.equal(ability.effects.length, 1);
    assert.equal(ability.effects[0].type, 'dot');
    assert.equal(ability.effects[0].amount, 240);
  }
  assert.deepEqual(compileAbility('lingering-glimmer', 'v1').triggers, [{event: 'periodicTick', chance: 0.02, effects: [{type: 'resource', amount: 1}]}]);
  assert.deepEqual(compileAbility('lingering-glimmer', 'v2').triggers, [{event: 'cast', chance: 0.5, effects: [{type: 'restoreCooldown', abilityId: 'astral-flare'}]}]);
  assert.equal(compileAbility('lingering-glimmer', 'v3').effects[0].duration, 36);
});

test('Veil inversion keeps stable IDs and explicit damage/cooldown inheritance', () => {
  const bolt = ABILITIES.find(ability => ability.id === 'veil-bolt');
  assert.deepEqual(bolt.talents.map(({id, name}) => [id, name]), [
    ['v1', 'Light Veil'], ['v2', 'Lingering Touch'], ['v3', 'Charged Veil'],
  ]);
  for (const [talent, amount, cooldown] of [[null, 1150, 6], ['v1', 640, 0], ['v2', 640, 6], ['v3', 1150, 6]]) {
    const ability = compileAbility('veil-bolt', talent);
    assert.deepEqual(ability.activation, {kind: 'cast', duration: 1.5, moving: false});
    assert.equal(ability.gcd, 1.2);
    assert.equal(ability.cooldown, cooldown);
    assert.equal(ability.charges, 1);
    assert.deepEqual(ability.effects[0], {type: 'damage', amount});
    assert.equal(ability.effects.length, talent === 'v2' ? 2 : 1);
    if (talent !== 'v3') assert.deepEqual(ability.triggers, []);
  }
  assert.deepEqual(compileAbility('veil-bolt', 'v2').effects[1], {
    type: 'dot', id: 'lingering-touch', name: 'Lingering Touch', duration: 18,
    interval: 3, amount: 180, carry: 0.3, maintenance: true,
  });
  assert.deepEqual(compileAbility('veil-bolt', 'v3').triggers,
    [{event: 'hit', chance: 0.2, effects: [{type: 'resource', amount: 1}]}]);
  assert.equal(Object.hasOwn(bolt.talents[1].patch, 'cooldown'), false);
  assert.equal(Object.hasOwn(bolt.talents[2].patch, 'cooldown'), false);
  assert.equal(Object.hasOwn(bolt.talents[2].patch, 'effects'), false);
});

test('Thread completion resource, ramp and nearest-target split are declarative', () => {
  assert.deepEqual(compileAbility('gloam-thread').activation, {kind: 'channel', duration: 3, moving: false, interval: 0.75});
  assert.equal(compileAbility('gloam-thread', 'v1').effects[0].rampPerTick, 0.25);
  assert.deepEqual(compileAbility('gloam-thread', 'v2').triggers, [{event: 'complete', chance: 1, effects: [{type: 'resource', amount: 1}]}]);
  assert.equal(compileAbility('gloam-thread', 'v3').targeting.additional, 1);
});

test('stored charges, flexible spender and full reset are declarative', () => {
  for (const id of ['astral-flare', 'area-pulse']) {
    const ability = compileAbility(id, 'v3');
    assert.equal(ability.charges, 3);
    assert.equal(ability.cooldown, 10);
    assert.equal(ability.activation.kind, 'instant');
  }
  const devouring = compileAbility('destructive-rift', 'v1');
  assert.deepEqual(devouring.cost, {min: 1, amount: 3, spend: 'all'});
  assert.equal(devouring.effects.length, 1);
  assert.equal(devouring.effects[0].type, 'dot');
  assert.equal(devouring.effects[0].perResource, true);
  const refreshing = compileAbility('destructive-rift', 'v3');
  assert.deepEqual(refreshing.effects.slice(1), [{type: 'resetCooldowns'}, {type: 'refreshDots'}]);
});

test('Pulse channel is channel-owned damage; Chain maintenance names only existing lingering DoTs', () => {
  const channel = compileAbility('area-pulse', 'v2');
  assert.equal(channel.activation.kind, 'channel');
  assert.equal(channel.activation.duration / channel.activation.interval, 8);
  assert.deepEqual(channel.effects, [{type: 'damage', amount: 450}]);
  assert.deepEqual(compileAbility('chain-strike', 'v2').effects[1], {type: 'refreshDots', ids: ['lingering-glimmer', 'lingering-touch']});
  assert.equal(compileAbility('chain-strike', 'v2').cooldown, 10);
  assert.deepEqual(compileAbility('chain-strike', 'v3').triggers, [{event: 'hit', chance: 0.1, effects: [{type: 'resource', amount: 1}]}]);
});

test('Focus affects only cast/GCD timing and optional builder gains', () => {
  const focus = compileAbility('focused-energy');
  assert.equal(focus.targeting.kind, 'self');
  assert.equal(focus.effects[0].duration, 15);
  assert.deepEqual(focus.effects[0].modifiers, {castTime: 0.9, gcd: 0.9});
  assert.deepEqual(compileAbility('focused-energy', 'v1').effects[0].modifiers, {castTime: 0.8, gcd: 0.8});
  assert.equal(compileAbility('focused-energy', 'v2').cooldown, 60);
  assert.equal(compileAbility('focused-energy', 'v3').effects[0].modifiers.resourceGain, 2);
});

test('loadout compiler maps chosen order onto only five action-bar keys', () => {
  assert.deepEqual(SLOT_KEYS, ['1', '2', '3', '4', '5']);
  const result = compileLoadout(DEFAULT_LOADOUT);
  assert.equal(result.length, 5);
  result.forEach((ability, index) => {
    assert.equal(ability.id, DEFAULT_LOADOUT.abilities[index]);
    assert.equal(ability.key, SLOT_KEYS[index]);
    assert.equal(ability.index, index);
  });
  assert.equal(validateLoadout({abilities: ['focused-energy']}).valid, true);
  assert.equal(compileLoadout({abilities: ['astral-flare'], talents: {'astral-flare': 'v3'}})[0].charges, 3);
});

test('invalid loadout count, duplicate, unknown, extra key and unselected talent fail', () => {
  const invalidLoadouts = [
    null, {}, {abilities: []}, {abilities: ABILITIES.slice(0, 6).map(a => a.id)},
    {abilities: ['veil-bolt', 'veil-bolt']}, {abilities: ['wraithbolt']},
    {abilities: ['veil-bolt'], utility: 'focused-energy'},
    {abilities: ['veil-bolt'], talents: {'astral-flare': 'v1'}},
    {abilities: ['veil-bolt'], talents: {'veil-bolt': 'v4'}},
    {abilities: ['veil-bolt'], talents: null},
    {abilities: [{toString: null, valueOf: null}]},
  ];
  for (const loadout of invalidLoadouts) {
    assert.equal(validateLoadout(loadout).valid, false);
    assert.throws(() => compileLoadout(loadout), TypeError);
  }
  assert.equal(validateLoadout({abilities: ['veil-bolt'], talents: {'veil-bolt': null}}).valid, true);
  assert.equal(validateLoadout({abilities: ['veil-bolt'], talents: {'veil-bolt': 'base'}}).valid, true);
});

test('composition warnings never silently add a generator or sixth utility', () => {
  const spender = validateLoadout({abilities: ['destructive-rift']});
  assert.equal(spender.valid, true);
  assert.match(spender.warnings.join(' '), /no Astral charge generator/);
  const balanced = validateLoadout({abilities: ['destructive-rift', 'gloam-thread'], talents: {'gloam-thread': 'v2'}});
  assert.deepEqual(balanced.warnings, []);
  const dependent = validateLoadout({abilities: ['lingering-glimmer'], talents: {'lingering-glimmer': 'v2'}});
  assert.match(dependent.warnings.join(' '), /astral-flare.*not selected/);
  assert.equal(compileLoadout({abilities: ['destructive-rift']}).length, 1);
});

test('rejects unknown schema, duplicate IDs, missing metadata and unknown properties', () => {
  invalid(changed(c => { c.schemaVersion = 2; }), /schemaVersion/);
  invalid(changed(c => { c.abilities[1].id = c.abilities[0].id; }), /duplicate ability/);
  invalid(changed(c => { c.abilities[0].talents[1].id = 'v1'; }), /duplicate talent/);
  invalid(changed(c => { delete c.abilities[0].name; }), /name/);
  invalid(changed(c => { c.abilities[0].execute = 'return 999'; }), /unknown field/);
  invalid(changed(c => { c.abilities[0].effects[0].callback = 'run'; }), /unknown field/);
  invalid(changed(c => { c.abilities[0].talents[0].patch.id = 'renamed'; }), /patch.id/);
  invalid(changed(c => { c.abilities[0].talents[0].patch.talents = []; }), /patch.talents/);
});

test('invalid compiled variants are rejected even when their bases are valid', () => {
  invalid(changed(c => { c.abilities[0].talents[0].patch.gcd = 0; }), /compiled.gcd/);
  invalid(changed(c => { c.abilities[0].talents[0].patch.effects = []; }), /compiled.effects/);
  invalid(changed(c => { c.abilities[0].talents[0].patch.activation = {kind: 'instant'}; }), /duration/);
  invalid(changed(c => { c.abilities[0].talents[0].patch.targeting = {kind: 'area'}; }), /radius/);
});

test('rejects invalid numbers, fractional counts, timing and impossible charging', () => {
  for (const value of [NaN, Infinity, -Infinity, -1, 0, 1e-10]) invalid(changed(c => { c.abilities[0].gcd = value; }));
  invalid(changed(c => { c.abilities[0].charges = 1.5; }), /integer/);
  invalid(changed(c => { c.abilities[0].charges = 3; c.abilities[0].cooldown = 0; }), /positive cooldown/);
  invalid(changed(c => { c.abilities[0].cooldown = 0.0001; }), /simulation tick/);
  invalid(changed(c => { c.abilities[2].activation.interval = 0; }), /interval/);
  invalid(changed(c => { c.abilities[2].activation.interval = 0.7; }), /whole number/);
  invalid(changed(c => { c.abilities[0].activation.interval = 0.5; }), /only channels/);
  invalid(changed(c => { c.abilities[0].targeting.radius = 4; }), /area targeting/);
  invalid(changed(c => { c.abilities[0].effects[0].rampPerTick = 0.2; }), /requires a channel/);
  invalid(changed(c => { c.abilities[0].triggers = [{event: 'hit', chance: 1.01, effects: [{type: 'resource', amount: 1}]}]; }), /chance/);
});

test('validates minimum effective GCD and casts across distinct buff identities', () => {
  invalid(changed(c => { c.abilities[7].effects[0].modifiers.gcd = 0; }), /strictly positive/);
  invalid(changed(c => { c.abilities[7].effects[0].modifiers.gcd = 0.001; }), /effective GCD/);
  invalid(changed(c => { c.abilities[7].effects[0].modifiers.castTime = 0.001; }), /effective cast/);
  invalid(changed(c => { c.abilities[7].effects[0].modifiers.gcd = Number.MAX_VALUE; }), /effective GCD/);
  const allowed = changed(c => {
    c.abilities[7].effects[0].modifiers.gcd = 101;
    c.abilities[7].effects[0].modifiers.resourceGain = 0.001;
  });
  assert.equal(validateCatalogue(allowed).valid, true, 'no arbitrary .01–100 multiplier cap');
  const combined = changed(c => {
    c.abilities[7].effects = [
      {type: 'buff', id: 'one', duration: 15, modifiers: {gcd: 0.1}},
      {type: 'buff', id: 'two', duration: 15, modifiers: {gcd: 0.1}},
    ];
  });
  invalid(combined, /effective GCD/);
});

test('resource gain combinations cannot overflow even before applying the cap', () => {
  invalid(changed(c => {
    c.abilities[7].effects = [
      {type: 'buff', id: 'one', duration: 15, modifiers: {resourceGain: 1e308}},
      {type: 'buff', id: 'two', duration: 15, modifiers: {resourceGain: 1e308}},
    ];
  }), /resourceGain modifiers must remain finite/);
  invalid(changed(c => {
    c.abilities[7].effects[0].modifiers.resourceGain = 1e308;
    c.abilities[0].talents[2].patch.triggers[0].effects[0].amount = 3;
  }), /effective resource gain must remain finite/);
});

test('effect and resource contracts reject unsupported recursion and bad references', () => {
  invalid(changed(c => { c.abilities[0].effects = [{type: 'script', source: 'damage(999)'}]; }), /unknown effect/);
  invalid(changed(c => { c.abilities[0].triggers = [{event: 'hit', chance: 1, effects: [{type: 'trigger', event: 'hit'}]}]; }), /unknown effect/);
  invalid(changed(c => { c.abilities[0].triggers = [{event: 'periodicTick', chance: 1, effects: [{type: 'resource', amount: 1}]}]; }), /requires a DoT/);
  invalid(changed(c => { c.abilities[1].talents[1].patch.triggers[0].effects[0].abilityId = 'missing-spell'; }), /unknown ability/);
  invalid(changed(c => { c.abilities[6].talents[1].patch.effects[1].ids = ['missing-dot']; }), /unknown DoT/);
  invalid(changed(c => { c.abilities[0].effects[0].perResource = true; }), /requires an ability cost/);
  invalid(changed(c => { c.abilities[4].cost.min = 1; }), /min equal to amount/);
  invalid(changed(c => { c.abilities[4].talents[1].patch.cost.retainedOutcomes = [0, 4]; }), /retainedOutcomes/);
  invalid(changed(c => { c.abilities[4].talents[1].patch.cost.retainedOutcomes = [0, 0]; }), /distinct/);
});

test('never executes getters or accepts callbacks, inherited pollution or exotic objects', () => {
  let read = false;
  const getter = changed(c => { Object.defineProperty(c.abilities[0], 'name', {get() { read = true; return 'unsafe'; }, enumerable: true}); });
  invalid(getter, /accessors/);
  assert.equal(read, false);
  invalid(changed(c => { c.abilities[0].effects[0].callback = () => 1; }), /JSON data/);
  invalid(changed(c => { Object.setPrototypeOf(c.abilities[0], {polluted: true}); }), /inherited/);
  invalid(changed(c => { c.abilities[0].activation = new Date(); }), /custom-prototype/);
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const polluted = JSON.parse(JSON.stringify(CATALOGUE));
    Object.defineProperty(polluted.abilities[0].talents[0].patch, key, {value: {polluted: true}, enumerable: true});
    invalid(polluted, /forbidden/);
  }
  assert.equal({}.polluted, undefined);
});

test('reserved identifiers cannot enter runtime maps as slug values', () => {
  for (const id of ['constructor', 'prototype', '__proto__']) {
    invalid(changed(c => { c.abilities[0].id = id; }), /slug/);
    invalid(changed(c => { c.abilities[0].talents[0].id = id; }), /slug/);
    invalid(changed(c => { c.abilities[1].effects[0].id = id; }), /slug/);
    invalid(changed(c => { c.abilities[7].effects[0].id = id; }), /slug/);
    invalid(changed(c => { c.resource.id = id; }), /slug/);
  }
});

test('channel rounding cannot silently add or remove scheduled ticks', () => {
  for (const [duration, interval] of [[0.21, 0.03], [0.2, 0.04], [0.3, 0.03]]) {
    invalid(changed(c => { c.abilities[2].activation.duration = duration; c.abilities[2].activation.interval = interval; }), /rounded 60 Hz/);
  }
});

test('bounds input size and rejects cycles, sparse arrays and symbolic properties', () => {
  invalid(changed(c => { c.abilities[0].effects.push(c); }), /cyclic/);
  invalid(changed(c => { c.abilities = Array(129).fill(c.abilities[0]); }), /1–128 entries/);
  invalid(changed(c => { c.abilities[0].effects = Array(33).fill({type: 'damage', amount: 1}); }), /1–32 entries/);
  invalid(changed(c => { delete c.abilities[0]; }), /sparse/);
  invalid(changed(c => { c.abilities[0][Symbol('hidden')] = 1; }), /forbidden/);
});

test('malformed schema values return errors instead of throwing during validation', () => {
  for (const replacement of [null, false, 'bad', 2, [], {}]) {
    for (const field of ['activation', 'targeting', 'effects', 'triggers', 'talents', 'cost']) {
      if (Array.isArray(replacement) && ['triggers', 'talents'].includes(field)) continue;
      assert.doesNotThrow(() => invalid(changed(c => { c.abilities[0][field] = replacement; })));
    }
  }
  invalid(changed(c => {
    c.abilities[0].effects = {};
    c.abilities[0].triggers = [{event: 'periodicTick', chance: 1, effects: [{type: 'resource', amount: 1}]}];
  }));
});

test('new JSON spell and talent compile without engine edits', async () => {
  const newSpell = JSON.parse(await readFile(new URL('../docs/examples/new-spell.json', import.meta.url), 'utf8'));
  const extended = copy(CATALOGUE);
  extended.abilities.push(newSpell);
  assert.deepEqual(validateCatalogue(extended), {valid: true, errors: []});
  const result = compileLoadout({abilities: ['dusk-lance'], talents: {'dusk-lance': 'drifting-lance'}}, extended);
  assert.equal(result[0].activation.duration, 1.25);
  assert.equal(result[0].activation.moving, true);
  assert.deepEqual(result[0].effects, [{type: 'damage', amount: 500}]);
  assert.equal(result[0].key, '1');
  assert.equal(ABILITIES.length, 8);
  const {RaidSim} = await import('../src/lib/engine.js');
  const sim = new RaidSim({catalogue: extended, loadout: {abilities: ['dusk-lance'], talents: {'dusk-lance': 'drifting-lance'}}, mechanics: false});
  sim.start(); sim.setMovement(1, 0);
  assert.equal(sim.use('dusk-lance').ok, true);
  sim.advance(1.25);
  assert.equal(sim.totalDamage, 500);
});

test('compile API rejects unknown ids and invalid catalogues', () => {
  assert.throws(() => compileAbility('absent'), RangeError);
  assert.throws(() => compileAbility('veil-bolt', 'absent'), RangeError);
  assert.throws(() => compileAbility('veil-bolt', null, {}), TypeError);
  assert.throws(() => compileAbility({}, null), TypeError);
  assert.throws(() => compileAbility('veil-bolt', {}), TypeError);
});
