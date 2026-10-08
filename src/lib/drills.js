/** Versioned, JSON-only encounter definitions. Angles are degrees; times are seconds. */
export const DRILL_VERSION = 1;
export const DRILL_HZ = 60;
export const DRILL_WORLD = Object.freeze({width: 1000, height: 560, margin: 30});
export const MECHANIC_KINDS = Object.freeze(['circle', 'line', 'projectiles', 'safe-deadline', 'safe-hold']);
export const DRILL_LIMITS = Object.freeze({
  bosses: 8, addWaves: 16, mechanics: 32, count: 32, minFrequency: .25, maxTime: 3600,
  maxLifetime: 120, minRadius: 12, maxRadius: 450, minWidth: 12, maxWidth: 1000,
  minSpeed: 10, maxSpeed: 1200, minSize: 2, maxSize: 40, minSpacing: 30, maxSpacing: 1000,
  maxDamage: 100000, maxHealth: 10000000, liveAdds: 64, liveHazards: 96,
  liveProjectiles: 256, liveSafeZones: 64, importBytes: 1024 * 1024,
});
const copy = value => JSON.parse(JSON.stringify(value));
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
let factorySequence = 0;
const placement = () => ({mode: 'fixed', x: 500, y: 280});

export function createMechanic(kind = 'circle', overrides = {}) {
  if (!MECHANIC_KINDS.includes(kind)) throw new Error(`Unknown mechanic kind: ${kind}`);
  const shared = {id: `${kind}-${++factorySequence}`, kind, first: 6, frequency: 8, placement: placement()};
  const details = {
    circle: {delay: 2, radius: 76, damage: 1000},
    line: {delay: 2.6, width: 72, angle: 0, direction: 'fixed', angleStep: 30, damage: 1000},
    projectiles: {pattern: 'fan', count: 5, spread: 60, speed: 180, spacing: 64, size: 8,
      angle: 90, direction: 'fixed', angleStep: 20, damage: 750, lifetime: 12},
    'safe-deadline': {delay: 3, radius: 80, damage: 1000},
    'safe-hold': {delay: 3, duration: 5, radius: 110, damage: 500},
  }[kind];
  return copy({...shared, ...details, ...overrides, kind, placement: {...shared.placement, ...overrides.placement}});
}
export function createAddWave(overrides = {}) {
  const value = {id: `wave-${++factorySequence}`, first: 14, frequency: 30, count: 2,
    placement: {mode: 'fixed', x: 255, y: 180}, health: 6200, lifetime: 40};
  return copy({...value, ...overrides, placement: {...value.placement, ...overrides.placement}});
}
export const DEFAULT_DRILL = freeze({version: 1, id: 'training-default', name: 'Sentinel practice', seed: 72821,
  playerStart: {x: 500, y: 445}, bosses: [{id: 'dummy', name: 'Eternal sentinel', x: 500, y: 160}],
  addWaves: [createAddWave({id: 'echo-wave'})],
  mechanics: [createMechanic('circle', {id: 'ground-circle', first: 6, frequency: 6.4, placement: {mode: 'player'}})],
});
export function createDrill(overrides = {}) {
  return copy({...DEFAULT_DRILL, id: `drill-${++factorySequence}`, name: 'New training drill', ...overrides,
    playerStart: {...DEFAULT_DRILL.playerStart, ...overrides.playerStart}});
}

