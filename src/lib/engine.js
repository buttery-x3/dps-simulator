/** Portable deterministic combat simulation. Integer 60 Hz clock; declarative spells. */
import {CATALOGUE, DEFAULT_LOADOUT, compileLoadout, validateCatalogue, validateLoadout} from './catalogue.js';
import {applyEffects} from './effect-handlers.js';
import {DEFAULT_BINDINGS, keyLabel, validateBindings} from './keybindings.js';
export const HZ = 60;
export const WORLD = {width: 1000, height: 560, margin: 30};
const ticks = seconds => Math.round(seconds * HZ);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clone = value => JSON.parse(JSON.stringify(value));
// Compatibility export is a default projection only. Runtime/UI use sim.spells.
export const SPELLS = compileLoadout(DEFAULT_LOADOUT);

export class RaidSim {
  constructor({seed = 72821, loadout = DEFAULT_LOADOUT, mechanics = true, layout = 'spread', catalogue = CATALOGUE, keybindings = DEFAULT_BINDINGS} = {}) {
    const validation = validateCatalogue(catalogue);
    if (!validation.valid) throw new Error(`Invalid catalogue: ${validation.errors.join('; ')}`);
    if (!['spread', 'clustered'].includes(layout)) throw new Error('Unknown target layout');
    this.catalogue = catalogue;
    this.seed = seed >>> 0 || 1;
    this.mechanics = mechanics;
    this.layout = layout;
    this.configureKeybindings(keybindings);
    this.configureLoadout(loadout);
    this.reset();
  }
  toTicks(seconds) { return ticks(seconds); }
  configureKeybindings(bindings) {
    if (this.phase === 'running') throw new Error('Pause the active session before changing keybindings.');
    const validation = validateBindings(bindings);
    if (!validation.valid) throw new Error(validation.errors.join('; '));
    // Bindings belong to slots, not spells. Update labels in place so paused casts,
    // effects and the spell map retain their original combat definitions/state.
    const next = [...bindings];
    const labels = next.map(keyLabel);
    this.keybindings = next;
    for (const [index, spell] of (this.spells || []).entries()) {
      spell.key = labels[index];
      spell.keyCode = next[index];
    }
  }
  configureLoadout(loadout) {
    if (['running', 'paused'].includes(this.phase)) throw new Error('Stop the active session before changing loadout.');
    const validation = validateLoadout(loadout, this.catalogue);
    if (!validation.valid) throw new Error(validation.errors.join('; '));
    this.loadout = clone(loadout);
    this.spells = compileLoadout(loadout, this.catalogue);
    this.configureKeybindings(this.keybindings);
    this.spellMap = new Map(this.spells.map(spell => [spell.id, spell]));
    this.loadoutWarnings = validation.warnings;
    this.maintenanceDots = [...new Map(this.spells.flatMap(spell => [...spell.effects, ...spell.triggers.flatMap(trigger => trigger.effects)]
      .filter(effect => effect.type === 'dot' && effect.maintenance)
      .map(effect => [effect.id, {id: effect.id, name: effect.name}]))).values()];
    if (this.phase === 'ready') this.reset();
  }
  reset() {
    this.rngState = this.seed; this.phase = 'ready'; this.time = 0; this.tick = 0; this.accumulator = 0;
    this.player = {x: 500, y: 445, r: 12, speed: 195}; this.input = {x: 0, y: 0};
    this.targets = [{id: 'dummy', name: 'Eternal sentinel', kind: 'dummy', x: 500, y: 160, r: 24, hp: Infinity, maxHp: Infinity, dots: {}, born: 0}];
    this.selectedId = 'dummy'; this.gcdUntil = 0; this.gcdDuration = 1.2; this.cast = null; this.queue = null;
    this.cooldowns = Object.fromEntries(this.spells.map(s => [s.id, 0]));
    this.spellCharges = Object.fromEntries(this.spells.filter(s => s.charges > 1)
      .map(s => [s.id, {current: s.charges, max: s.charges, nextRecharge: 0}]));
    this.resource = {value: 0, max: this.catalogue.resource.max, label: 'VOID'};
    this.buffs = {}; this.links = []; this.hazards = []; this.effects = []; this.events = []; this.damageEvents = [];
    this.totalDamage = 0; this.damageTaken = 0; this.hitsTaken = 0; this.kills = 0; this.escaped = 0;
    this.interrupts = 0; this.wastedShards = 0; this.breakdown = {}; this.targetDamage = {}; this.castCounts = {};
    this.coverage = Object.fromEntries(this.maintenanceDots.map(dot => [dot.id, {...dot, coveredTicks: 0, availableTicks: 0}]));
    this.nextWave = ticks(14); this.nextHazard = ticks(6); this.wave = 0; this.hazardCount = 0; this.eventId = 0; this.summary = null;
    this.notice = {text: this.loadoutWarnings[0] || 'Choose your rhythm. Keep damage rolling and dodge red ground marks.', kind: this.loadoutWarnings.length ? 'warn' : 'info', until: ticks(5)};
  }
  // Shared resource alias retained for metrics adapters, never stored spell charges.
  get shards() { return this.resource.value; }
  set shards(value) { this.resource.value = clamp(Number.isFinite(value) ? value : 0, 0, this.resource.max); }
  rand() { let x = this.rngState; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.rngState = x >>> 0; return this.rngState / 4294967296; }
  emit(type, data = {}) { const e = {id: ++this.eventId, type, time: this.time, ...data}; this.events.push(e); if (this.events.length > 100) this.events.shift(); return e; }
  message(text, kind = 'info', seconds = 2) { this.notice = {text, kind, until: this.tick + ticks(seconds)}; }
  start() { this.reset(); this.phase = 'running'; this.emit('start'); return true; }
  pause(reason = 'Paused') { if (this.phase !== 'running') return false; this.phase = 'paused'; this.setMovement(0, 0); this.pauseReason = reason; this.accumulator = 0; return true; }
  resume() { if (this.phase !== 'paused') return false; this.phase = 'running'; this.accumulator = 0; return true; }
  stop() {
    if (!['running', 'paused'].includes(this.phase)) return false;
    this.phase = 'stopped'; this.input = {x: 0, y: 0}; this.cast = null; this.queue = null; this.accumulator = 0;
    this.summary = clone(this.metrics()); this.emit('stop'); return true;
  }
  target(id = this.selectedId) { return this.targets.find(target => target.id === id); }
  select(id) { if (!this.target(id)) return false; this.selectedId = id; this.emit('select', {targetId: id}); return true; }
  cycleTarget() { const i = this.targets.findIndex(t => t.id === this.selectedId); return this.select(this.targets[(i + 1) % this.targets.length].id); }
  setMovement(x, y) {
    x = Number.isFinite(x) ? clamp(x, -1, 1) : 0; y = Number.isFinite(y) ? clamp(y, -1, 1) : 0;
    const magnitude = Math.hypot(x, y); this.input = {x: magnitude > 1 ? x / magnitude : x, y: magnitude > 1 ? y / magnitude : y};
    if ((x || y) && this.cast && this.phase === 'running' && !this.cast.spellDef.activation.moving) this.interrupt('Movement');
  }
  refundReservation(cast) {
    if (cast.kind === 'channel') return;
    if (cast.spent) this.gainResource(cast.spent, {multiply: false});
    if (cast.reservedCharge) this.restoreCooldown(cast.spell, false);
  }
  interrupt(reason) {
    if (!this.cast) return;
    this.refundReservation(this.cast); this.emit('interrupt', {spell: this.cast.spell, reason}); this.cast = null;
    this.interrupts++; this.message(`${reason} interrupted your cast`, 'warn', 1.8);
  }
  modifier(kind) { return Object.values(this.buffs).filter(buff => buff.expires > this.tick)
    .reduce((value, buff) => value * (buff.modifiers[kind] ?? 1), 1); }
  canCast(id) {
    if (this.phase !== 'running') return 'Start or resume your session';
    const spell = this.spellMap.get(id); if (!spell) return 'Spell is not in your loadout';
    if (spell.targeting.kind !== 'self') {
      const target = this.target(); if (!target) return 'Select a target';
      if (dist(this.player, target) > spell.targeting.range) return 'Target is out of range';
    }
    if (this.tick < this.gcdUntil) return 'Global cooldown';
    if (this.cast?.kind === 'cast') return 'Already casting';
    if ((this.input.x || this.input.y) && spell.activation.kind !== 'instant' && !spell.activation.moving) return 'Stand still to cast';
    const charges = this.spellCharges[id];
    if (charges && charges.current < 1) return 'No stored charges ready';
    if (!charges && this.tick < this.cooldowns[id]) return `${spell.name} is cooling down`;
    if (spell.cost && this.resource.value < spell.cost.min) return `Requires ${spell.cost.min} void resource`;
    if (spell.gcd * this.modifier('gcd') < 1 / HZ) return 'Effective global cooldown is below one simulation tick';
    if (spell.activation.kind === 'cast' && spell.activation.duration * this.modifier('castTime') < 1 / HZ) return 'Effective cast time is below one simulation tick';
    return null;
  }
  use(id, {queue = true} = {}) {
    const reason = this.canCast(id);
    if (reason) {
      const busyUntil = Math.max(this.gcdUntil, this.cast?.kind === 'cast' ? this.cast.ends : 0);
      if (queue && ['Global cooldown', 'Already casting'].includes(reason) && busyUntil - this.tick <= ticks(.18)) {
        this.queue = {id, targetId: this.selectedId, expires: busyUntil + ticks(.12)}; return {ok: true, queued: true};
      }
      if (reason !== 'Global cooldown') this.message(reason, 'warn', 1.3);
      return {ok: false, reason};
    }
    const spell = this.spellMap.get(id);
    if (this.cast) { this.refundReservation(this.cast); this.emit('clip', {spell: this.cast.spell}); }
    this.cast = null; this.queue = null;
    this.gcdDuration = ticks(spell.gcd * this.modifier('gcd')) / HZ;
    this.gcdUntil = this.tick + ticks(this.gcdDuration);
    const spent = spell.cost ? spell.cost.spend === 'all' ? this.resource.value : spell.cost.amount : 0;
    this.resource.value -= spent;
    const charges = this.spellCharges[id];
    if (charges) { charges.current--; if (!charges.nextRecharge) charges.nextRecharge = this.tick + ticks(spell.cooldown); }
    const context = {spell, targetId: spell.targeting.kind === 'self' ? null : this.selectedId, spent, tickIndex: 1};
    this.castCounts[id] = (this.castCounts[id] || 0) + 1;
    this.emit('cast', {spell: id, targetId: context.targetId});
    if (spell.activation.kind === 'channel' && !charges) this.cooldowns[id] = this.tick + ticks(spell.cooldown);
    this.runTriggers(spell, 'cast', context);
    if (spell.activation.kind === 'instant') this.completeAction(context);
    else {
      const duration = spell.activation.duration * (spell.activation.kind === 'cast' ? this.modifier('castTime') : 1);
      this.cast = {spell: id, spellDef: spell, kind: spell.activation.kind, targetId: context.targetId,
        started: this.tick, ends: this.tick + ticks(duration), nextTick: this.tick + ticks(spell.activation.interval || duration),
        tickIndex: 0, spent, reservedCharge: !!charges};
    }
    return {ok: true};
  }
  selectVictims(spell, targetId) {
    const spec = spell.targeting;
    if (spec.kind === 'self') return [];
    const primary = this.target(targetId); if (!primary) return [];
    if (spec.kind === 'single') return [{target: primary, multiplier: 1}];
    if (spec.kind === 'area') return this.targets.filter(t => dist(t, primary) <= spec.radius)
      .map(target => ({target, multiplier: target.id === primary.id ? 1 : spec.secondaryMultiplier ?? 1}));
    const victims = [{target: primary, multiplier: 1}];
    let previous = primary;
    while (victims.length <= spec.additional) {
      const next = this.targets.filter(t => !victims.some(v => v.target.id === t.id) && dist(t, previous) <= spec.jumpRange)
        .sort((a, b) => dist(a, previous) - dist(b, previous) || a.id.localeCompare(b.id))[0];
      if (!next) break;
      victims.push({target: next, multiplier: spec.secondaryMultiplier ?? 1}); previous = next;
    }
    return victims;
  }
  runTriggers(spell, event, context) {
    for (const trigger of spell.triggers || []) {
      if (trigger.event !== event) continue;
      if (trigger.chance >= 1 || this.rand() < trigger.chance) {
        applyEffects(this, trigger.effects, {...context, spell, victims: context.victims || this.selectVictims(spell, context.targetId)});
      }
    }
  }
  resolveEffects(context) {
    const victims = this.selectVictims(context.spell, context.targetId);
    if (!victims.length && context.spell.targeting.kind !== 'self') return false;
    const action = {...context, victims};
    applyEffects(this, context.spell.effects, action);
    // One hit event per original target, not per component or copied damage.
    for (const victim of victims) this.runTriggers(context.spell, 'hit', {...action, targetId: victim.target.id, victims: [victim]});
    const target = victims[0]?.target || this.player;
    const type = context.spell.targeting.kind === 'area' ? 'pulse' : context.spell.activation.kind === 'channel' ? 'beam'
      : context.spell.effects.some(effect => effect.type === 'dot') ? 'dot' : 'projectile';
    this.effect(type, target, {color: context.spell.color, radius: context.spell.targeting.radius || 45, duration: .45});
    return true;
  }
  completeAction(context, channel = false) {
    const spell = context.spell;
    if (!channel && !this.spellCharges[spell.id]) this.cooldowns[spell.id] = this.tick + ticks(spell.cooldown);
    if (!channel && !this.resolveEffects(context)) { this.gainResource(context.spent, {multiply: false}); this.cooldowns[spell.id] = this.tick; return; }
    // Retention is one discrete roll; returned resource is never multiplied by a gain buff.
    if (spell.cost?.retainedOutcomes) {
      const outcomes = spell.cost.retainedOutcomes;
      this.gainResource(outcomes[Math.min(outcomes.length - 1, Math.floor(this.rand() * outcomes.length))], {multiply: false});
    }
    this.runTriggers(spell, 'complete', context);
    this.emit('cast_complete', {spell: spell.id});
  }
  gainResource(amount, {multiply = true} = {}) {
    const gained = amount * (multiply ? this.modifier('resourceGain') : 1);
    if (!gained) return;
    const overflow = Math.max(0, this.resource.value + gained - this.resource.max);
    this.wastedShards += overflow;
    this.resource.value = Math.min(this.resource.max, this.resource.value + gained);
    this.emit('resource', {amount: gained - overflow, overflow});
  }
  restoreCooldown(id, full = false) {
    const spell = this.spellMap.get(id); if (!spell) return;
    const charges = this.spellCharges[id];
    if (charges) {
      charges.current = full ? charges.max : Math.min(charges.max, charges.current + 1);
      if (charges.current === charges.max) charges.nextRecharge = 0;
    } else this.cooldowns[id] = this.tick;
  }
  effect(type, target, extra = {}) { this.effects.push({type, x: target.x, y: target.y, fromX: this.player.x, fromY: this.player.y, start: this.tick, duration: .45, ...extra}); }
  damage(target, amount, spell, {copied = false} = {}) {
    if (!this.target(target.id) || !Number.isFinite(amount) || amount <= 0) return 0;
    const dealt = target.kind === 'dummy' ? amount : Math.min(target.hp, amount);
    if (dealt <= 0) return 0;
    target.hp -= dealt; this.totalDamage += dealt;
    this.breakdown[spell] = (this.breakdown[spell] || 0) + dealt;
    this.targetDamage[target.id] = (this.targetDamage[target.id] || 0) + dealt;
    this.damageEvents.push({tick: this.tick, amount: dealt});
    this.emit('damage', {targetId: target.id, amount: dealt, spell, x: target.x, y: target.y, copied});
    if (!copied) {
      for (const link of [...this.links]) {
        if (link.sourceId !== target.id || link.expires <= this.tick) continue;
        for (const id of link.targetIds) {
          const secondary = this.target(id);
          if (secondary) this.damage(secondary, dealt * link.fraction, link.spellId, {copied: true});
        }
      }
    }
    if (target.hp <= 0 && this.target(target.id)) {
      this.kills++; this.emit('kill', {targetId: target.id, x: target.x, y: target.y});
      this.effect('death', target, {duration: .6}); this.removeTarget(target.id);
    }
    return dealt;
  }
  removeTarget(id) {
    this.targets = this.targets.filter(t => t.id !== id);
    this.links = this.links.filter(link => link.sourceId !== id)
      .map(link => ({...link, targetIds: link.targetIds.filter(targetId => targetId !== id)})).filter(link => link.targetIds.length);
    if (this.selectedId === id) { this.selectedId = 'dummy'; this.emit('select', {targetId: 'dummy'}); }
    if (this.cast?.targetId === id && !(this.cast.kind === 'channel' && this.tick >= this.cast.ends)) { this.refundReservation(this.cast); this.cast = null; this.emit('target_lost'); }
  }
  spawnWave() {
    const spots = this.layout === 'clustered' ? [{x: 425, y: 155}, {x: 575, y: 160}, {x: 435, y: 240}, {x: 570, y: 245}]
      : [{x: 255, y: 140}, {x: 745, y: 160}, {x: 265, y: 280}, {x: 735, y: 275}];
    this.wave++; let created = 0;
    for (let n = 0; n < 2; n++) {
      const occupied = this.targets.filter(t => t.kind === 'add');
      const spot = spots.find(p => !occupied.some(t => dist(p, t) < 30)); if (!spot) break;
      const id = `echo-${this.wave}-${n}`;
      this.targets.push({id, name: `Echo ${this.wave}.${n + 1}`, kind: 'add', ...spot, r: 20, hp: 6200, maxHp: 6200, dots: {}, born: this.tick, expires: this.tick + ticks(40)}); created++;
    }
    if (created) { this.emit('wave', {count: created}); this.message('Priority echoes appeared · choose where to spread your damage', 'warn', 3); }
  }
  spawnHazard(){
    this.hazardCount++;const type=this.hazardCount%3===0?'line':'circle';
    const h={id:`hazard-${this.hazardCount}`,type,born:this.tick,impact:this.tick+ticks(type==='line'?2.6:2.15),ends:this.tick+ticks(type==='line'?3.15:2.7),hit:false};
    if(type==='circle'){h.x=clamp(this.player.x+(this.rand()-.5)*32,95,905);h.y=clamp(this.player.y+(this.rand()-.5)*32,95,465);h.r=76;}
    else{h.angle=this.rand()>.5?Math.PI/2:0;h.x=this.player.x;h.y=this.player.y;h.width=72;}
    this.hazards.push(h);this.emit('hazard',{type});
    // Later drills sometimes layer a second, clearly telegraphed circle.
    if(this.time>40&&this.hazardCount%4===0)this.hazards.push({id:`hazard-extra-${this.hazardCount}`,type:'circle',born:this.tick,impact:this.tick+ticks(3.1),ends:this.tick+ticks(3.65),hit:false,x:clamp(this.player.x+110,100,900),y:clamp(this.player.y-80,100,460),r:64});
  }
  isHit(h,p=this.player){if(h.type==='circle')return dist(h,p)<h.r+p.r-1;const perpendicular=Math.abs((p.x-h.x)*-Math.sin(h.angle)+(p.y-h.y)*Math.cos(h.angle));return perpendicular<h.width/2+p.r-1;}
  advance(seconds){if(this.phase!=='running'||!Number.isFinite(seconds)||seconds<=0)return;this.accumulator+=seconds*HZ;const steps=Math.floor(this.accumulator+1e-8);this.accumulator-=steps;for(let i=0;i<steps&&this.phase==='running';i++)this.step();}
  step() {
    if (this.phase !== 'running') return;
    this.tick++; this.time = this.tick / HZ;
    const p = this.player;
    p.x = clamp(p.x + this.input.x * p.speed / HZ, WORLD.margin, WORLD.width - WORLD.margin);
    p.y = clamp(p.y + this.input.y * p.speed / HZ, WORLD.margin, WORLD.height - WORLD.margin);
    for (const [id, buff] of Object.entries(this.buffs)) if (buff.expires <= this.tick) delete this.buffs[id];
    this.links = this.links.filter(link => link.expires > this.tick);
    for (const [id, state] of Object.entries(this.spellCharges)) {
      if (state.nextRecharge && this.tick >= state.nextRecharge) {
        state.current++; state.nextRecharge = state.current < state.max ? state.nextRecharge + ticks(this.spellMap.get(id).cooldown) : 0;
      }
    }
    // Every selected maintenance DoT has a denominator from each target's first
    // live tick. No application grace period, add exclusion, or post-hoc removal.
    for (const target of this.targets) {
      for (const entry of Object.values(this.coverage)) {
        entry.availableTicks++;
        if (target.dots[entry.id]?.expires >= this.tick) entry.coveredTicks++;
      }
    }
    const cast = this.cast;
    if (cast) {
      if (cast.targetId && !this.target(cast.targetId)) { this.refundReservation(cast); this.cast = null; }
      else {
        const context = {spell: cast.spellDef, targetId: cast.targetId, spent: cast.spent, tickIndex: cast.tickIndex};
        if (cast.kind === 'channel' && this.tick >= cast.nextTick && cast.nextTick <= cast.ends) {
          cast.tickIndex++; context.tickIndex = cast.tickIndex;
          this.resolveEffects(context); cast.nextTick += ticks(cast.spellDef.activation.interval);
        }
        if (this.cast === cast && this.tick >= cast.ends) {
          this.cast = null; this.completeAction(context, cast.kind === 'channel');
        }
      }
    }
    for (const target of [...this.targets]) {
      for (const [id, dot] of Object.entries(target.dots)) {
        if (!this.target(target.id)) break;
        if (this.tick >= dot.nextTick && dot.nextTick <= dot.expires) {
          const dealt = this.damage(target, dot.amount, dot.spellId);
          dot.nextTick += dot.interval;
          if (dealt > 0) this.runTriggers(dot.spell, 'periodicTick', {spell: dot.spell, targetId: target.id, spent: dot.spent, victims: [{target, multiplier: 1}]});
        }
        if (this.tick >= dot.expires) delete target.dots[id];
      }
      if (target.expires && this.tick >= target.expires && this.target(target.id)) {
        this.escaped++; this.emit('escape', {targetId: target.id}); this.removeTarget(target.id);
      }
    }
    for (const h of this.hazards) {
      if (!h.hit && this.tick >= h.impact) {
        h.hit = true;
        if (this.isHit(h)) { this.damageTaken += 1000; this.hitsTaken++; this.emit('hit', {amount: 1000}); this.message('Ground hit · 1,000 damage taken', 'warn', 2.1); }
        else this.emit('dodge');
      }
    }
    this.hazards = this.hazards.filter(h => this.tick < h.ends);
    this.effects = this.effects.filter(e => this.tick < e.start + ticks(e.duration));
    if (this.tick >= this.nextWave) { this.spawnWave(); this.nextWave += ticks(30); }
    if (this.mechanics && this.tick >= this.nextHazard) { this.spawnHazard(); this.nextHazard += ticks(5.2 + this.rand() * 1.6); }
    while (this.damageEvents.length && this.damageEvents[0].tick <= this.tick - ticks(15)) this.damageEvents.shift();
    if (this.queue) {
      if (this.tick > this.queue.expires) this.queue = null;
      else if (this.tick >= this.gcdUntil && this.cast?.kind !== 'cast') {
        const queued = this.queue; this.selectedId = this.target(queued.targetId) ? queued.targetId : this.selectedId;
        this.use(queued.id, {queue: false}); this.queue = null;
      }
    }
  }
  metrics() {
    if (this.phase === 'stopped' && this.summary) return clone(this.summary);
    const duration = this.time, window = Math.min(15, duration);
    const coverageDetails = Object.values(this.coverage).map(entry => ({...entry, ratio: entry.availableTicks ? entry.coveredTicks / entry.availableTicks : 0}));
    const covered = coverageDetails.reduce((n, entry) => n + entry.coveredTicks, 0);
    const available = coverageDetails.reduce((n, entry) => n + entry.availableTicks, 0);
    const dotCoverage = coverageDetails.length ? available ? covered / available : 0 : null;
    return {seed: this.seed, loadout: clone(this.loadout), layout: this.layout, mechanics: this.mechanics,
      keybindings: [...this.keybindings], keyLabels: this.keybindings.map(keyLabel),
      elapsed: duration, totalDamage: this.totalDamage, sessionDps: duration ? this.totalDamage / duration : 0,
      rollingDps: window ? this.damageEvents.reduce((sum, event) => sum + event.amount, 0) / window : 0, rollingSeconds: window,
      damageTaken: this.damageTaken, hitsTaken: this.hitsTaken, kills: this.kills, escaped: this.escaped,
      interrupts: this.interrupts, wastedShards: this.wastedShards, dotCoverage, coverageLabel: 'DoT coverage', coverageDetails,
      breakdown: {...this.breakdown}, castCounts: {...this.castCounts}, spellNames: Object.fromEntries(this.spells.map(spell => [spell.id, spell.name]))};
  }
  snapshot() {
    return {phase: this.phase, ...this.metrics(), keybindings: [...this.keybindings], keyLabels: this.keybindings.map(keyLabel),
      player: {...this.player}, selectedId: this.selectedId,
      targets: this.targets.map(target => ({id: target.id, name: target.name, kind: target.kind,
        hp: target.kind === 'dummy' ? null : target.hp, maxHp: target.kind === 'dummy' ? null : target.maxHp,
        dots: Object.entries(target.dots).map(([id, dot]) => ({id, name: dot.name, seconds: Math.max(0, (dot.expires - this.tick) / HZ)}))})),
      resource: {...this.resource}, storedCharges: clone(this.spellCharges), buffs: clone(this.buffs),
      availableSpells: this.spells.map(spell => ({id: spell.id, name: spell.name, key: spell.key, keyCode: spell.keyCode, talent: spell.talentName,
        cooldownSeconds: Math.max(0, (this.cooldowns[spell.id] - this.tick) / HZ)})),
      gcdSeconds: Math.max(0, (this.gcdUntil - this.tick) / HZ),
      cast: this.cast ? {spell: this.cast.spell, kind: this.cast.kind, remaining: (this.cast.ends - this.tick) / HZ} : null};
  }
}
