import {CATALOGUE} from './catalogue.js';
import {HZ} from './engine.js';

const numbers = new Intl.NumberFormat('en-US', {maximumFractionDigits: 3});
const number = value => numbers.format(value);
const seconds = value => `${number(value)}s`;
const percent = value => `${number(value * 100)}%`;
const charges = amount => `${number(amount)} Astral charge${amount === 1 ? '' : 's'}`;
const list = values => values.length < 3 ? values.join(' or ') : `${values.slice(0, -1).join(', ')}, or ${values.at(-1)}`;
const range = (min, max) => min === max ? number(min) : `${number(min)}–${number(max)}`;

function referenceNames(catalogue, spell) {
  const abilities = new Map(catalogue.abilities.map(ability => [ability.id, ability.name]));
  const dots = new Map();
  for (const definition of [...catalogue.abilities.flatMap(ability => [ability, ...ability.talents.map(talent => talent.patch)]), spell]) {
    for (const effect of [...(definition.effects || []), ...(definition.triggers || []).flatMap(trigger => trigger.effects)]) {
      if (effect.type === 'dot') dots.set(effect.id, effect.name);
    }
  }
  abilities.set(spell.id, spell.name);
  return {abilities, dots};
}

function activationFact({activation}) {
  const label = activation.kind === 'instant' ? 'Instant' : `${seconds(activation.duration)} ${activation.kind}`;
  const moving = activation.kind === 'instant' || activation.moving;
  return `${label} · ${moving ? 'usable while moving' : 'stand still; movement interrupts'}${activation.kind === 'channel' ? '; another spell interrupts remaining ticks' : ''}`;
}

function targetingFact(target) {
  if (target.kind === 'self') return 'Self only';
  if (target.kind === 'area') return `Target-centered area · ${number(target.radius)} radius · ${number(target.range)} range`;
  if (target.kind === 'chain') return `Up to ${number(target.additional + 1)} targets · ${number(target.range)} range · nearest enemy within ${number(target.jumpRange)} per jump`;
  return `Single target · ${number(target.range)} range`;
}

function costFact(cost) {
  if (!cost) return 'No Astral charge cost';
  if (cost.spend === 'all') return `Spends all current Astral charges (${range(cost.min, cost.amount)}); requires at least ${charges(cost.min)}`;
  return `Requires and spends ${charges(cost.amount)}`;
}

function damageRange(effect, spell, amount = effect.amount) {
  return effect.perResource ? range(amount * spell.cost.min, amount * spell.cost.amount) : number(amount);
}

function targetSuffix(spell) {
  if (!['area', 'chain'].includes(spell.targeting.kind)) return '';
  return (spell.targeting.secondaryMultiplier ?? 1) === 1 ? ' to each target' : ' to the primary target';
}

function secondaryDamage(effect, spell, {perTick = false, ramp = false} = {}) {
  const multiplier = spell.targeting.secondaryMultiplier ?? 1;
  if (!['area', 'chain'].includes(spell.targeting.kind) || multiplier === 1) return '';
  return ` Secondary targets take ${percent(multiplier)} damage (${damageRange(effect, spell, effect.amount * multiplier)}${ramp ? ' on the first tick' : perTick ? ' per tick' : ''}).`;
}

function timingModifier(label, multiplier) {
  if (multiplier === 1) return `${label} unchanged`;
  return `${multiplier < 1 ? 'reduces' : 'increases'} ${label} by ${percent(Math.abs(1 - multiplier))}`;
}