/** Invalid input is never coerced or partially applied. Unknown fields are errors. */
export function validateDrill(input) {
  const errors = [];
  const error = (path, message) => { if (errors.length < 80) errors.push(`${path}: ${message}`); };
  const object = (v, path, keys) => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) {
      error(path, 'must be a plain object'); return false;
    }
    const supplied = Object.keys(v);
    if (supplied.length > keys.length + 8) { error(path, 'too many fields'); return false; }
    for (const key of supplied) if (!keys.includes(key)) error(`${path}.${key}`, 'unknown field');
    for (const key of keys) if (!Object.hasOwn(v, key)) error(`${path}.${key}`, 'is required');
    return true;
  };
  const number = (v, path, min, max, integer = false) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
      error(path, `must be ${integer ? 'an integer' : 'a finite number'} from ${min} to ${max}`);
    }
    return v;
  };
  const enumeration = (v, path, options) => { if (!options.includes(v)) error(path, `must be one of ${options.join(', ')}`); return v; };
  const string = (v, path, max = 100) => {
    if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) error(path, `must be nonempty text of at most ${max} characters`);
    return typeof v === 'string' ? v.trim() : v;
  };
  const ids = new Set();
  const id = (v, path) => {
    if (typeof v !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(v) || (Object.hasOwn(Object.prototype, v) || v === 'prototype')) error(path, 'must be a safe identifier (letters, digits, hyphens or underscores; 1–64 characters)');
    if (ids.has(v)) error(path, 'duplicate identifier');
    ids.add(v); return v;
  };
  const position = (v, path, withMode = false) => {
    if (!object(v, path, withMode ? ['mode', 'x', 'y'] : ['x', 'y'])) return null;
    const result = {x: number(v.x, `${path}.x`, 30, 970), y: number(v.y, `${path}.y`, 30, 530)};
    return withMode ? {mode: enumeration(v.mode, `${path}.mode`, ['fixed', 'player', 'random']), ...result} : result;
  };
  const array = (v, path, min, max, map) => {
    if (!Array.isArray(v) || v.length < min || v.length > max) { error(path, `must contain ${min}–${max} items`); return []; }
    return Array.from(v, (entry, index) => map(entry, `${path}[${index}]`));
  };
  const schedule = (v, path) => ({
    id: id(v.id, `${path}.id`), first: number(v.first, `${path}.first`, 0, DRILL_LIMITS.maxTime),
    frequency: number(v.frequency, `${path}.frequency`, DRILL_LIMITS.minFrequency, DRILL_LIMITS.maxTime),
    placement: position(v.placement, `${path}.placement`, true),
  });
  const common = ['id', 'kind', 'first', 'frequency', 'placement'];
  const fields = {
    circle: ['delay', 'radius', 'damage'],
    line: ['delay', 'width', 'angle', 'direction', 'angleStep', 'damage'],
    projectiles: ['pattern', 'count', 'spread', 'speed', 'spacing', 'size', 'angle', 'direction', 'angleStep', 'damage', 'lifetime'],
    'safe-deadline': ['delay', 'radius', 'damage'],
    'safe-hold': ['delay', 'duration', 'radius', 'damage'],
  };
  const range = {
    delay: [0, 120], duration: [1 / DRILL_HZ, 120], radius: [12, 450], width: [12, 1000],
    angle: [-3600, 3600], angleStep: [-3600, 3600], damage: [0, DRILL_LIMITS.maxDamage],
    count: [1, 32, true], spread: [0, 360], speed: [10, 1200], spacing: [30, 1000],
    size: [2, 40], lifetime: [1 / DRILL_HZ, 120],
  };
  if (!object(input, 'drill', ['version', 'id', 'name', 'seed', 'playerStart', 'bosses', 'addWaves', 'mechanics'])) return {valid: false, errors, value: null};
  if (input.version !== DRILL_VERSION) error('drill.version', `unsupported version; expected ${DRILL_VERSION}`);
  const value = {version: DRILL_VERSION, id: id(input.id, 'drill.id'), name: string(input.name, 'drill.name'),
    seed: number(input.seed, 'drill.seed', 1, 4294967295, true), playerStart: position(input.playerStart, 'drill.playerStart'),
    bosses: array(input.bosses, 'drill.bosses', 1, DRILL_LIMITS.bosses, (v, path) => {
      if (!object(v, path, ['id', 'name', 'x', 'y'])) return null;
      return {id: id(v.id, `${path}.id`), name: string(v.name, `${path}.name`), x: number(v.x, `${path}.x`, 30, 970), y: number(v.y, `${path}.y`, 30, 530)};
    }),
    addWaves: array(input.addWaves, 'drill.addWaves', 0, DRILL_LIMITS.addWaves, (v, path) => {
      if (!object(v, path, ['id', 'first', 'frequency', 'count', 'placement', 'health', 'lifetime'])) return null;
      return {...schedule(v, path), count: number(v.count, `${path}.count`, 1, 32, true),
        health: number(v.health, `${path}.health`, 1, DRILL_LIMITS.maxHealth), lifetime: number(v.lifetime, `${path}.lifetime`, 1 / DRILL_HZ, 120)};
    }),
    mechanics: array(input.mechanics, 'drill.mechanics', 0, DRILL_LIMITS.mechanics, (v, path) => {
      if (!v || typeof v !== 'object' || !MECHANIC_KINDS.includes(v.kind)) { error(`${path}.kind`, 'unsupported mechanic'); return null; }
      if (!object(v, path, [...common, ...fields[v.kind]])) return null;
      const rule = {...schedule(v, path), kind: v.kind};
      for (const key of fields[v.kind]) {
        const fieldPath = `${path}.${key}`;
        rule[key] = key === 'direction' ? enumeration(v[key], fieldPath, ['fixed', 'random', 'sequence'])
          : key === 'pattern' ? enumeration(v[key], fieldPath, ['aimed', 'fan', 'radial', 'wall'])
            : number(v[key], fieldPath, ...range[key]);
      }
      // Cross-field checks must never coerce rejected JSON values. Objects may
      // shadow toString/valueOf with non-callable values and throw on arithmetic.
      if (v.kind === 'projectiles' && v.pattern === 'wall'
        && typeof v.spacing === 'number' && Number.isFinite(v.spacing)
        && typeof v.size === 'number' && Number.isFinite(v.size)
        && v.spacing < 2 * v.size + 26) error(`${path}.spacing`, 'wall gaps must fit the 24-unit player (spacing must be at least 2 × size + 26)');
      return rule;
    }),
  };
  return {valid: errors.length === 0, errors, value: errors.length ? null : value};
}

/** Immutable run snapshot with rounded integer-tick scheduling. No future event queue grows. */
export function compileDrill(input) {
  const validation = validateDrill(input);
  if (!validation.valid) throw new Error(`Invalid drill: ${validation.errors.join('; ')}`);
  const drill = freeze(validation.value);
  const schedules = [...drill.addWaves.map(rule => ({kind: 'adds', rule})), ...drill.mechanics.map(rule => ({kind: rule.kind, rule}))]
    .map(entry => ({...entry, id: entry.rule.id, firstTick: Math.round(entry.rule.first * DRILL_HZ),
      frequencyTicks: Math.max(1, Math.round(entry.rule.frequency * DRILL_HZ)),
      delayTicks: Math.round((entry.rule.delay || 0) * DRILL_HZ),
      durationTicks: Math.round((entry.rule.duration || 0) * DRILL_HZ),
      lifetimeTicks: Math.round((entry.rule.lifetime || 0) * DRILL_HZ)}));
  return freeze({drill, schedules});
}
export function exportDrill(input) { return JSON.stringify(compileDrill(input).drill, null, 2); }
