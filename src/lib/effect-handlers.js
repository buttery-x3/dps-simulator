/** Bounded, reusable spell effects. Definitions contain data, never executable code.
 * A handler receives one action context; copied/refresh damage never dispatches triggers.
 */
export const EFFECT_HANDLERS = {
  damage(sim, effect, context) {
    for (const {target, multiplier} of context.victims) {
      const ramp = 1 + (effect.rampPerTick || 0) * Math.max(0, (context.tickIndex || 1) - 1);
      const amount = effect.amount * multiplier * ramp * (effect.perResource ? context.spent : 1);
      sim.damage(target, amount, context.spell.id);
    }
  },
  dot(sim, effect, context) {
    for (const {target, multiplier} of context.victims) {
      if (!sim.target(target.id)) continue;
      const previous = target.dots[effect.id];
      const duration = sim.toTicks(effect.duration);
      const carry = previous ? Math.min(sim.toTicks(effect.duration * effect.carry), Math.max(0, previous.expires - sim.tick)) : 0;
      target.dots[effect.id] = {
        ...effect, spellId: context.spell.id, spell: context.spell, spent: context.spent,
        amount: effect.amount * multiplier * (effect.perResource ? context.spent : 1),
        duration, interval: sim.toTicks(effect.interval),
        expires: sim.tick + duration + carry,
        nextTick: previous?.nextTick ?? sim.tick + sim.toTicks(effect.interval),
      };
    }
  },
  buff(sim, effect, context) {
    sim.buffs[effect.id] = {name: context.spell.name, spellId: context.spell.id,
      expires: sim.tick + sim.toTicks(effect.duration), modifiers: {...effect.modifiers}};
    sim.effect('buff', sim.player, {color: context.spell.color, duration: .7});
  },
  resource(sim, effect) { sim.gainResource(effect.amount); },
  restoreCooldown(sim, effect) { sim.restoreCooldown(effect.abilityId, false); },
  resetCooldowns(sim) { for (const spell of sim.spells) sim.restoreCooldown(spell.id, true); },
  refreshDots(sim, effect, context) {
    const targets = effect.ids ? context.victims.map(v => v.target) : [...sim.targets];
    for (const target of targets) {
      if (!sim.target(target.id)) continue;
      for (const [id, dot] of Object.entries(target.dots)) {
        if ((!effect.ids || effect.ids.includes(id)) && dot.expires > sim.tick) {
          dot.expires = sim.tick + dot.duration;
        }
      }
    }
  },
  link(sim, effect, context) {
    const [primary, ...others] = context.victims;
    if (!primary || !sim.target(primary.target.id)) return;
    // Recasting on a primary replaces its links; separate primaries may coexist.
    sim.links = sim.links.filter(link => link.sourceId !== primary.target.id || link.spellId !== context.spell.id);
    const targetIds = others.filter(v => sim.target(v.target.id)).map(v => v.target.id);
    if (targetIds.length) sim.links.push({sourceId: primary.target.id, targetIds,
      spellId: context.spell.id, expires: sim.tick + sim.toTicks(effect.duration), fraction: effect.fraction});
  },
};

export function applyEffects(sim, effects, context) {
  for (const effect of effects) EFFECT_HANDLERS[effect.type](sim, effect, context);
}
