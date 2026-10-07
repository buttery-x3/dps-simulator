import test from 'node:test';
import assert from 'node:assert/strict';
import {ABILITIES, DEFAULT_LOADOUT, TALENT_BUDGET, validateLoadout, validateLoadoutDraft} from '../src/lib/catalogue.js';
import {LOADOUT_STORAGE_KEY, loadLoadout, saveLoadout} from '../src/lib/loadout-storage.js';
import {STORAGE_KEY as KEYS_STORAGE_KEY} from '../src/lib/keybindings.js';

const memory = value => {
  const data = new Map(value === undefined ? [] : [[LOADOUT_STORAGE_KEY, value]]);
  return {data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value)};
};
const payload = loadout => JSON.stringify({version: 1, loadout});
const chosen = {abilities: ['chain-strike', 'veil-bolt', 'gloam-thread'], talents: {'chain-strike': 'v3', 'veil-bolt': 'v1'}};

test('missing storage restores fresh defaults without writing or aliasing catalogue data', () => {
  const storage = memory();
  const result = loadLoadout(storage);
  assert.equal(result.status, 'default'); assert.deepEqual(result.loadout, DEFAULT_LOADOUT);
  result.loadout.abilities.pop(); result.loadout.talents['veil-bolt'] = 'v1';
  assert.deepEqual(loadLoadout(storage).loadout, DEFAULT_LOADOUT); assert.equal(storage.data.size, 0);
});

test('round-trips ordered slots and talents separately from keybindings', () => {
  const storage = memory(); storage.data.set(KEYS_STORAGE_KEY, 'unrelated keys');
  assert.equal(saveLoadout(chosen, storage).ok, true);
  assert.deepEqual(loadLoadout(storage), {loadout: chosen, status: 'loaded'});
  assert.deepEqual(JSON.parse(storage.data.get(LOADOUT_STORAGE_KEY)), {version: 1, loadout: chosen});
  assert.equal(storage.data.get(KEYS_STORAGE_KEY), 'unrelated keys');
  const loaded = loadLoadout(storage); loaded.loadout.abilities.reverse();
  assert.deepEqual(loadLoadout(storage).loadout, chosen);
});

test('all five one-per-ability talents survive, and explicit base choices normalize away', () => {
  const storage = memory(); const abilities = [...DEFAULT_LOADOUT.abilities];
  const talents = Object.fromEntries(abilities.map(id => [id, ABILITIES.find(ability => ability.id === id).talents[0].id]));
  assert.equal(Object.keys(talents).length, TALENT_BUDGET);
  assert.equal(saveLoadout({abilities, talents}, storage).ok, true);
  assert.deepEqual(loadLoadout(storage).loadout, {abilities, talents});
  assert.equal(saveLoadout({abilities, talents: {'veil-bolt': 'base', 'gloam-thread': null}}, storage).ok, true);
  assert.deepEqual(loadLoadout(storage).loadout.talents, {});
});

test('an intentional empty draft persists but never becomes a playable loadout', () => {
  const empty = {abilities: [], talents: {}}; const storage = memory();
  assert.equal(validateLoadoutDraft(empty).valid, true); assert.equal(validateLoadout(empty).valid, false);
  assert.equal(saveLoadout(empty, storage).ok, true);
  assert.deepEqual(loadLoadout(storage), {loadout: empty, status: 'loaded'});
  assert.equal(validateLoadoutDraft({abilities: [], talents: {'veil-bolt': 'v1'}}).valid, false);
});

test('salvages valid ordered choices and removes stale IDs, duplicates and detached/invalid talents', () => {
  const storage = memory(payload({abilities: ['gone', 'chain-strike', 'veil-bolt', 'chain-strike', 'gloam-thread', 3], talents: {'gone': 'v1', 'veil-bolt': 'old-talent', 'chain-strike': 'v2', 'astral-flare': 'v1'}}));
  assert.deepEqual(loadLoadout(storage), {status: 'repaired', loadout: {abilities: ['chain-strike', 'veil-bolt', 'gloam-thread'], talents: {'chain-strike': 'v2'}}});
  assert.equal(validateLoadout(loadLoadout(storage).loadout).valid, true);
});

test('caps stale oversize selections at five without changing their retained order', () => {
  const abilities = ABILITIES.map(ability => ability.id).reverse();
  const storage = memory(payload({abilities, talents: Object.fromEntries(abilities.map(id => [id, 'v1']))}));
  const result = loadLoadout(storage);
  assert.equal(result.status, 'repaired'); assert.deepEqual(result.loadout.abilities, abilities.slice(0, 5));
  assert.equal(Object.keys(result.loadout.talents).length, 5); assert.equal(validateLoadout(result.loadout).valid, true);
});

for (const raw of ['{', '', 'null', '[]', '{}', JSON.stringify({version: 2, loadout: chosen}), payload({abilities: 'veil-bolt'}), payload({abilities: ['gone'], talents: {}}), ' '.repeat(32001)]) {
  test(`corrupt/unsupported storage falls back safely: ${raw.slice(0, 60)}`, () => {
    assert.deepEqual(loadLoadout(memory(raw)), {status: 'corrupt', loadout: DEFAULT_LOADOUT});
  });
}

for (const talents of [null, [], 'v1', {'veil-bolt': ['v1', 'v2']}, {'veil-bolt': {id: 'v1'}}]) {
  test(`repairs malformed talent data: ${JSON.stringify(talents)}`, () => {
    const result = loadLoadout(memory(payload({abilities: ['veil-bolt'], talents})));
    assert.deepEqual(result, {status: 'repaired', loadout: {abilities: ['veil-bolt'], talents: {}}});
  });
}

test('hostile JSON property names never enter the restored selection', () => {
  const result = loadLoadout(memory('{"version":1,"loadout":{"abilities":["__proto__","veil-bolt"],"talents":{"__proto__":"v1","constructor":"v2","veil-bolt":"v1"}}}'));
  assert.deepEqual(result, {status: 'repaired', loadout: {abilities: ['veil-bolt'], talents: {'veil-bolt': 'v1'}}});
  assert.equal(Object.hasOwn(result.loadout.talents, '__proto__'), false);
});

for (const invalid of [null, {}, {abilities: ['missing']}, {abilities: ['veil-bolt', 'veil-bolt']}, {abilities: ABILITIES.map(item => item.id)}, {abilities: ['veil-bolt'], talents: {'veil-bolt': ['v1', 'v2']}}, {...chosen, totalDamage: 1000}]) {
  test(`invalid saves leave the previously stored selection alone: ${JSON.stringify(invalid)}`, () => {
    const storage = memory(payload(chosen)); const previous = storage.data.get(LOADOUT_STORAGE_KEY);
    assert.equal(saveLoadout(invalid, storage).ok, false); assert.equal(storage.data.get(LOADOUT_STORAGE_KEY), previous);
  });
}

test('storage absence and get/set exceptions are graceful', () => {
  for (const storage of [null, {}, {getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); }}]) {
    assert.equal(loadLoadout(storage).status, 'unavailable'); assert.equal(saveLoadout(chosen, storage).ok, false);
  }
});

test('the localStorage property itself may be blocked without crashing import/load/save', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() { throw Error('blocked getter'); }});
  try { assert.equal(loadLoadout().status, 'unavailable'); assert.equal(saveLoadout(chosen).ok, false); }
  finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; }
});
