/** Integer-tick encounter runtime, intentionally separate from spell/projectile VFX. */
import {compileDrill, DRILL_HZ as HZ, DRILL_LIMITS as LIMITS, DRILL_WORLD as WORLD} from './drills.js';
const TAU = Math.PI * 2;
const radians = degrees => degrees * Math.PI / 180;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const bounded = point => ({x: clamp(point.x, WORLD.margin, WORLD.width - WORLD.margin), y: clamp(point.y, WORLD.margin, WORLD.height - WORLD.margin)});
const inSafe = (zone, player) => Math.hypot(zone.x - player.x, zone.y - player.y) <= Math.max(0, zone.r - player.r) + 1e-9;

/** Swept relative-motion circle test: a fast projectile cannot tunnel through a moving player. */
export function sweptProjectileHit(from, to, playerFrom, playerTo, radius) {
  const ax = from.x - playerFrom.x, ay = from.y - playerFrom.y;
  const dx = to.x - playerTo.x - ax, dy = to.y - playerTo.y - ay;
  const length2 = dx * dx + dy * dy;
  const t = length2 ? clamp(-(ax * dx + ay * dy) / length2, 0, 1) : 0;
  return (ax + dx * t) ** 2 + (ay + dy * t) ** 2 <= radius * radius;
}

