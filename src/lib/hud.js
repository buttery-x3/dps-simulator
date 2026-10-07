import {SPELLS, HZ} from './engine.js';
import {ICONS, spellReadiness} from './icons.js';

export const num = value => Math.round(value).toLocaleString();
export const duration = seconds => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;

// The simulation is intentionally mutable and framework-free. Each view is a
// fresh immutable projection so Svelte never owns or proxies simulation state.
export function buildHud(sim) {
  const cast = sim.cast;
  const progress = cast ? (sim.tick - cast.started) / (cast.ends - cast.started) : 0;
  const notice = sim.notice.until >= sim.tick ? {...sim.notice} : {
    text: sim.shards === 3 ? 'Three shards ready · cast your fifth spell' : sim.proc.charges
      ? 'Wraithbolt ready · cast it while moving' : 'Keep Brand on every target. Fill the gaps with Gloam Thread.',
    kind: 'info',
  };
  return {
    phase: sim.phase,
    pauseReason: sim.pauseReason,
    metrics: sim.metrics(),
    shards: sim.shards,
    proc: {charges: sim.proc.charges, seconds: Math.ceil((sim.proc.until - sim.tick) / HZ)},
    notice,
    cast: {
      name: cast ? SPELLS.find(spell => spell.id === cast.spell).name : sim.queue
        ? 'Spell queued' : sim.input.x || sim.input.y ? 'Moving' : 'Ready',
      time: cast ? `${((cast.ends - sim.tick) / HZ).toFixed(1)}s · ${cast.kind === 'channel' ? 'movement interrupts' : 'stand still'}`
        : sim.tick < sim.gcdUntil ? `Global cooldown · ${((sim.gcdUntil - sim.tick) / HZ).toFixed(1)}s`
          : 'Instant spells work while moving',
      channel: cast?.kind === 'channel',
      progress: cast?.kind === 'channel' ? 1 - progress : progress,
    },
    abilities: SPELLS.map(spell => {
      const state = spellReadiness(sim, spell.id);
      const icon = spell.id === 'spend' && sim.loadout === 'bloom' ? 'bloom' : spell.id;
      const label = state.cooldown ? `Cooldown ${state.cooldown.toFixed(1)}s`
        : spell.id === 'bolt' ? sim.proc.charges ? `${sim.proc.charges} ready · ${Math.ceil((sim.proc.until - sim.tick) / HZ)}s` : 'Proc required'
        : spell.id === 'spend' ? sim.shards === 3 ? 'READY' : `${sim.shards}/3 shards`
        : spell.id === 'brand' ? 'Instant · DoT' : spell.id === 'glass' ? '1.5s cast' : '3s channel';
      return {...spell, icon, name: ICONS[icon].name, state, label, queued: sim.queue?.id === spell.id};
    }),
    targets: sim.targets.map(target => {
      const dot = target.dots.brand;
      const seconds = dot ? Math.max(0, (dot.expires - sim.tick) / HZ) : 0;
      return {
        id: target.id, name: target.name, dummy: target.kind === 'dummy',
        selected: target.id === sim.selectedId,
        dot: dot ? `● Brand ${seconds.toFixed(1)}s` : '○ No Brand',
        dotClass: !dot ? 'missing' : seconds <= 5.4 ? 'refresh' : '',
        hp: target.kind === 'dummy' ? '∞ HP' : `${num(target.hp)} HP`,
        healthPercent: target.kind === 'dummy' ? 100 : target.hp / target.maxHp * 100,
        title: target.kind === 'dummy' ? 'Permanent training target' : `Fades in ${Math.ceil((target.expires - sim.tick) / HZ)} seconds`,
      };
    }),
  };
}
