import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_DRILL, createDrill, createAddWave, exportDrill} from '../src/lib/drills.js';
import {LOADOUT_STORAGE_KEY} from '../src/lib/loadout-storage.js';
import {DRILL_STORAGE_KEY, MAX_DRILL_IMPORT_BYTES, MAX_DRILL_LIBRARY_SIZE, loadDrillLibrary, saveDrillLibrary, parseDrillImport, mergeDrillImport, exportDrillLibrary, newDrillId} from '../src/lib/drill-storage.js';
import {drawEditorPreview, editorPoint, editorViewport} from '../src/lib/editor-preview.js';

const copy = value => JSON.parse(JSON.stringify(value));
const first = () => createDrill({id: 'first-practice', name: 'First practice'});
const second = () => createDrill({id: 'second-practice', name: 'Second practice', seed: 44});
const legacySentinel = () => ({
  version: 1, id: 'training-default', name: 'Sentinel practice', seed: 72821,
  playerStart: {x: 500, y: 445}, bosses: [{id: 'dummy', name: 'Eternal sentinel', x: 500, y: 160}],
  addWaves: [{id: 'echo-wave', first: 14, frequency: 30, count: 2,
    placement: {mode: 'fixed', x: 255, y: 180}, health: 6200, lifetime: 40}],
  mechanics: [{id: 'ground-circle', kind: 'circle', first: 6, frequency: 6.4,
    placement: {mode: 'player', x: 500, y: 280}, delay: 2, radius: 76, damage: 1000}],
});
function memory(raw) {
  const data = new Map(raw === undefined ? [] : [[DRILL_STORAGE_KEY, raw]]);
  return {data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value)};
}

test('first visit loads a fresh, valid default library without writing', () => {
  const storage = memory();
  const result = loadDrillLibrary(storage);
  assert.deepEqual(result, {library: [DEFAULT_DRILL], selectedId: DEFAULT_DRILL.id, status: 'default'});
  result.library[0].bosses[0].x = 40;
  assert.deepEqual(loadDrillLibrary(storage).library, [DEFAULT_DRILL]);
  assert.equal(storage.data.size, 0);
});

test('library and selected ID survive reload without touching loadout storage', () => {
  const storage = memory(); storage.data.set(LOADOUT_STORAGE_KEY, 'unchanged');
  const library = [first(), second()];
  assert.deepEqual(saveDrillLibrary(library, library[1].id, storage), {ok: true});
  assert.deepEqual(loadDrillLibrary(storage), {library, selectedId: library[1].id, status: 'loaded'});
  assert.equal(storage.data.get(LOADOUT_STORAGE_KEY), 'unchanged');
  const loaded = loadDrillLibrary(storage); loaded.library[0].name = 'Mutation';
  assert.equal(loadDrillLibrary(storage).library[0].name, 'First practice');
});

test('single drill and whole library JSON exports round-trip canonically', () => {
  const library = [first(), second()];
  const exported = exportDrillLibrary(library, library[1].id);
  assert.deepEqual(parseDrillImport(exported), {ok: true, kind: 'library', drills: library, selectedId: library[1].id});
  assert.deepEqual(parseDrillImport(JSON.stringify(library[0])), {ok: true, kind: 'drill', drills: [library[0]], selectedId: library[0].id});
  assert.deepEqual(library, [first(), second()]);
});

for (const mode of ['fixed', 'player', 'random']) test(`legacy ${mode} ADD placement survives import, export, save and browser reload`, () => {
  const drill = createDrill({id: `legacy-${mode}`, addWaves: [createAddWave({placement: {mode, x: 321, y: 456}})]});
  const single = parseDrillImport(exportDrill(drill));
  const library = parseDrillImport(exportDrillLibrary(single.drills, drill.id));
  const storage = memory();
  assert.deepEqual(saveDrillLibrary(library.drills, library.selectedId, storage), {ok: true});
  assert.deepEqual(loadDrillLibrary(storage).library, [drill]);
  assert.deepEqual(loadDrillLibrary(storage).library[0].addWaves[0].placement, {mode, x: 321, y: 456});
});