export class DrillRuntime {
  constructor(sim, definition) {
    this.sim = sim;
    this.compiled = compileDrill(definition);
    this.drill = this.compiled.drill;
  }
  reset() {
    const sim = this.sim;
    this.rngState = this.drill.seed;
    this.serial = 0; this.started = false; this.lastTick = sim.tick;
    this.schedules = this.compiled.schedules.map(schedule => ({...schedule, nextTick: schedule.firstTick, occurrence: 0}));
    this.stats = {safeDeadlineOpportunities: 0, safeDeadlineReached: 0, safeDeadlineMisses: 0,
      safeHoldActiveTicks: 0, safeHoldInsideTicks: 0, safeHoldOutsideTicks: 0, projectileHits: 0};
    sim.player = {...sim.player, ...this.drill.playerStart};
    sim.targets = this.drill.bosses.map(boss => ({...boss, kind: 'dummy', r: 24, hp: Infinity, maxHp: Infinity, dots: {}, born: 0}));
    sim.selectedId = sim.targets[0].id;
    sim.hazards = []; sim.hostileProjectiles = []; sim.safeZones = [];
  }
  random() {
    let x = this.rngState; x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.rngState = x >>> 0; return this.rngState / 4294967296;
  }
  start() {
    if (this.sim.phase !== 'running' || this.started) return;
    this.started = true; this.lastTick = this.sim.tick;
    this.fireSchedules(); this.resolveHazards(); this.resolveZones(false);
  }
  step(previousPlayer = this.sim.player) {
    const sim = this.sim;
    if (sim.phase !== 'running' || !this.started || sim.tick === this.lastTick) return;
    if (sim.tick !== this.lastTick + 1) throw new Error('DrillRuntime.step requires consecutive integer simulation ticks');
    this.lastTick = sim.tick;
    // Objects created on a boundary first move in the next interval, never retroactively.
    this.moveProjectiles(previousPlayer);
    this.fireSchedules(); this.resolveHazards(); this.resolveZones(true);
  }
  position(spec) {
    if (spec.mode === 'player') return bounded(this.sim.player);
    if (spec.mode === 'random') return {x: 30 + this.random() * 940, y: 30 + this.random() * 500};
    return {x: spec.x, y: spec.y};
  }
  direction(rule, occurrence) {
    const degrees = rule.direction === 'random' ? this.random() * 360
      : rule.angle + (rule.direction === 'sequence' ? occurrence * rule.angleStep : 0);
    return radians(((degrees % 360) + 360) % 360);
  }
  fireSchedules() {
    for (const schedule of this.schedules) {
      if (schedule.nextTick > this.sim.tick) continue;
      const occurrence = schedule.occurrence++;
      schedule.nextTick += schedule.frequencyTicks;
      this.spawn(schedule, occurrence);
    }
  }
  spawn(schedule, occurrence) {
    const sim = this.sim, rule = schedule.rule, point = this.position(rule.placement);
    if (schedule.kind === 'adds') {
      const room = LIMITS.liveAdds - sim.targets.filter(target => target.kind === 'add').length;
      const count = Math.min(rule.count, room);
      const columns = Math.ceil(Math.sqrt(rule.count)), rows = Math.ceil(rule.count / columns);
      for (let i = 0; i < count; i++) {
        const spot = bounded({x: point.x + ((i % columns) - (columns - 1) / 2) * 46,
          y: point.y + (Math.floor(i / columns) - (rows - 1) / 2) * 46});
        sim.targets.push({id: `drill-add:${++this.serial}`, name: `Echo ${occurrence + 1}.${i + 1}`, kind: 'add', ...spot,
          r: 20, hp: rule.health, maxHp: rule.health, dots: {}, born: sim.tick,
          expires: sim.tick + schedule.lifetimeTicks, ruleId: rule.id});
      }
      if (count) sim.emit('wave', {count, ruleId: rule.id});
      return;
    }
    if (schedule.kind === 'projectiles') { this.spawnProjectiles(schedule, occurrence, point); return; }
    if (schedule.kind === 'circle' || schedule.kind === 'line') {
      // Consume random orientation even when the live cap prevents spawning.
      const angle = schedule.kind === 'line' ? this.direction(rule, occurrence) : 0;
      if (sim.hazards.length >= LIMITS.liveHazards) return;
      const impact = sim.tick + schedule.delayTicks;
      sim.hazards.push({id: `drill-hazard:${++this.serial}`, ruleId: rule.id, type: schedule.kind, ...point,
        r: rule.radius, width: rule.width, angle, born: sim.tick, impact, ends: impact + Math.round(.55 * HZ), hit: false, damage: rule.damage});
      sim.emit('hazard', {type: schedule.kind, ruleId: rule.id});
      return;
    }
    if (sim.safeZones.length >= LIMITS.liveSafeZones) return;
    const active = sim.tick + schedule.delayTicks;
    sim.safeZones.push({id: `drill-safe:${++this.serial}`, ruleId: rule.id, kind: schedule.kind, ...point,
      r: rule.radius, born: sim.tick, active, ends: active + schedule.durationTicks, damage: rule.damage});
    sim.emit('safe_zone', {kind: schedule.kind, ruleId: rule.id});
  }
  spawnProjectiles(schedule, occurrence, point) {
    const sim = this.sim, rule = schedule.rule;
    // Aimed always tracks the player directly; retained angle/direction fields
    // belong to other patterns and must not silently rotate an aimed shot.
    const angle = rule.pattern === 'aimed' ? Math.atan2(sim.player.y - point.y, sim.player.x - point.x)
      : this.direction(rule, occurrence);
    const ux = Math.cos(angle), uy = Math.sin(angle), nx = -uy, ny = ux;
    let origin = point;
    if (rule.pattern === 'wall') {
      // The entire spawn plane is beyond the upstream support plane of the arena.
      // Every point is outside the rectangle, even for diagonal waves.
      const distance = Math.abs(ux) * WORLD.width / 2 + Math.abs(uy) * WORLD.height / 2 + rule.size + 2;
      origin = {x: WORLD.width / 2 - ux * distance, y: WORLD.height / 2 - uy * distance};
    }
    const count = Math.min(rule.count, LIMITS.liveProjectiles - sim.hostileProjectiles.length);
    for (let index = 0; index < count; index++) {
      let direction = angle, x = origin.x, y = origin.y;
      if (rule.pattern === 'radial') direction += index * TAU / rule.count;
      if (rule.pattern === 'fan') direction += rule.count === 1 ? 0 : radians(rule.spread) * (index / (rule.count - 1) - .5);
      if (rule.pattern === 'wall' || rule.pattern === 'aimed') {
        const offset = (index - (rule.count - 1) / 2) * rule.spacing;
        x += nx * offset; y += ny * offset;
      }
      sim.hostileProjectiles.push({id: `drill-projectile:${++this.serial}`, ruleId: rule.id,
        x, y, r: rule.size, vx: Math.cos(direction) * rule.speed, vy: Math.sin(direction) * rule.speed,
        born: sim.tick, expires: sim.tick + schedule.lifetimeTicks, damage: rule.damage});
    }
    if (count) sim.emit('projectile_wave', {ruleId: rule.id, pattern: rule.pattern, count, angle});
  }
  hit(amount, source, ruleId) {
    this.sim.damageTaken += amount; this.sim.hitsTaken++;
    this.sim.emit('hit', {amount, source, ruleId});
  }
  moveProjectiles(previousPlayer) {
    const sim = this.sim;
    sim.hostileProjectiles = sim.hostileProjectiles.filter(projectile => {
      if (sim.tick > projectile.expires) return false;
      const from = {x: projectile.x, y: projectile.y};
      projectile.x += projectile.vx / HZ; projectile.y += projectile.vy / HZ;
      if (sweptProjectileHit(from, projectile, previousPlayer, sim.player, projectile.r + sim.player.r)) {
        this.stats.projectileHits++; this.hit(projectile.damage, 'projectile', projectile.ruleId); return false;
      }
      // TTL bounds even off-screen diagonal walls without falsely removing inbound objects.
      return sim.tick < projectile.expires;
    });
  }
  resolveHazards() {
    const sim = this.sim, player = sim.player;
    for (const hazard of sim.hazards) {
      if (hazard.hit || sim.tick < hazard.impact) continue;
      hazard.hit = true;
      const hit = hazard.type === 'circle' ? Math.hypot(player.x - hazard.x, player.y - hazard.y) <= hazard.r + player.r
        : Math.abs((player.x - hazard.x) * -Math.sin(hazard.angle) + (player.y - hazard.y) * Math.cos(hazard.angle)) <= hazard.width / 2 + player.r;
      if (hit) this.hit(hazard.damage, hazard.type, hazard.ruleId);
      else sim.emit('dodge', {ruleId: hazard.ruleId});
    }
    sim.hazards = sim.hazards.filter(hazard => sim.tick < hazard.ends);
  }
  resolveZones(accrue) {
    const sim = this.sim;
    const holds = sim.safeZones.filter(zone => zone.kind === 'safe-hold' && sim.tick > zone.active && sim.tick <= zone.ends);
    if (accrue && holds.length) {
      this.stats.safeHoldActiveTicks++;
      if (holds.some(zone => inSafe(zone, sim.player))) this.stats.safeHoldInsideTicks++;
      else {
        this.stats.safeHoldOutsideTicks++;
        if (this.stats.safeHoldOutsideTicks % HZ === 0) {
          const strongest = holds.reduce((a, b) => a.damage >= b.damage ? a : b);
          this.hit(strongest.damage, 'safe-hold', strongest.ruleId);
        }
      }
    }
    for (const zone of sim.safeZones) {
      if (zone.kind !== 'safe-deadline' || sim.tick < zone.ends) continue;
      const reached = inSafe(zone, sim.player);
      this.stats.safeDeadlineOpportunities++;
      this.stats[reached ? 'safeDeadlineReached' : 'safeDeadlineMisses']++;
      sim.emit('safe_deadline', {ruleId: zone.ruleId, reached});
      if (!reached) this.hit(zone.damage, 'safe-deadline', zone.ruleId);
    }
    sim.safeZones = sim.safeZones.filter(zone => sim.tick < zone.ends);
  }
  metrics() {
    const stats = this.stats;
    return {
      safeDeadlineOpportunities: stats.safeDeadlineOpportunities, safeDeadlineReached: stats.safeDeadlineReached,
      safeDeadlineMisses: stats.safeDeadlineMisses,
      safeDeadlineRatio: stats.safeDeadlineOpportunities ? stats.safeDeadlineReached / stats.safeDeadlineOpportunities : null,
      safeHoldActiveSeconds: stats.safeHoldActiveTicks / HZ, safeHoldInsideSeconds: stats.safeHoldInsideTicks / HZ,
      safeHoldOutsideSeconds: stats.safeHoldOutsideTicks / HZ,
      safeHoldRatio: stats.safeHoldActiveTicks ? stats.safeHoldInsideTicks / stats.safeHoldActiveTicks : null,
      projectileHits: stats.projectileHits,
    };
  }
}
