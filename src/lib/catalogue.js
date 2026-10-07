/**
 * Canonical spell catalogue v1. Pure data; no embedded callbacks or executable text.
 * See docs/SPELL_SYSTEM.md for the authoring and deterministic timing contract.
 */
const FRAME = 1 / 60;
const MAX_SECONDS = 3600;
const MAX_DAMAGE = 1000000;
const SLUG = /^[a-z][a-z0-9-]{0,63}$/;
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const DEFINITION_KEYS = ['id', 'name', 'short', 'color', 'icon', 'description', 'activation', 'targeting', 'gcd', 'cooldown', 'charges', 'cost', 'effects', 'triggers', 'talents'];
const PATCH_KEYS = DEFINITION_KEYS.filter(key => !['id', 'talents'].includes(key));
const own = (value, key) => Object.hasOwn(value, key);
const display = value => typeof value === 'string' ? value : JSON.stringify(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const clone = value => Array.isArray(value) ? value.map(clone) : plain(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value;
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const activation = (kind, duration = 0, moving = kind === 'instant', interval) => ({kind, duration, moving, ...(interval === undefined ? {} : {interval})});
const single = {kind: 'single', range: 700};
const damage = amount => ({type: 'damage', amount});
const resource = {type: 'resource', amount: 1};
const proc = (event, chance, effects = [resource]) => ({event, chance, effects});
const dot = (id, name, duration, interval, amount, maintenance = false, carry = 0) => ({type: 'dot', id, name, duration, interval, amount, carry, maintenance});
const talent = (id, name, description, patch) => ({id, name, description, patch: {description, ...patch}});
const base = (definition) => ({gcd: 1.2, cooldown: 0, charges: 1, targeting: {...single}, effects: [], triggers: [], talents: [], ...definition});

export const SLOT_KEYS = freeze(['1', '2', '3', '4', '5']);
export const CATALOGUE = freeze({
  schemaVersion: 1,
  resource: {id: 'void', max: 3},
  abilities: [
    base({
      id: 'veil-bolt', name: 'Veil Bolt', short: 'Bolt', color: '#c4b5fd', icon: 'veil-bolt',
      description: 'A repeatable 1.5s stationary cast dealing 640 damage.',
      activation: activation('cast', 1.5, false), effects: [damage(640)],
      talents: [
        talent('v1', 'Heavy Veil', 'A 1.5s cast dealing 1,150 damage with a 6s cooldown.', {cooldown: 6, effects: [damage(1150)]}),
        talent('v2', 'Lingering Touch', 'Deals 640 damage, then 180 every 3s for 18s. Refreshing carries up to 30% of the base DoT duration.', {effects: [damage(640), dot('lingering-touch', 'Lingering Touch', 18, 3, 180, true, 0.3)]}),
        talent('v3', 'Charged Veil', 'The completed hit has a 20% chance to generate one Astral charge.', {triggers: [proc('hit', 0.2)]}),
      ],
    }),
    base({
      id: 'lingering-glimmer', name: 'Lingering Glimmer', short: 'Glimmer', color: '#dda7ff', icon: 'lingering-glimmer',
      description: 'Instantly applies a DoT: 240 every 3s for 18s. Refreshing carries up to 30% of its base duration; no damage on application.',
      activation: activation('instant'), effects: [dot('lingering-glimmer', 'Lingering Glimmer', 18, 3, 240, true, 0.3)],
      talents: [
        talent('v1', 'Lingering Resource', 'Remains an instant DoT. Each periodic tick has a 2% chance to generate one Astral charge.', {triggers: [proc('periodicTick', 0.02)]}),
        talent('v2', 'Astral Refresh', 'Casting this instant DoT has a 50% chance to reset Astral Flare, or restore exactly one stored spell charge.', {triggers: [proc('cast', 0.5, [{type: 'restoreCooldown', abilityId: 'astral-flare'}])]}),
        talent('v3', 'Linger Longer', 'The instant DoT lasts 36s with unchanged 240 damage per 3s tick. Refresh carry is capped at 30% of that base duration.', {effects: [dot('lingering-glimmer', 'Lingering Glimmer', 36, 3, 240, true, 0.3)]}),
      ],
    }),
    base({
      id: 'gloam-thread', name: 'Gloam Thread', short: 'Thread', color: '#8abbf4', icon: 'gloam-thread',
      description: 'A stationary 3s channel dealing four 180-damage ticks, one every 0.75s. Moving or another cast interrupts remaining ticks.',
      activation: activation('channel', 3, false, 0.75), effects: [damage(180)],
      talents: [
        talent('v1', 'Gathering Gloam', 'Four ticks ramp from 180 to 225, 270, then 315 damage. Completing the channel rewards the full ramp.', {effects: [{type: 'damage', amount: 180, rampPerTick: 0.25}]}),
        talent('v2', 'Full Conduit', 'Completing the entire channel guarantees one Astral charge. Clipped or interrupted channels generate none.', {triggers: [proc('complete', 1)]}),
        talent('v3', 'Twin Threads', 'Each channel tick also hits the nearest enemy within 260 of the primary target for 50% damage.', {targeting: {kind: 'chain', additional: 1, jumpRange: 260, secondaryMultiplier: 0.5}}),
      ],
    }),
    base({
      id: 'astral-flare', name: 'Astral Flare', short: 'Flare', color: '#ffd0a6', icon: 'astral-flare',
      description: 'An instant 900-damage hit with an 8s cooldown. Usable while moving.',
      activation: activation('instant'), cooldown: 8, effects: [damage(900)],
      talents: [
        talent('v1', 'Astral Builder', 'Each completed hit has a 50% chance to generate one Astral charge.', {triggers: [proc('hit', 0.5)]}),
        talent('v2', 'Drifting Flare', 'A repeatable 1s cast usable while moving, dealing 520 damage with no cooldown.', {activation: activation('cast', 1, true), cooldown: 0, effects: [damage(520)]}),
        talent('v3', 'Stored Starlight', 'Stores three spell charges for instant hits. Each spent spell charge recharges serially over 10s; stored spell charges do not expire.', {charges: 3, cooldown: 10}),
      ],
    }),
    base({
      id: 'destructive-rift', name: 'Destructive Rift', short: 'Rift', color: '#e4cb8c', icon: 'destructive-rift',
      description: 'A stationary 1.5s cast spending three Astral charges for 2,400 damage.',
      activation: activation('cast', 1.5, false), cost: {min: 3, amount: 3, spend: 'fixed'}, effects: [damage(2400)],
      talents: [
        talent('v1', 'Devouring Rift', 'Instantly spends all current Astral charges (one to three). Applies only a 6s DoT, dealing 150 damage per consumed Astral charge each second.', {activation: activation('instant'), cost: {min: 1, amount: 3, spend: 'all'}, effects: [{...dot('devouring-rift', 'Devouring Rift', 6, 1, 150), perResource: true}]}),
        talent('v2', 'Chaos Rift', 'Requires three Astral charges. One successful-resolution roll leaves zero, one, two, or three of the spent Astral charges, each with a 25% chance.', {cost: {retainedOutcomes: [0, 1, 2, 3]}}),
        talent('v3', 'Refreshing Rift', 'After its damage, resets every cooldown, fully restores stored spell charges, and refreshes every existing DoT on living targets without extra ticks.', {effects: [damage(2400), {type: 'resetCooldowns'}, {type: 'refreshDots'}]}),
      ],
    }),
    base({
      id: 'area-pulse', name: 'Area Pulse', short: 'Pulse', color: '#bc9dff', icon: 'area-pulse',
      description: 'An instant DoT in a 220-radius area around the target: 180 every 2s for 12s, with a 30s cooldown.',
      activation: activation('instant'), targeting: {kind: 'area', range: 700, radius: 220}, cooldown: 30,
      effects: [dot('area-pulse', 'Area Pulse', 12, 2, 180)],
      talents: [
        talent('v1', 'Falling Night', 'A stationary 2s cast dealing 700 damage in the area and applying the normal 12s DoT. Keeps the 30s cooldown.', {activation: activation('cast', 2, false), effects: [damage(700), dot('area-pulse', 'Area Pulse', 12, 2, 180)]}),
        talent('v2', 'Gloam Storm', 'A stationary 4s area channel: eight 450-damage ticks, one every 0.5s. Replaces the lingering DoT and keeps the 30s cooldown.', {activation: activation('channel', 4, false, 0.5), effects: [damage(450)]}),
        talent('v3', 'Compressed Pulses', 'Three stored spell charges for instant 650-damage hits in a smaller 140-radius area. Each spent spell charge recharges serially over 10s.', {targeting: {radius: 140}, charges: 3, cooldown: 10, effects: [damage(650)]}),
      ],
    }),
    base({
      id: 'chain-strike', name: 'Chain Strike', short: 'Chain', color: '#a1dfdf', icon: 'chain-strike',
      description: 'A stationary 1.5s cast dealing 520 damage to its primary target and up to three additional enemies, chaining within 260 per jump.',
      activation: activation('cast', 1.5, false), targeting: {kind: 'chain', range: 700, additional: 3, jumpRange: 260, secondaryMultiplier: 1}, effects: [damage(520)],
      talents: [
        talent('v1', 'Binding Chains', 'Links the primary target to bounced targets for 10s. Copies 10% of subsequent primary damage to each linked target, without recursive copies or Astral charge generation.', {effects: [damage(520), {type: 'link', duration: 10, fraction: 0.1}]}),
        talent('v2', 'Lingering Chains', 'Deals 240 damage per hit with a 10s cooldown and refreshes only existing Lingering Glimmer and Lingering Touch on the hit targets.', {cooldown: 10, effects: [damage(240), {type: 'refreshDots', ids: ['lingering-glimmer', 'lingering-touch']}]}),
        talent('v3', 'Charged Chains', 'Each completed target hit independently has a 10% chance to generate one Astral charge.', {triggers: [proc('hit', 0.1)]}),
      ],
    }),
    base({
      id: 'focused-energy', name: 'Focused Energy', short: 'Focus', color: '#a8e3b7', icon: 'focused-energy',
      description: 'An instant self-buff lasting 15s: reduces cast time and GCD by 10%. Has a 120s cooldown; does not speed channels or DoT ticks.',
      activation: activation('instant'), targeting: {kind: 'self', range: 0}, cooldown: 120,
      effects: [{type: 'buff', id: 'focused-energy', duration: 15, modifiers: {castTime: 0.9, gcd: 0.9}}],
      talents: [
        talent('v1', 'Deeper Focus', 'The 15s self-buff reduces cast time and GCD by 20%. Keeps the 120s cooldown.', {effects: [{type: 'buff', id: 'focused-energy', duration: 15, modifiers: {castTime: 0.8, gcd: 0.8}}]}),
        talent('v2', 'Frequent Focus', 'The normal 15s, 10% cast/GCD self-buff is available every 60s.', {cooldown: 60}),
        talent('v3', 'Abundant Focus', 'The normal 15s, 10% cast/GCD self-buff also doubles each successful Astral charge gain, subject to the three-charge cap.', {effects: [{type: 'buff', id: 'focused-energy', duration: 15, modifiers: {castTime: 0.9, gcd: 0.9, resourceGain: 2}}]}),
      ],
    }),
  ],
});
export const ABILITIES = CATALOGUE.abilities;
export const DEFAULT_LOADOUT = freeze({abilities: ['veil-bolt', 'lingering-glimmer', 'gloam-thread', 'astral-flare', 'area-pulse'], talents: {}});

/** Reject non-JSON objects before inspecting or merging data. Never invoke getters. */
function inspectData(value, errors, path = 'catalogue') {
  const seen = new Set();
  let budget = 100000;
  function visit(item, at, depth) {
    if (--budget < 0) { if (budget === -1) errors.push(`${at}: data exceeds the node limit`); return; }
    if (depth > 20) { errors.push(`${at}: data exceeds the depth limit`); return; }
    if (item === null || typeof item === 'boolean' || typeof item === 'string') {
      if (typeof item === 'string' && item.length > 4000) errors.push(`${at}: string exceeds 4000 characters`);
      return;
    }
    if (typeof item === 'number') { if (!Number.isFinite(item)) errors.push(`${at}: must be finite`); return; }
    if (typeof item !== 'object') { errors.push(`${at}: must contain only JSON data`); return; }
    if ((!Array.isArray(item) && !plain(item)) || (Array.isArray(item) && Object.getPrototypeOf(item) !== Array.prototype)) { errors.push(`${at}: inherited or custom-prototype data is not allowed`); return; }
    if (seen.has(item)) { errors.push(`${at}: cyclic data is not allowed`); return; }
    seen.add(item);
    const keys = Reflect.ownKeys(item);
    if (keys.length > 1000) { errors.push(`${at}: object exceeds 1000 keys`); seen.delete(item); return; }
    if (Array.isArray(item) && item.length > 256) { errors.push(`${at}: array exceeds 256 entries`); seen.delete(item); return; }
    for (const key of keys) {
      if (Array.isArray(item) && key === 'length') continue;
      if (typeof key !== 'string' || FORBIDDEN.has(key)) { errors.push(`${at}: forbidden property ${String(key)}`); continue; }
      if (Array.isArray(item) && !/^(0|[1-9][0-9]*)$/.test(key)) { errors.push(`${at}: arrays cannot have named properties`); continue; }
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !own(descriptor, 'value') || !descriptor.enumerable) { errors.push(`${at}.${key}: accessors and hidden properties are not allowed`); continue; }
      visit(descriptor.value, `${at}.${key}`, depth + 1);
    }
    if (Array.isArray(item) && Object.keys(item).length !== item.length) errors.push(`${at}: sparse arrays are not allowed`);
    seen.delete(item);
  }
  try { visit(value, path, 0); } catch { errors.push(`${path}: cannot inspect data safely`); }
}

function shape(value, allowed, required, errors, path) {
  if (!plain(value)) { errors.push(`${path}: expected an object`); return false; }
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${path}.${key}: unknown field`);
  for (const key of required) if (!own(value, key)) errors.push(`${path}.${key}: required`);
  return true;
}
function number(value, min, max, errors, path, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) errors.push(`${path}: expected ${integer ? 'an integer' : 'a finite number'} from ${min} to ${max}`);
}
function string(value, errors, path, max = 2000, slug = false) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || (slug && (!SLUG.test(value) || FORBIDDEN.has(value)))) errors.push(`${path}: expected ${slug ? 'a lowercase slug' : 'nonempty text'} of at most ${max} characters`);
}
function bool(value, errors, path) { if (typeof value !== 'boolean') errors.push(`${path}: expected a boolean`); }
function choice(value, choices, errors, path) { if (!choices.includes(value)) errors.push(`${path}: expected ${choices.join(', ')}`); }
function array(value, min, max, errors, path) {
  if (!Array.isArray(value) || value.length < min || value.length > max) { errors.push(`${path}: expected ${min}–${max} entries`); return false; }
  return true;
}
function effectsValidate(effects, definition, resourceMax, errors, path) {
  if (!array(effects, 1, 32, errors, path)) return;
  effects.forEach((effect, index) => {
    const at = `${path}[${index}]`;
    if (!plain(effect)) { errors.push(`${at}: expected an effect object`); return; }
    switch (effect.type) {
      case 'damage':
        shape(effect, ['type', 'amount', 'perResource', 'rampPerTick'], ['type', 'amount'], errors, at);
        number(effect.amount, 0, MAX_DAMAGE, errors, `${at}.amount`);
        if (own(effect, 'rampPerTick')) {
          number(effect.rampPerTick, 0, 100, errors, `${at}.rampPerTick`);
          if (definition.activation?.kind !== 'channel') errors.push(`${at}.rampPerTick: requires a channel`);
        }
        break;
      case 'dot':
        shape(effect, ['type', 'id', 'name', 'duration', 'interval', 'amount', 'carry', 'maintenance', 'perResource'], ['type', 'id', 'name', 'duration', 'interval', 'amount', 'carry', 'maintenance'], errors, at);
        string(effect.id, errors, `${at}.id`, 64, true); string(effect.name, errors, `${at}.name`, 100);
        number(effect.duration, FRAME, MAX_SECONDS, errors, `${at}.duration`); number(effect.interval, FRAME, MAX_SECONDS, errors, `${at}.interval`);
        if (effect.interval > effect.duration) errors.push(`${at}.interval: cannot exceed duration`);
        number(effect.amount, 0, MAX_DAMAGE, errors, `${at}.amount`); number(effect.carry, 0, 1, errors, `${at}.carry`); bool(effect.maintenance, errors, `${at}.maintenance`);
        break;
      case 'buff':
        shape(effect, ['type', 'id', 'duration', 'modifiers'], ['type', 'id', 'duration', 'modifiers'], errors, at);
        string(effect.id, errors, `${at}.id`, 64, true); number(effect.duration, FRAME, MAX_SECONDS, errors, `${at}.duration`);
        if (shape(effect.modifiers, ['castTime', 'gcd', 'resourceGain'], [], errors, `${at}.modifiers`)) {
          if (!Object.keys(effect.modifiers).length) errors.push(`${at}.modifiers: at least one modifier is required`);
          for (const [key, value] of Object.entries(effect.modifiers)) if (!Number.isFinite(value) || value <= 0) errors.push(`${at}.modifiers.${key}: expected a finite, strictly positive multiplier`);
        }
        break;
      case 'link':
        shape(effect, ['type', 'duration', 'fraction'], ['type', 'duration', 'fraction'], errors, at);
        number(effect.duration, FRAME, MAX_SECONDS, errors, `${at}.duration`); number(effect.fraction, 0, 1, errors, `${at}.fraction`);
        if (definition.targeting?.kind !== 'chain') errors.push(`${at}: links require chain targeting`);
        break;
      case 'refreshDots':
        shape(effect, ['type', 'ids'], ['type'], errors, at);
        if (own(effect, 'ids') && array(effect.ids, 1, 32, errors, `${at}.ids`)) {
          effect.ids.forEach((id, i) => string(id, errors, `${at}.ids[${i}]`, 64, true));
          if (new Set(effect.ids).size !== effect.ids.length) errors.push(`${at}.ids: duplicate dot ids`);
        }
        break;
      case 'resetCooldowns': shape(effect, ['type'], ['type'], errors, at); break;
      case 'restoreCooldown':
        shape(effect, ['type', 'abilityId'], ['type', 'abilityId'], errors, at); string(effect.abilityId, errors, `${at}.abilityId`, 64, true); break;
      case 'resource':
        shape(effect, ['type', 'amount'], ['type', 'amount'], errors, at); number(effect.amount, 1, resourceMax, errors, `${at}.amount`, true); break;
      default: errors.push(`${at}.type: unknown effect type`);
    }
    if (own(effect, 'perResource')) {
      bool(effect.perResource, errors, `${at}.perResource`);
      if (effect.perResource && !definition.cost) errors.push(`${at}.perResource: requires an ability cost`);
    }
  });
}

function definitionValidate(definition, resourceMax, errors, path) {
  if (!shape(definition, DEFINITION_KEYS, DEFINITION_KEYS.filter(key => key !== 'cost'), errors, path)) return;
  for (const key of ['id', 'icon']) string(definition[key], errors, `${path}.${key}`, 64, true);
  for (const key of ['name', 'short']) string(definition[key], errors, `${path}.${key}`, 100);
  string(definition.description, errors, `${path}.description`);
  if (typeof definition.color !== 'string' || !/^#[\da-f]{6}$/i.test(definition.color)) errors.push(`${path}.color: expected a six-digit hex color`);
  const act = definition.activation;
  if (shape(act, ['kind', 'duration', 'moving', 'interval'], ['kind', 'duration', 'moving'], errors, `${path}.activation`)) {
    choice(act.kind, ['instant', 'cast', 'channel'], errors, `${path}.activation.kind`); bool(act.moving, errors, `${path}.activation.moving`);
    number(act.duration, act.kind === 'instant' ? 0 : FRAME, act.kind === 'instant' ? 0 : MAX_SECONDS, errors, `${path}.activation.duration`);
    if (act.kind === 'channel') {
      number(act.interval, FRAME, MAX_SECONDS, errors, `${path}.activation.interval`);
      if (act.interval > act.duration) errors.push(`${path}.activation.interval: cannot exceed duration`);
      const count = act.duration / act.interval;
      if (Number.isFinite(count) && Math.abs(count - Math.round(count)) > 1e-8) errors.push(`${path}.activation: duration must contain a whole number of channel ticks`);
      const durationTicks = Math.round(act.duration * 60), intervalTicks = Math.round(act.interval * 60);
      if (intervalTicks > 0 && (durationTicks % intervalTicks !== 0 || Math.abs(durationTicks / intervalTicks - count) > 1e-8)) errors.push(`${path}.activation: rounded 60 Hz timing must preserve the whole number of channel ticks`);
      if (count > 4096) errors.push(`${path}.activation: at most 4096 channel ticks are allowed`);
    } else if (own(act, 'interval')) errors.push(`${path}.activation.interval: only channels have intervals`);
  }
  const target = definition.targeting;
  if (shape(target, ['kind', 'range', 'radius', 'additional', 'jumpRange', 'secondaryMultiplier'], ['kind', 'range'], errors, `${path}.targeting`)) {
    choice(target.kind, ['single', 'area', 'chain', 'self'], errors, `${path}.targeting.kind`);
    number(target.range, target.kind === 'self' ? 0 : FRAME, 10000, errors, `${path}.targeting.range`);
    if (target.kind === 'area') number(target.radius, FRAME, 10000, errors, `${path}.targeting.radius`);
    else if (own(target, 'radius')) errors.push(`${path}.targeting.radius: requires area targeting`);
    if (target.kind === 'chain') { number(target.additional, 1, 32, errors, `${path}.targeting.additional`, true); number(target.jumpRange, FRAME, 10000, errors, `${path}.targeting.jumpRange`); }
    else for (const key of ['additional', 'jumpRange']) if (own(target, key)) errors.push(`${path}.targeting.${key}: requires chain targeting`);
    if (own(target, 'secondaryMultiplier')) {
      number(target.secondaryMultiplier, 0, 1, errors, `${path}.targeting.secondaryMultiplier`);
      if (!['area', 'chain'].includes(target.kind)) errors.push(`${path}.targeting.secondaryMultiplier: requires area or chain targeting`);
    }
  }
  number(definition.gcd, FRAME, MAX_SECONDS, errors, `${path}.gcd`); number(definition.cooldown, 0, MAX_SECONDS, errors, `${path}.cooldown`); number(definition.charges, 1, 10, errors, `${path}.charges`, true);
  if (definition.charges > 1 && definition.cooldown <= 0) errors.push(`${path}.cooldown: stored charges require a positive cooldown`);
  if (definition.cooldown > 0 && definition.cooldown < FRAME) errors.push(`${path}.cooldown: positive cooldowns must last at least one simulation tick`);
  if (own(definition, 'cost') && shape(definition.cost, ['min', 'amount', 'spend', 'retainedOutcomes'], ['min', 'amount', 'spend'], errors, `${path}.cost`)) {
    const cost = definition.cost;
    number(cost.min, 1, resourceMax, errors, `${path}.cost.min`, true); number(cost.amount, 1, resourceMax, errors, `${path}.cost.amount`, true); choice(cost.spend, ['fixed', 'all'], errors, `${path}.cost.spend`);
    if (cost.min > cost.amount) errors.push(`${path}.cost.min: cannot exceed amount`);
    if (cost.spend === 'fixed' && cost.min !== cost.amount) errors.push(`${path}.cost: fixed costs require min equal to amount`);
    if (cost.spend === 'all' && cost.amount !== resourceMax) errors.push(`${path}.cost.amount: all-resource costs must equal the resource maximum`);
    if (own(cost, 'retainedOutcomes') && array(cost.retainedOutcomes, 1, 32, errors, `${path}.cost.retainedOutcomes`)) {
      cost.retainedOutcomes.forEach((value, i) => number(value, 0, cost.amount, errors, `${path}.cost.retainedOutcomes[${i}]`, true));
      if (cost.spend !== 'fixed') errors.push(`${path}.cost.retainedOutcomes: require a fixed cost`);
      if (new Set(cost.retainedOutcomes).size !== cost.retainedOutcomes.length) errors.push(`${path}.cost.retainedOutcomes: outcomes must be distinct and equally likely`);
    }
  }
  effectsValidate(definition.effects, definition, resourceMax, errors, `${path}.effects`);
  if (array(definition.triggers, 0, 16, errors, `${path}.triggers`)) definition.triggers.forEach((trigger, index) => {
    const at = `${path}.triggers[${index}]`;
    if (!shape(trigger, ['event', 'chance', 'effects'], ['event', 'chance', 'effects'], errors, at)) return;
    choice(trigger.event, ['cast', 'complete', 'periodicTick', 'hit'], errors, `${at}.event`); number(trigger.chance, 0, 1, errors, `${at}.chance`);
    if (trigger.event === 'periodicTick' && !(Array.isArray(definition.effects) && definition.effects.some(effect => effect?.type === 'dot'))) errors.push(`${at}.event: periodicTick requires a DoT on this ability`);
    effectsValidate(trigger.effects, definition, resourceMax, errors, `${at}.effects`);
  });
}

/** Plain-object recursive merge, array replacement. Called only after the data guard. */
function merge(baseValue, patch) {
  const result = clone(baseValue);
  for (const [key, value] of Object.entries(patch)) result[key] = plain(value) && plain(result[key]) ? merge(result[key], value) : clone(value);
  return result;
}
const everyEffect = definition => [...(definition.effects || []), ...(definition.triggers || []).flatMap(trigger => trigger.effects || [])];

export function validateCatalogue(catalogue) {
  const errors = [];
  inspectData(catalogue, errors);
  if (errors.length) return {valid: false, errors};
  if (!shape(catalogue, ['schemaVersion', 'resource', 'abilities'], ['schemaVersion', 'resource', 'abilities'], errors, 'catalogue')) return {valid: false, errors};
  if (catalogue.schemaVersion !== 1) errors.push('catalogue.schemaVersion: only version 1 is supported');
  if (shape(catalogue.resource, ['id', 'max'], ['id', 'max'], errors, 'catalogue.resource')) {
    string(catalogue.resource.id, errors, 'catalogue.resource.id', 64, true); number(catalogue.resource.max, 1, 100, errors, 'catalogue.resource.max', true);
  }
  if (!array(catalogue.abilities, 1, 128, errors, 'catalogue.abilities')) return {valid: false, errors};
  const ids = new Set();
  const variants = [];
  catalogue.abilities.forEach((definition, index) => {
    const at = `catalogue.abilities[${index}]`;
    definitionValidate(definition, catalogue.resource?.max ?? 3, errors, at);
    if (!plain(definition)) return;
    if (ids.has(definition.id)) errors.push(`${at}.id: duplicate ability id`);
    ids.add(definition.id); variants.push({definition, path: at});
    if (!array(definition.talents, 0, 16, errors, `${at}.talents`)) return;
    const talentIds = new Set();
    definition.talents.forEach((variant, ti) => {
      const tat = `${at}.talents[${ti}]`;
      if (!shape(variant, ['id', 'name', 'description', 'patch'], ['id', 'name', 'description', 'patch'], errors, tat)) return;
      string(variant.id, errors, `${tat}.id`, 64, true); string(variant.name, errors, `${tat}.name`, 100); string(variant.description, errors, `${tat}.description`);
      if (variant.id === 'base') errors.push(`${tat}.id: base is reserved`);
      if (talentIds.has(variant.id)) errors.push(`${tat}.id: duplicate talent id`);
      talentIds.add(variant.id);
      if (shape(variant.patch, PATCH_KEYS, [], errors, `${tat}.patch`)) {
        const composed = merge(definition, variant.patch);
        definitionValidate(composed, catalogue.resource?.max ?? 3, errors, `${tat}.compiled`);
        variants.push({definition: composed, path: `${tat}.compiled`});
      }
    });
  });
  // Invalid shapes need not be dereferenced during cross-reference validation.
  if (errors.length) return {valid: false, errors};
  // Buff IDs are unique runtime slots: alternative definitions of one buff never
  // stack with themselves. Treat different buff IDs conservatively as concurrent.
  const buffBounds = new Map();
  for (const {definition} of variants) for (const effect of everyEffect(definition)) if (effect.type === 'buff') {
    const bounds = buffBounds.get(effect.id) ?? {castMin: 1, castMax: 1, gcdMin: 1, gcdMax: 1, gainMax: 1};
    for (const [field, prefix] of [['castTime', 'cast'], ['gcd', 'gcd']]) {
      bounds[`${prefix}Min`] = Math.min(bounds[`${prefix}Min`], effect.modifiers[field] ?? 1);
      bounds[`${prefix}Max`] = Math.max(bounds[`${prefix}Max`], effect.modifiers[field] ?? 1);
    }
    bounds.gainMax = Math.max(bounds.gainMax, effect.modifiers.resourceGain ?? 1);
    buffBounds.set(effect.id, bounds);
  }
  const factor = key => [...buffBounds.values()].reduce((product, bounds) => product * bounds[key], 1);
  const castMin = factor('castMin'), castMax = factor('castMax'), gcdMin = factor('gcdMin'), gcdMax = factor('gcdMax'), gainMax = factor('gainMax');
  if (!Number.isFinite(gainMax)) errors.push('catalogue: combined resourceGain modifiers must remain finite');
  for (const {definition, path} of variants) {
    for (const effect of everyEffect(definition)) if (effect.type === 'resource' && !Number.isFinite(effect.amount * gainMax)) errors.push(`${path}: effective resource gain must remain finite`);
    if (definition.gcd * gcdMin < FRAME - 1e-12 || !Number.isFinite(definition.gcd * gcdMax)) errors.push(`${path}.gcd: effective GCD under possible buffs must be finite and at least one simulation tick`);
    if (definition.activation.kind === 'cast' && (definition.activation.duration * castMin < FRAME - 1e-12 || !Number.isFinite(definition.activation.duration * castMax))) errors.push(`${path}.activation.duration: effective cast duration under possible buffs must be finite and at least one simulation tick`);
  }
  const dotIds = new Set(variants.flatMap(item => everyEffect(item.definition).filter(effect => effect.type === 'dot').map(effect => effect.id)));
  for (const {definition, path} of variants) for (const effect of everyEffect(definition)) {
    if (effect.type === 'restoreCooldown' && !ids.has(effect.abilityId)) errors.push(`${path}: restoreCooldown references unknown ability ${effect.abilityId}`);
    if (effect.type === 'refreshDots' && effect.ids) for (const id of effect.ids) if (!dotIds.has(id)) errors.push(`${path}: refreshDots references unknown DoT ${id}`);
  }
  return {valid: errors.length === 0, errors};
}

function compiled(definition, talentId) {
  const chosen = talentId && talentId !== 'base' ? definition.talents.find(item => item.id === talentId) : null;
  const result = chosen ? merge(definition, chosen.patch) : clone(definition);
  const act = result.activation;
  const kind = act.kind === 'instant' ? 'Instant' : `${act.duration}s ${act.kind}`;
  const parts = [kind];
  if (act.kind === 'cast' && act.moving) parts.push('mobile');
  if (result.charges > 1) parts.push(`${result.charges} stored spell charges · ${result.cooldown}s recharge`);
  else if (result.cooldown) parts.push(`${result.cooldown}s cooldown`);
  if (result.targeting.kind === 'self') parts.push('self-buff');
  else if (result.targeting.kind === 'area') parts.push('area');
  else if (result.targeting.kind === 'chain') parts.push('chain');
  if (result.effects.some(effect => effect.type === 'dot')) parts.push('DoT');
  return {...result, detail: result.description, type: parts.join(' · '), talentId: chosen?.id ?? null, talentName: chosen?.name ?? 'Base'};
}

export function compileAbility(id, talentId = null, catalogue = CATALOGUE) {
  if (typeof id !== 'string') throw new TypeError('Ability id must be a string');
  if (talentId !== null && talentId !== undefined && typeof talentId !== 'string') throw new TypeError('Talent id must be a string or null');
  const check = validateCatalogue(catalogue);
  if (!check.valid) throw new TypeError(`Invalid catalogue: ${check.errors.join('; ')}`);
  const definition = catalogue.abilities.find(ability => ability.id === id);
  if (!definition) throw new RangeError(`Unknown ability: ${display(id)}`);
  if (talentId !== null && talentId !== undefined && talentId !== 'base' && !definition.talents.some(talent => talent.id === talentId)) throw new RangeError(`Unknown talent ${display(talentId)} for ${id}`);
  return compiled(definition, talentId);
}

export function validateLoadout(loadout, catalogue = CATALOGUE) {
  const check = validateCatalogue(catalogue);
  const errors = [...check.errors];
  const warnings = [];
  inspectData(loadout, errors, 'loadout');
  if (errors.length) return {valid: false, errors, warnings};
  if (!shape(loadout, ['abilities', 'talents'], ['abilities'], errors, 'loadout')) return {valid: false, errors, warnings};
  if (!array(loadout.abilities, 1, SLOT_KEYS.length, errors, 'loadout.abilities')) return {valid: false, errors, warnings};
  if (new Set(loadout.abilities).size !== loadout.abilities.length) errors.push('loadout.abilities: each ability may be selected only once');
  const byId = new Map(catalogue.abilities.map(ability => [ability.id, ability]));
  for (const id of loadout.abilities) if (!byId.has(id)) errors.push(`loadout.abilities: unknown ability ${display(id)}`);
  const talents = own(loadout, 'talents') ? loadout.talents : {};
  if (!plain(talents)) errors.push('loadout.talents: expected an object');
  else for (const [id, talentId] of Object.entries(talents)) {
    if (!loadout.abilities.includes(id)) errors.push(`loadout.talents.${id}: talent belongs to an unselected ability`);
    if (talentId !== null && talentId !== 'base' && !byId.get(id)?.talents.some(talent => talent.id === talentId)) errors.push(`loadout.talents.${id}: unknown talent ${display(talentId)}`);
  }
  if (errors.length) return {valid: false, errors, warnings};
  const selection = loadout.abilities.map(id => compiled(byId.get(id), talents[id]));
  const hasGenerator = selection.some(ability => everyEffect(ability).some(effect => effect.type === 'resource'));
  const hasSpender = selection.some(ability => ability.cost);
  if (hasSpender && !hasGenerator) warnings.push('This loadout spends Astral charges but has no Astral charge generator; the spender cannot be used from the normal zero-charge start.');
  if (hasGenerator && !hasSpender) warnings.push('This loadout generates Astral charges but has no spender; gains at the Astral charge cap will overflow.');
  for (const ability of selection) for (const effect of everyEffect(ability)) if (effect.type === 'restoreCooldown' && !loadout.abilities.includes(effect.abilityId)) warnings.push(`${ability.name} can restore ${effect.abilityId}, which is not selected.`);
  return {valid: true, errors: [], warnings: [...new Set(warnings)]};
}

export function compileLoadout(loadout, catalogue = CATALOGUE) {
  const check = validateLoadout(loadout, catalogue);
  if (!check.valid) throw new TypeError(`Invalid loadout: ${check.errors.join('; ')}`);
  return loadout.abilities.map((id, index) => ({...compiled(catalogue.abilities.find(ability => ability.id === id), loadout.talents?.[id]), key: SLOT_KEYS[index], index}));
}
