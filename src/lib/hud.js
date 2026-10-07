import {spellReadiness} from './icons.js';

const HZ = 60;
export const num = value => Math.round(value).toLocaleString();
export const duration = seconds => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
const allEffects = spell => [...(spell.effects || []), ...(spell.triggers || []).flatMap(trigger => trigger.effects || [])];

// Definitions, not spell names, decide which effects are maintenance objectives.
export function maintenanceDots(spells) {
  const dots = new Map();
  for (const spell of spells) for (const effect of allEffects(spell)) {
    if (effect.type === 'dot' && effect.maintenance) dots.set(effect.id || spell.id, {
      id: effect.id || spell.id, name: effect.name || spell.name,
      duration: effect.duration, carry: effect.carry || 0, color: spell.color, spellId: spell.id,
    });
  }
  return [...dots.values()];
}

function activationLabel(spell) {
  const activation = spell.activation || {};
  if (activation.kind === 'channel') return `${activation.duration}s channel`;
  if (activation.kind === 'cast') return `${activation.duration}s cast`;
  return spell.targeting?.kind === 'self' ? 'Instant · self buff' : 'Instant';
}

// The simulation stays mutable and framework-free; each HUD is a fresh projection.
export function buildHud(sim) {
  const spells = sim.spells || [];
  const trackedDots = maintenanceDots(spells);
  const resource = {
    value: sim.resource?.value ?? 0,
    max: sim.resource?.max ?? 3,
    label: sim.resource?.label || 'VOID',
    hasGenerator: spells.some(spell => allEffects(spell).some(effect => effect.type === 'resource' && effect.amount > 0)),
    hasSpender: spells.some(spell => Boolean(spell.cost)),
  };
  const abilities = spells.map(spell => {
    const state = spellReadiness(sim, spell.id);
    let label;
    if (state.storedCharges) {
      label = `${state.charges}/${state.maxCharges} charges`;
      if (state.recharge > 0) label += ` · +1 in ${state.recharge.toFixed(1)}s`;
      if (state.resourceLocked) label += ` · ${resource.value}/${state.resourceRequired} ${resource.label.toLowerCase()}`;
    } else if (state.cooldown > 0) label = `Cooldown ${state.cooldown.toFixed(1)}s`;
    else if (spell.cost) label = state.ready === 'resource' ? 'READY' : `${resource.value}/${state.resourceRequired} ${resource.label.toLowerCase()}`;
    else label = activationLabel(spell);
    return {...spell, icon: spell.icon || spell.id, state, label, queued: sim.queue?.id === spell.id};
  });
  const readySpender = abilities.find(spell => spell.state.ready === 'resource');
  const cast = sim.cast;
  const castingSpell = cast ? spells.find(spell => spell.id === cast.spell) : null;
  const progress = cast ? Math.max(0, Math.min(1, (sim.tick - cast.started) / Math.max(1, cast.ends - cast.started))) : 0;
  const movementHint = castingSpell?.activation?.moving ? 'cast while moving'
    : cast?.kind === 'channel' ? 'movement interrupts' : 'stand still';
  const notice = sim.notice && sim.notice.until >= sim.tick ? {...sim.notice} : {
    text: readySpender ? `${readySpender.name} ready · ${readySpender.key}`
      : trackedDots.length ? 'Keep your damage-over-time effects on each target. Dodge red ground marks.'
        : 'Use your selected spells. Save mobile casts for red ground marks.',
    kind: 'info',
  };
  return {
    phase: sim.phase,
    pauseReason: sim.pauseReason,
    metrics: sim.metrics(),
    resource,
    shards: resource.value,
    buffs: Object.entries(sim.buffs || {}).filter(([, buff]) => buff.expires > sim.tick).map(([id, buff]) => ({
      id, name: buff.name || spells.find(spell => spell.id === id)?.name || id,
      seconds: Math.max(0, (buff.expires - sim.tick) / HZ),
    })),
    notice,
    cast: {
      name: cast ? castingSpell?.name || 'Casting' : sim.queue ? 'Spell queued' : sim.input.x || sim.input.y ? 'Moving' : 'Ready',
      time: cast ? `${Math.max(0, (cast.ends - sim.tick) / HZ).toFixed(1)}s · ${movementHint}`
        : sim.tick < sim.gcdUntil ? `Global cooldown · ${((sim.gcdUntil - sim.tick) / HZ).toFixed(1)}s`
          : 'Check each spell’s movement rules',
      channel: cast?.kind === 'channel',
      progress: cast?.kind === 'channel' ? 1 - progress : progress,
    },
    abilities,
    targets: sim.targets.map(target => {
      const dots = trackedDots.map(definition => {
        const effect = target.dots?.[definition.id];
        const seconds = effect ? Math.max(0, (effect.expires - sim.tick) / HZ) : 0;
        const missing = seconds <= 0;
        // Use each definition’s refresh carry window, including talent changes.
        const refresh = !missing && seconds <= (definition.duration || (effect.duration || 0) / HZ) * definition.carry;
        return {...definition, seconds, missing, refresh,
          text: missing ? `○ No ${definition.name}` : `● ${definition.name} ${seconds.toFixed(1)}s`,
        };
      });
      return {
        id: target.id, name: target.name, dummy: target.kind === 'dummy',
        selected: target.id === sim.selectedId,
        dots,
        dot: dots.length ? dots.map(dot => dot.text).join(' · ') : 'No maintenance DoT selected',
        dotClass: dots.some(dot => dot.missing) ? 'missing' : dots.some(dot => dot.refresh) ? 'refresh' : '',
        hp: target.kind === 'dummy' ? '∞ HP' : `${num(target.hp)} HP`,
        healthPercent: target.kind === 'dummy' ? 100 : target.hp / target.maxHp * 100,
        title: target.kind === 'dummy' ? 'Permanent training target' : `Fades in ${Math.max(0, Math.ceil((target.expires - sim.tick) / HZ))} seconds`,
      };
    }),
  };
}
