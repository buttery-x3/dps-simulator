import {DEFAULT_DRILL, validateDrill} from './drills.js';

export const DRILL_STORAGE_KEY = 'veilweaver.drills.v1';
export const DRILL_LIBRARY_VERSION = 1;
export const MAX_DRILL_LIBRARY_SIZE = 64;
export const MAX_DRILL_IMPORT_BYTES = 1024 * 1024;
const clone = value => JSON.parse(JSON.stringify(value));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const byteLength = text => new TextEncoder().encode(text).byteLength;
const fail = reason => ({ok: false, reason});
const resolveStorage = storage => storage === undefined ? globalThis.localStorage : storage;

/** IDs belong to drills, so renaming never breaks the selected drill. */
export function newDrillId() {
  return `drill-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`}`;
}

function validateLibrary(library) {
  if (!Array.isArray(library) || library.length < 1 || library.length > MAX_DRILL_LIBRARY_SIZE) {
    return fail(`A library must contain 1–${MAX_DRILL_LIBRARY_SIZE} drills.`);
  }
  const ids = new Set();
  const drills = [];
  for (const item of library) {
    const result = validateDrill(item);
    if (!result.valid) return fail(result.errors.join(' '));
    if (ids.has(result.value.id)) return fail(`Duplicate drill ID: ${result.value.id}.`);
    ids.add(result.value.id);
    drills.push(clone(result.value));
  }
  return {ok: true, drills};
}

/** Parse everything before exposing any candidate change. No storage mutations. */
export function parseDrillImport(text) {
  if (typeof text !== 'string' || text.length > MAX_DRILL_IMPORT_BYTES || byteLength(text) > MAX_DRILL_IMPORT_BYTES) {
    return fail('Import is too large. Choose a JSON file smaller than 1 MiB.');
  }
  let value;
  try { value = JSON.parse(text); } catch { return fail('This is not valid JSON. Check the file and try again.'); }
  if (!plain(value)) return fail('Import must be a drill or a versioned drill library.');
  if (Object.hasOwn(value, 'drills')) {
    if (value.version !== DRILL_LIBRARY_VERSION) return fail('This drill library version is not supported.');
    if (Object.keys(value).some(key => !['version', 'selectedId', 'drills'].includes(key))) return fail('The library contains unsupported fields.');
    const result = validateLibrary(value.drills);
    if (!result.ok) return result;
    if (value.selectedId !== undefined && !result.drills.some(drill => drill.id === value.selectedId)) return fail('The selected drill is missing from this library.');
    return {ok: true, kind: 'library', drills: result.drills, selectedId: value.selectedId ?? result.drills[0].id};
  }
  const result = validateDrill(value);
  if (!result.valid) return fail(result.errors.join(' '));
  return {ok: true, kind: 'drill', drills: [clone(result.value)], selectedId: result.value.id};
}

/** Merge imported IDs explicitly. Call again with replace:true only after approval. */
export function mergeDrillImport(library, imported, {replace = false} = {}) {
  const current = validateLibrary(library);
  if (!current.ok) return current;
  if (!imported?.ok) return fail(imported?.reason ?? 'No valid import was provided.');
  const next = validateLibrary(imported.drills);
  if (!next.ok) return next;
  const existingIds = new Set(current.drills.map(drill => drill.id));
  const collisions = next.drills.filter(drill => existingIds.has(drill.id)).map(({id, name}) => ({id, name}));
  if (collisions.length && !replace) return {ok: false, reason: 'collision', collisions};
  const incomingIds = new Set(next.drills.map(drill => drill.id));
  const combined = [...current.drills.filter(drill => !incomingIds.has(drill.id)), ...next.drills];
  if (combined.length > MAX_DRILL_LIBRARY_SIZE) return fail(`Your library can hold up to ${MAX_DRILL_LIBRARY_SIZE} drills. Delete a drill before importing more.`);
  const selectedId = next.drills.some(drill => drill.id === imported.selectedId) ? imported.selectedId : next.drills[0].id;
  return {ok: true, library: combined, selectedId};
}

export function exportDrillLibrary(library, selectedId = library?.[0]?.id) {
  const result = validateLibrary(library);
  if (!result.ok) throw new Error(result.reason);
  if (!result.drills.some(drill => drill.id === selectedId)) throw new Error('Choose a saved drill before exporting the library.');
  const text = JSON.stringify({version: DRILL_LIBRARY_VERSION, selectedId, drills: result.drills}, null, 2);
  if (byteLength(text) > MAX_DRILL_IMPORT_BYTES) throw new Error('This library is too large to export. Export drills individually.');
  return text;
}

/** A blocked/corrupt store is never overwritten during loading. */
export function loadDrillLibrary(storage) {
  const fallback = status => ({library: [clone(DEFAULT_DRILL)], selectedId: DEFAULT_DRILL.id, status});
  let raw;
  try {
    const target = resolveStorage(storage);
    if (!target || typeof target.getItem !== 'function') return fallback('unavailable');
    raw = target.getItem(DRILL_STORAGE_KEY);
  } catch { return fallback('unavailable'); }
  if (raw === null) return fallback('default');
  const result = parseDrillImport(raw);
  if (!result.ok || result.kind !== 'library') return fallback('corrupt');
  return {library: result.drills, selectedId: result.selectedId, status: 'loaded'};
}

/** Caller retains the library in memory even when persistence is unavailable. */
export function saveDrillLibrary(library, selectedId, storage) {
  let raw;
  try { raw = exportDrillLibrary(library, selectedId); } catch (error) { return fail(error.message); }
  try {
    const target = resolveStorage(storage);
    if (!target || typeof target.setItem !== 'function') return fail('unavailable');
    target.setItem(DRILL_STORAGE_KEY, raw);
    return {ok: true};
  } catch { return fail('unavailable'); }
}