for (const selection of ['random', 'ordered', 'priority']) test(`${selection} point lists survive import, export, save and browser reload`, () => {
  const drill = createDrill({id: `points-${selection}`, addWaves: [createAddWave({placement: {
    mode: 'points', selection, points: [{x: 430, y: 180}, {x: 570, y: 180}],
  }})]});
  const imported = parseDrillImport(exportDrill(drill));
  const storage = memory();
  assert.deepEqual(saveDrillLibrary(imported.drills, imported.selectedId, storage), {ok: true});
  assert.deepEqual(loadDrillLibrary(storage).library, [drill]);
  const loaded = loadDrillLibrary(storage);
  loaded.library[0].addWaves[0].placement.points[0].x = 31;
  assert.deepEqual(loadDrillLibrary(storage).library, [drill]);
  assert.deepEqual(parseDrillImport(exportDrillLibrary([drill])).drills, [drill]);
});

test('only the exact old canonical Sentinel default upgrades on browser load, without writing', () => {
  const old = legacySentinel();
  const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) : value;
  const raw = JSON.stringify({version: 1, selectedId: second().id, drills: [reverseKeys(old), second()]});
  const storage = memory(raw);
  let writes = 0;
  const setItem = storage.setItem;
  storage.setItem = (...args) => { writes++; setItem(...args); };
  const loaded = loadDrillLibrary(storage);
  assert.deepEqual(loaded, {library: [DEFAULT_DRILL, second()], selectedId: second().id, status: 'loaded'});
  assert.equal(writes, 0);
  assert.equal(storage.data.get(DRILL_STORAGE_KEY), raw);
  assert.deepEqual(old, legacySentinel());
  loaded.library[0].addWaves[0].placement.points[0].x = 400;
  assert.equal(loadDrillLibrary(storage).library[0].addWaves[0].placement.points[0].x, 430);
  assert.equal(DEFAULT_DRILL.addWaves[0].placement.points[0].x, 430);
  assert.deepEqual(saveDrillLibrary(loaded.library, loaded.selectedId, storage), {ok: true});
  assert.equal(writes, 1);
  assert.deepEqual(loadDrillLibrary(storage).library, loaded.library);
});

test('customized drills using the old default ID retain each setting on browser load', () => {
  const edits = [
    d => { d.name = 'My Sentinel practice'; }, d => { d.seed++; }, d => { d.playerStart.x++; },
    d => { d.bosses[0].x++; }, d => { d.bosses[0].name = 'My boss'; }, d => { d.addWaves[0].count++; },
    d => { d.addWaves[0].first++; }, d => { d.addWaves[0].frequency++; }, d => { d.addWaves[0].health++; },
    d => { d.addWaves[0].lifetime++; }, d => { d.addWaves[0].placement.x++; },
    d => { d.addWaves[0].placement.mode = 'player'; }, d => { d.addWaves[0].placement.mode = 'random'; },
    d => { d.mechanics[0].frequency++; }, d => { d.mechanics[0].damage++; }, d => { d.mechanics = []; },
    d => { d.id = 'copied-default'; },
  ];
  for (const edit of edits) {
    const drill = legacySentinel(); edit(drill);
    const raw = exportDrillLibrary([drill]);
    const storage = memory(raw);
    assert.deepEqual(loadDrillLibrary(storage).library, [drill]);
    assert.equal(storage.data.get(DRILL_STORAGE_KEY), raw);
  }
});