/** Effect descriptions also serve trigger effects, whose timing is supplied by the trigger. */
function describeEffect(effect, context, periodic = false) {
  const {spell, catalogue, names} = context;
  const perCharge = effect.perResource ? ` (${number(effect.amount)} per Astral charge spent)` : '';
  switch (effect.type) {
    case 'damage': {
      if (periodic && spell.activation.kind === 'channel') {
        const count = Math.round(spell.activation.duration / spell.activation.interval);
        const ramp = effect.rampPerTick || 0;
        const total = effect.amount * (count + ramp * count * (count - 1) / 2);
        if (ramp) {
          const amounts = count <= 8
            ? Array.from({length: count}, (_, index) => damageRange(effect, spell, effect.amount * (1 + ramp * index))).join(' → ')
            : `${damageRange(effect, spell)} to ${damageRange(effect, spell, effect.amount * (1 + ramp * (count - 1)))} (${percent(ramp)} of base added per tick)`;
          return `${number(count)} channel ticks, every ${seconds(spell.activation.interval)}: ${amounts} damage${targetSuffix(spell)}${perCharge} (${damageRange(effect, spell, total)} total).${secondaryDamage(effect, spell, {perTick: true, ramp: true})}`;
        }
        return `${number(count)} channel ticks of ${damageRange(effect, spell)} damage${targetSuffix(spell)}${perCharge}, every ${seconds(spell.activation.interval)} (${damageRange(effect, spell, total)} total).${secondaryDamage(effect, spell, {perTick: true})}`;
      }
      return `Deals ${damageRange(effect, spell)} damage${targetSuffix(spell)}${perCharge}.${secondaryDamage(effect, spell)}`;
    }
    case 'dot': {
      const ticks = Math.floor(Math.round(effect.duration * HZ) / Math.round(effect.interval * HZ));
      const total = damageRange(effect, spell, effect.amount * ticks);
      const carry = effect.carry > 0 ? ` Refreshing preserves the next tick and carries up to ${seconds(effect.duration * effect.carry)} (${percent(effect.carry)} of base duration).` : '';
      return `${effect.name}: ${damageRange(effect, spell)} damage${targetSuffix(spell)} every ${seconds(effect.interval)} for ${seconds(effect.duration)}${perCharge} (${number(ticks)} ticks; ${total} total on a fresh application).${secondaryDamage(effect, spell, {perTick: true})}${carry}`;
    }
    case 'buff': {
      const {castTime, gcd, resourceGain} = effect.modifiers;
      const changes = [];
      if (castTime !== undefined && gcd === castTime) changes.push(timingModifier('cast time and GCD', castTime));
      else {
        if (castTime !== undefined) changes.push(timingModifier('cast time', castTime));
        if (gcd !== undefined) changes.push(timingModifier('GCD', gcd));
      }
      if (resourceGain !== undefined) changes.push(`multiplies successful Astral charge gains by ${number(resourceGain)} (shared cap: ${number(catalogue.resource.max)}; refunds unchanged)`);
      return `For ${seconds(effect.duration)}, ${changes.join('; ')}. Channels and DoT tick timing are unchanged.`;
    }
    case 'resource': return `Generates ${charges(effect.amount)} (shared cap: ${number(catalogue.resource.max)}).`;
    case 'restoreCooldown':
      return `Resets ${names.abilities.get(effect.abilityId) || effect.abilityId}'s cooldown, or restores exactly 1 stored spell charge for a charge-based variant (if equipped).`;
    case 'resetCooldowns': return 'Resets all equipped spell cooldowns and fully restores all stored spell charges.';
    case 'refreshDots': {
      const subject = effect.ids
        ? `existing ${effect.ids.map(id => names.dots.get(id) || id).join(' and ')} on hit targets`
        : 'every existing DoT on living targets';
      return `Refreshes ${subject} to base duration; preserves tick schedules and causes no extra ticks.`;
    }
    case 'link':
      return `Links chained targets to the primary for ${seconds(effect.duration)}. Copies ${percent(effect.fraction)} of subsequent primary damage to each linked target; copies cannot chain again or trigger Astral charge gains.`;
    default: throw new RangeError(`Unknown effect type: ${effect.type}`);
  }
}

function describeTrigger(trigger, context) {
  const channel = context.spell.activation.kind === 'channel';
  const event = {
    cast: 'On cast',
    complete: channel ? 'On full channel completion' : 'On successful completion',
    periodicTick: 'Each damaging DoT tick independently',
    hit: channel ? 'Each channel tick on each target independently' : 'Each completed target hit independently',
  }[trigger.event];
  const effects = trigger.effects.map(effect => describeEffect(effect, context)).join(' ');
  const chance = trigger.chance === 1 ? 'guaranteed' : `${percent(trigger.chance)} chance`;
  return `${event} (${chance}): ${effects}${trigger.event === 'complete' && channel ? ' Requires the full channel; interrupted channels earn no completion reward.' : ''}`;
}

/**
 * Static tooltip copy from the actual compiled selection. Values are unbuffed;
 * live cooldowns and current resource counts belong to the combat HUD.
 * No ability ID selects behavior. References resolve through the given catalogue.
 */
export function describeAbility(spell, {catalogue = CATALOGUE, key = ''} = {}) {
  const context = {spell, catalogue, names: referenceNames(catalogue, spell)};
  const facts = [
    activationFact(spell),
    `${seconds(spell.gcd)} global cooldown (GCD)`,
    spell.charges > 1
      ? `${number(spell.charges)} stored spell charges · ${seconds(spell.cooldown)} recharge each, one at a time · no expiry`
      : spell.cooldown > 0 ? `${seconds(spell.cooldown)} cooldown` : 'No spell cooldown',
    costFact(spell.cost),
    targetingFact(spell.targeting),
  ];
  const effects = spell.effects.map(effect => describeEffect(effect, context, true));
  if (spell.effects.some(effect => effect.type === 'dot') && !spell.effects.some(effect => effect.type === 'damage')) effects.push('No direct damage on application.');
  if (spell.cost?.retainedOutcomes) {
    const outcomes = spell.cost.retainedOutcomes;
    effects.push(`After successful resolution, refunds ${list(outcomes.map(number))} Astral charges, each with a ${percent(1 / outcomes.length)} chance. One roll per cast; refunds are unaffected by gain buffs.`);
  }
  effects.push(...spell.triggers.map(trigger => describeTrigger(trigger, context)));
  return Object.freeze({
    name: spell.name,
    talentName: spell.talentId ? spell.talentName : '',
    talentDescription: spell.talentId ? spell.description : '',
    key,
    facts: Object.freeze(facts),
    effects: Object.freeze(effects),
  });
}
