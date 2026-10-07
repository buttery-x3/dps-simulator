import test from 'node:test';
import assert from 'node:assert/strict';
import {ABILITIES, CATALOGUE, compileAbility, validateCatalogue} from '../src/lib/catalogue.js';
import {describeAbility} from '../src/lib/ability-details.js';
import {RaidSim} from '../src/lib/engine.js';

const describe = (id, talentId = null, options) => describeAbility(compileAbility(id, talentId, options?.catalogue), options);
const text = details => [...details.facts, ...details.effects].join('\n');

test('DoT totals follow the engine’s integer-tick timing for authored fractional seconds', () => {
  const catalogue = structuredClone(CATALOGUE);
  const dot = catalogue.abilities.find(ability => ability.id === 'lingering-glimmer').effects[0];
  dot.duration = 1.001; dot.interval = 0.334;
  const spell = compileAbility('lingering-glimmer', null, catalogue);
  assert.match(text(describeAbility(spell, {catalogue})), /3 ticks; 720 total/);
  const sim = new RaidSim({catalogue, loadout: {abilities: ['lingering-glimmer'], talents: {}}, mechanics: false});
  sim.start(); sim.use('lingering-glimmer'); sim.advance(2);
  assert.equal(sim.totalDamage, 720);
});
const expected = {
  'veil-bolt/base': [/1\.5s cast/, /No spell cooldown/, /Deals 640 damage/],
  'veil-bolt/v1': [/1\.5s cast/, /6s cooldown/, /Deals 1,150 damage/],
  'veil-bolt/v2': [/Deals 640 damage/, /180 damage every 3s for 18s/, /5\.4s \(30%/],
  'veil-bolt/v3': [/Deals 640 damage/, /completed target hit independently \(20% chance\)/, /Generates 1 Astral charge/],
  'lingering-glimmer/base': [/Instant/, /240 damage every 3s for 18s/, /1,440 total/, /No direct damage on application/],
  'lingering-glimmer/v1': [/Instant/, /240 damage every 3s for 18s/, /damaging DoT tick independently \(2% chance\)/],
  'lingering-glimmer/v2': [/Instant/, /240 damage every 3s for 18s/, /On cast \(50% chance\)/, /exactly 1 stored spell charge/],
  'lingering-glimmer/v3': [/Instant/, /240 damage every 3s for 36s/, /2,880 total/, /10\.8s \(30%/],
  'gloam-thread/base': [/3s channel/, /4 channel ticks of 180 damage/, /every 0\.75s/, /720 total/],
  'gloam-thread/v1': [/3s channel/, /180 → 225 → 270 → 315/, /990 total/],
  'gloam-thread/v2': [/4 channel ticks of 180 damage/, /full channel completion \(guaranteed\)/, /Generates 1 Astral charge/],
  'gloam-thread/v3': [/Up to 2 targets/, /260 per jump/, /180 damage to the primary/, /50% damage \(90 per tick\)/],
  'astral-flare/base': [/Instant/, /8s cooldown/, /Deals 900 damage/],
  'astral-flare/v1': [/8s cooldown/, /Deals 900 damage/, /completed target hit independently \(50% chance\)/],
  'astral-flare/v2': [/1s cast · usable while moving/, /No spell cooldown/, /Deals 520 damage/],
  'astral-flare/v3': [/Instant/, /3 stored spell charges/, /10s recharge each, one at a time/, /Deals 900 damage/],
  'destructive-rift/base': [/1\.5s cast/, /Requires and spends 3 Astral charges/, /Deals 2,400 damage/],
  'destructive-rift/v1': [/Instant/, /Spends all current Astral charges \(1–3\)/, /150–450 damage every 1s for 6s/, /900–2,700 total/],
  'destructive-rift/v2': [/Requires and spends 3 Astral charges/, /Deals 2,400 damage/, /refunds 0, 1, 2, or 3 Astral charges, each with a 25% chance/],
  'destructive-rift/v3': [/Deals 2,400 damage/, /Resets all equipped spell cooldowns/, /fully restores all stored spell charges/, /every existing DoT on living targets/],
  'area-pulse/base': [/Instant/, /30s cooldown/, /220 radius/, /180 damage to each target every 2s for 12s/],
  'area-pulse/v1': [/2s cast/, /30s cooldown/, /Deals 700 damage to each target/, /180 damage to each target every 2s for 12s/],
  'area-pulse/v2': [/4s channel/, /30s cooldown/, /8 channel ticks of 450 damage to each target/, /every 0\.5s \(3,600 total\)/],
  'area-pulse/v3': [/Instant/, /3 stored spell charges/, /10s recharge each, one at a time/, /140 radius/, /Deals 650 damage to each target/],
  'chain-strike/base': [/1\.5s cast/, /Up to 4 targets/, /260 per jump/, /Deals 520 damage to each target/],
  'chain-strike/v1': [/Deals 520 damage to each target/, /primary for 10s/, /Copies 10% of subsequent primary damage/],
  'chain-strike/v2': [/10s cooldown/, /Deals 240 damage to each target/, /existing Lingering Glimmer and Lingering Touch on hit targets/],
  'chain-strike/v3': [/Deals 520 damage to each target/, /completed target hit independently \(10% chance\)/, /Generates 1 Astral charge/],
  'focused-energy/base': [/Self only/, /120s cooldown/, /For 15s, reduces cast time and GCD by 10%/],
  'focused-energy/v1': [/Self only/, /120s cooldown/, /For 15s, reduces cast time and GCD by 20%/],
  'focused-energy/v2': [/60s cooldown/, /For 15s, reduces cast time and GCD by 10%/],
  'focused-energy/v3': [/120s cooldown/, /For 15s, reduces cast time and GCD by 10%/, /Astral charge gains by 2/, /shared cap: 3; refunds unchanged/],
};

for (const ability of ABILITIES) for (const talentId of [null, ...ability.talents.map(talent => talent.id)]) {
  test(`describes every selected fact and effect for ${ability.id}/${talentId ?? 'base'}`, () => {
    const spell = compileAbility(ability.id, talentId);
    const before = JSON.stringify(spell);
    const details = describeAbility(spell, {key: 'Q'});
    assert.deepEqual(Object.keys(details), ['name', 'talentName', 'talentDescription', 'key', 'facts', 'effects']);
    assert.equal(details.name, ability.name);
    assert.equal(details.key, 'Q');
    assert.equal(details.talentName, talentId ? spell.talentName : '');
    assert.equal(details.talentDescription, talentId ? spell.description : '');
    assert.equal(details.facts.length, 5);
    assert.ok(details.effects.length >= spell.effects.length + spell.triggers.length);
    assert.ok([...details.facts, ...details.effects].every(line => typeof line === 'string' && line.length > 0));
    assert.ok(Object.isFrozen(details));
    assert.ok(Object.isFrozen(details.facts));
    assert.ok(Object.isFrozen(details.effects));
    assert.equal(JSON.stringify(spell), before);
    assert.match(text(details), /1\.2s global cooldown \(GCD\)/);
    if (spell.targeting.kind !== 'self') assert.match(text(details), /700 range/);
    if (!spell.cost) assert.match(text(details), /No Astral charge cost/);
    if (spell.activation.kind !== 'instant' && !spell.activation.moving) assert.match(text(details), /stand still; movement interrupts/);
    assert.doesNotMatch(text(details), /void|shards?|NaN|undefined/i);
    const patterns = expected[`${ability.id}/${talentId ?? 'base'}`];
    assert.ok(patterns, 'Every catalogue variant must have independent expected facts');
    for (const pattern of patterns) assert.match(text(details), pattern);
  });
}

test('the exhaustive expectations cover exactly eight bases and 24 talents', () => {
  assert.equal(Object.keys(expected).length, 32);
  assert.equal(Object.keys(expected).filter(key => key.endsWith('/base')).length, 8);
});

test('Astral Refresh distinguishes cooldown reset from exactly one stored spell charge', () => {
  const refresh = describe('lingering-glimmer', 'v2').effects.at(-1);
  assert.match(refresh, /On cast \(50% chance\)/);
  assert.match(refresh, /Resets Astral Flare's cooldown, or restores exactly 1 stored spell charge/);
  assert.match(refresh, /charge-based variant \(if equipped\)/);
  assert.doesNotMatch(refresh, /full|3 stored|Astral charge/);
  assert.match(text(describe('destructive-rift', 'v3')), /fully restores all stored spell charges/);
});

test('stored spell charges are separate from the shared Astral charge resource', () => {
  for (const id of ['astral-flare', 'area-pulse']) {
    const details = describe(id, 'v3');
    assert.match(text(details), /3 stored spell charges · 10s recharge each, one at a time · no expiry/);
    assert.match(text(details), /No Astral charge cost/);
  }
});

test('Chaos refunds are one equally likely roll after resolution, unaffected by gain buffs', () => {
  const details = describe('destructive-rift', 'v2');
  assert.match(text(details), /Requires and spends 3 Astral charges/);
  assert.match(details.effects.at(-1), /After successful resolution, refunds 0, 1, 2, or 3 Astral charges, each with a 25% chance/);
  assert.match(details.effects.at(-1), /One roll per cast; refunds are unaffected by gain buffs/);
});

test('Devouring uses all available charges and replaces the direct hit with variable periodic damage', () => {
  const details = describe('destructive-rift', 'v1');
  assert.match(text(details), /Spends all current Astral charges \(1–3\); requires at least 1 Astral charge/);
  assert.match(text(details), /150–450 damage every 1s for 6s \(150 per Astral charge spent\)/);
  assert.match(text(details), /6 ticks; 900–2,700 total/);
  assert.match(text(details), /No direct damage on application/);
  assert.doesNotMatch(text(details), /2,400|1\.5s cast/);
});

test('Focus describes cast/GCD effects without falsely speeding channels or DoTs', () => {
  for (const id of [null, 'v1', 'v2', 'v3']) {
    const details = describe('focused-energy', id);
    assert.match(text(details), /reduces cast time and GCD by (?:10|20)%/);
    assert.match(text(details), /Channels and DoT tick timing are unchanged/);
  }
  assert.match(text(describe('focused-energy', 'v3')), /multiplies successful Astral charge gains by 2 \(shared cap: 3; refunds unchanged\)/);
});

test('ramps, nearest-target cleave, and linked damage expose their actual semantics', () => {
  assert.match(text(describe('gloam-thread', 'v1')), /180 → 225 → 270 → 315 damage \(990 total\)/);
  assert.match(text(describe('gloam-thread', 'v3')), /nearest enemy within 260 per jump/);
  assert.match(text(describe('gloam-thread', 'v3')), /50% damage \(90 per tick\)/);
  const links = text(describe('chain-strike', 'v1'));
  assert.match(links, /Copies 10% of subsequent primary damage to each linked target/);
  assert.match(links, /copies cannot chain again or trigger Astral charge gains/);
});

test('DoT refresh is scoped to existing effects and preserves their tick schedules', () => {
  assert.match(text(describe('chain-strike', 'v2')), /existing Lingering Glimmer and Lingering Touch on hit targets/);
  assert.doesNotMatch(text(describe('chain-strike', 'v2')), /every existing DoT on living/);
  for (const [id, talent] of [['chain-strike', 'v2'], ['destructive-rift', 'v3']]) {
    assert.match(text(describe(id, talent)), /to base duration; preserves tick schedules and causes no extra ticks/);
  }
});

test('output is immutable and independent of subsequent source or key changes', () => {
  const spell = compileAbility('veil-bolt');
  const first = describeAbility(spell, {key: 'Shift+Q'});
  const second = describeAbility(spell, {key: 'F'});
  assert.equal(first.key, 'Shift+Q');
  assert.equal(second.key, 'F');
  assert.equal(describeAbility(spell).key, '');
  assert.throws(() => first.facts.push('bad'), TypeError);
  assert.throws(() => { first.effects[0] = 'bad'; }, TypeError);
  spell.effects[0].amount = 777;
  assert.equal(first.effects[0], 'Deals 640 damage.');
  assert.equal(describeAbility(spell).effects[0], 'Deals 777 damage.');
});

test('custom compiled numbers and renamed references, rather than ability IDs or prose, drive the model', () => {
  const catalogue = structuredClone(CATALOGUE);
  catalogue.resource.max = 5;
  for (const ability of catalogue.abilities) {
    ability.id = `custom-${ability.id}`;
    ability.name = `Custom ${ability.name}`;
    ability.gcd = 1.4;
    for (const definition of [ability, ...ability.talents.map(talent => talent.patch)]) {
      if (definition.cost?.spend === 'all') definition.cost.amount = 5;
      for (const trigger of definition.triggers || []) for (const effect of trigger.effects) {
        if (effect.type === 'restoreCooldown') effect.abilityId = `custom-${effect.abilityId}`;
      }
      for (const effect of definition.effects || []) if (effect.type === 'dot') effect.name = `Custom ${effect.name}`;
    }
  }
  const heavy = catalogue.abilities[0].talents[0];
  heavy.patch.activation = {kind: 'cast', duration: 2.5, moving: true};
  heavy.patch.cooldown = 7;
  heavy.patch.effects[0].amount = 1234;
  heavy.patch.description = 'Deliberately uninformative supplementary prose.';
  assert.equal(validateCatalogue(catalogue).valid, true);
  const result = describe('custom-veil-bolt', 'v1', {catalogue});
  assert.equal(result.name, 'Custom Veil Bolt');
  assert.match(text(result), /2\.5s cast · usable while moving/);
  assert.match(text(result), /1\.4s global cooldown/);
  assert.match(text(result), /7s cooldown/);
  assert.match(text(result), /Deals 1,234 damage/);
  assert.doesNotMatch(text(result), /1,150|1\.5s cast/);
  assert.match(text(describe('custom-lingering-glimmer', 'v2', {catalogue})), /Custom Astral Flare's cooldown/);
  assert.match(text(describe('custom-chain-strike', 'v2', {catalogue})), /Custom Lingering Glimmer and Custom Lingering Touch/);
  assert.match(text(describe('custom-destructive-rift', 'v1', {catalogue})), /Astral charges \(1–5\)/);
  assert.match(text(describe('custom-destructive-rift', 'v1', {catalogue})), /150–750 damage/);
  assert.match(text(describe('custom-focused-energy', 'v3', {catalogue})), /shared cap: 5/);
});

test('generic effect metadata supports changed proc, gain, retention, targeting, and ramp values', () => {
  const proc = compileAbility('veil-bolt', 'v3');
  proc.triggers[0].chance = 0.375;
  proc.triggers[0].effects[0].amount = 2;
  assert.match(text(describeAbility(proc)), /37\.5% chance.*Generates 2 Astral charges/);
  const chaos = compileAbility('destructive-rift', 'v2');
  chaos.cost.retainedOutcomes = [1, 3];
  assert.match(text(describeAbility(chaos)), /refunds 1 or 3 Astral charges, each with a 50% chance/);
  const chain = compileAbility('gloam-thread', 'v3');
  chain.targeting.additional = 2;
  chain.targeting.jumpRange = 175;
  chain.targeting.range = 550;
  chain.targeting.secondaryMultiplier = 0.25;
  chain.effects[0].amount = 200;
  assert.match(text(describeAbility(chain)), /Up to 3 targets · 550 range · nearest enemy within 175 per jump/);
  assert.match(text(describeAbility(chain)), /25% damage \(50 per tick\)/);
  const ramp = compileAbility('gloam-thread', 'v1');
  ramp.activation.duration = 9;
  ramp.activation.interval = 0.5;
  ramp.effects[0].amount = 100;
  ramp.effects[0].rampPerTick = 0.1;
  assert.match(text(describeAbility(ramp)), /18 channel ticks, every 0\.5s: 100 to 270 \(10% of base added per tick\)/);
  assert.match(text(describeAbility(ramp)), /3,330 total/);
});