test('importing or merging the untouched legacy default preserves legacy intent', () => {
  const old = legacySentinel();
  assert.deepEqual(parseDrillImport(JSON.stringify(old)).drills, [old]);
  const imported = parseDrillImport(exportDrillLibrary([old]));
  assert.deepEqual(imported.drills, [old]);
  assert.deepEqual(mergeDrillImport([first()], imported).library, [first(), old]);
  assert.deepEqual(mergeDrillImport([copy(DEFAULT_DRILL)], imported, {replace: true}).library, [old]);
  const storage = memory();
  assert.deepEqual(saveDrillLibrary([old], old.id, storage), {ok: true});
  assert.deepEqual(JSON.parse(storage.data.get(DRILL_STORAGE_KEY)).drills, [old]);
});

for (const raw of ['{', '', 'null', '[]', '{}', '{"version":999,"drills":[]}', '{"version":1,"selectedId":"missing","drills":[]}', 'x'.repeat(MAX_DRILL_IMPORT_BYTES + 1)]) {
  test(`malformed/unsupported import and storage rejected atomically: ${raw.slice(0, 35)}`, () => {
    assert.equal(parseDrillImport(raw).ok, false);
    const storage = memory(raw);
    const result = loadDrillLibrary(storage);
    assert.equal(result.status, 'corrupt');
    assert.deepEqual(result.library, [DEFAULT_DRILL]);
    assert.equal(storage.data.get(DRILL_STORAGE_KEY), raw);
  });
}

test('library missing selected ID picks the first drill, but invalid explicit ID is rejected', () => {
  const drills = [first(), second()];
  assert.equal(parseDrillImport(JSON.stringify({version: 1, drills})).selectedId, drills[0].id);
  assert.equal(parseDrillImport(JSON.stringify({version: 1, drills, selectedId: 'missing'})).ok, false);
  assert.equal(parseDrillImport(JSON.stringify({version: 1, drills, selectedId: drills[0].id, server: true})).ok, false);
});

test('one invalid drill rejects the whole library, including duplicate and prototype-shaped IDs', () => {
  for (const invalid of [null, {...second(), seed: 0}, {...second(), id: first().id}, {...second(), id: '__proto__'}, {...second(), metrics: {damage: 1}}]) {
    const raw = JSON.stringify({version: 1, drills: [first(), invalid]});
    assert.equal(parseDrillImport(raw).ok, false);
  }
  const hostile = JSON.stringify(first()).replace('"version":1', '"__proto__":{"polluted":true},"version":1');
  assert.equal(parseDrillImport(hostile).ok, false);
  assert.equal({}.polluted, undefined);
});

test('invalid save never changes the stored library', () => {
  const storage = memory(exportDrillLibrary([first()], first().id));
  const previous = storage.data.get(DRILL_STORAGE_KEY);
  for (const library of [null, [], [{...first(), seed: NaN}], [{...first(), bosses: []}], [first(), first()]]) {
    assert.equal(saveDrillLibrary(library, first().id, storage).ok, false);
    assert.equal(storage.data.get(DRILL_STORAGE_KEY), previous);
  }
  assert.equal(saveDrillLibrary([first()], 'missing', storage).ok, false);
  assert.equal(storage.data.get(DRILL_STORAGE_KEY), previous);
});

test('unavailable, quota and blocked storage keep caller data intact', () => {
  const library = [first(), second()];
  const before = copy(library);
  for (const storage of [null, {}, {getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); }}]) {
    assert.equal(loadDrillLibrary(storage).status, 'unavailable');
    assert.deepEqual(saveDrillLibrary(library, first().id, storage), {ok: false, reason: 'unavailable'});
    assert.deepEqual(library, before);
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() { throw Error('blocked getter'); }});
  try { assert.equal(loadDrillLibrary().status, 'unavailable'); assert.equal(saveDrillLibrary(library, first().id).reason, 'unavailable'); }
  finally { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage; }
});

test('merging new drill adds without mutating either input', () => {
  const library = [first()]; const imported = parseDrillImport(JSON.stringify(second()));
  const before = JSON.stringify({library, imported});
  const result = mergeDrillImport(library, imported);
  assert.equal(result.ok, true); assert.deepEqual(result.library, [first(), second()]); assert.equal(result.selectedId, second().id);
  result.library[0].name = 'Changed'; result.library[1].bosses[0].x = 33;
  assert.equal(JSON.stringify({library, imported}), before);
});

