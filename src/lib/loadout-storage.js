import {ABILITIES, DEFAULT_LOADOUT, SLOT_KEYS, TALENT_BUDGET, validateLoadoutDraft} from './catalogue.js';

export const LOADOUT_STORAGE_KEY = 'veilweaver.loadout.v1';
const VERSION = 1;
const MAX_SAVED_LENGTH = 32000;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = loadout => ({abilities: [...loadout.abilities], talents: {...loadout.talents}});
const resolveStorage = storage => storage === undefined ? globalThis.localStorage : storage;

/** Keep valid choices in their saved order when the catalogue has changed. */
export function loadLoadout(storage) {
  const fallback = status => ({loadout: copy(DEFAULT_LOADOUT), status});
  let raw;
  try {
    const target = resolveStorage(storage);
    if (!target || typeof target.getItem !== 'function') return fallback('unavailable');
    raw = target.getItem(LOADOUT_STORAGE_KEY);
  } catch { return fallback('unavailable'); }
  if (raw === null) return fallback('default');
  try {
    if (typeof raw !== 'string' || raw.length > MAX_SAVED_LENGTH) return fallback('corrupt');
    const saved = JSON.parse(raw);
    if (!plain(saved) || saved.version !== VERSION || !plain(saved.loadout) || !Array.isArray(saved.loadout.abilities)) return fallback('corrupt');
    const source = saved.loadout;
    const byId = new Map(ABILITIES.map(ability => [ability.id, ability]));
    const abilities = [...new Set(source.abilities.filter(id => typeof id === 'string' && byId.has(id)))].slice(0, SLOT_KEYS.length);
    // An intentionally empty draft is retained. An entirely obsolete selection
    // falls back to the defaults rather than silently leaving the player stuck.
    if (source.abilities.length && !abilities.length) return fallback('corrupt');
    const sourceTalents = plain(source.talents) ? source.talents : {};
    const talents = Object.fromEntries(abilities.filter(id => Object.hasOwn(sourceTalents, id)
      && byId.get(id).talents.some(talent => talent.id === sourceTalents[id]))
      .slice(0, TALENT_BUDGET).map(id => [id, sourceTalents[id]]));
    const loadout = {abilities, talents};
    if (!validateLoadoutDraft(loadout).valid) return fallback('corrupt');
    const unchanged = validateLoadoutDraft(source).valid
      && JSON.stringify(source.abilities) === JSON.stringify(abilities)
      && Object.keys(sourceTalents).every(id => sourceTalents[id] === null || sourceTalents[id] === 'base' || talents[id] === sourceTalents[id]);
    return {loadout, status: unchanged ? 'loaded' : 'repaired'};
  } catch { return fallback('corrupt'); }
}

/** Save only canonical selection data, never combat, metrics or session setup. */
export function saveLoadout(loadout, storage) {
  const validation = validateLoadoutDraft(loadout);
  if (!validation.valid) return {ok: false, reason: validation.errors[0]};
  const canonical = {abilities: [...loadout.abilities], talents: Object.fromEntries(
    Object.entries(loadout.talents ?? {}).filter(([, id]) => id !== null && id !== 'base'))};
  try {
    const target = resolveStorage(storage);
    if (!target || typeof target.setItem !== 'function') return {ok: false, reason: 'unavailable'};
    target.setItem(LOADOUT_STORAGE_KEY, JSON.stringify({version: VERSION, loadout: canonical}));
    return {ok: true};
  } catch { return {ok: false, reason: 'unavailable'}; }
}