test('colliding import requires explicit replacement, preserves other drills, and makes no partial writes', () => {
  const library = [first(), second()];
  const changed = {...first(), name: 'Updated first'};
  const imported = parseDrillImport(JSON.stringify(changed));
  assert.deepEqual(mergeDrillImport(library, imported), {ok: false, reason: 'collision', collisions: [{id: first().id, name: 'Updated first'}]});
  assert.deepEqual(library, [first(), second()]);
  const replaced = mergeDrillImport(library, imported, {replace: true});
  assert.deepEqual(replaced.library, [second(), changed]); assert.equal(replaced.selectedId, first().id);
  assert.equal(mergeDrillImport(library, {ok: true, drills: [changed, {...second(), seed: -1}]}).ok, false);
  assert.deepEqual(library, [first(), second()]);
});

test('library count and UTF-8 byte bounds hold before any merging', () => {
  const library = Array.from({length: MAX_DRILL_LIBRARY_SIZE}, (_, index) => createDrill({id: `drill-${index}`}));
  assert.equal(parseDrillImport(exportDrillLibrary(library)).ok, true);
  assert.equal(mergeDrillImport(library, parseDrillImport(JSON.stringify(first()))).ok, false);
  assert.equal(parseDrillImport(JSON.stringify({version: 1, drills: [...library, first()]})).ok, false);
  const text = JSON.stringify(first()).replace('First practice', '練'.repeat(Math.ceil(MAX_DRILL_IMPORT_BYTES / 3)));
  assert.ok(text.length < MAX_DRILL_IMPORT_BYTES);
  assert.match(parseDrillImport(text).reason, /too large/);
});

test('generated IDs fit safe schema and do not repeat', () => {
  const ids = Array.from({length: 1000}, newDrillId);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
});

test('canvas mapping preserves world coordinates at native, wide and tall aspect ratios', () => {
  assert.deepEqual(editorViewport(1000, 560), {scale: 1, x: 0, y: 0});
  assert.deepEqual(editorPoint(260, 160, {left: 10, top: 20, width: 500, height: 280}), {x: 500, y: 280});
  assert.deepEqual(editorPoint(1010, 300, {left: 10, top: 20, width: 2000, height: 560}), {x: 500, y: 280});
  assert.equal(editorPoint(20, 300, {left: 10, top: 20, width: 2000, height: 560}), null);
  assert.deepEqual(editorPoint(510, 520, {left: 10, top: 20, width: 1000, height: 1000}), {x: 500, y: 280});
  assert.equal(editorPoint(510, 100, {left: 10, top: 20, width: 1000, height: 1000}), null);
  assert.deepEqual(editorPoint(2, 559, {left: 0, top: 0, width: 1000, height: 560}), {x: 30, y: 530});
  assert.equal(editorPoint(0, 0, {left: 0, top: 0, width: 0, height: 0}), null);
});


test('aimed preview points directly at player even with old imported angle/direction', () => {
  const lines = [];
  const ctx = new Proxy({
    lineTo(x, y) { lines.push([x, y]); },
    createRadialGradient() { return {addColorStop() {}}; },
  }, {get(target, key) { return key in target ? target[key] : () => {}; }});
  const canvas = {width: 1000, height: 560, getContext: () => ctx};
  const rule = {id: 'aimed', kind: 'projectiles', pattern: 'aimed', count: 1, placement: {mode: 'fixed', x: 500, y: 200}, size: 8, angle: 90, direction: 'sequence', angleStep: 40};
  const draft = {...first(), playerStart: {x: 500, y: 400}, mechanics: [rule]};
  drawEditorPreview(canvas, draft, 'mechanic:aimed');
  assert.ok(lines.some(([x, y]) => x === 500 && y === 300));
  assert.equal(lines.some(([x, y]) => x === 400 && y === 200), false);
});
