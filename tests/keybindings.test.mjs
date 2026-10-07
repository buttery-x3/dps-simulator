import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BINDINGS, MOVE_KEYS, STORAGE_KEY, keyLabel, validateBindings,
  captureBinding, slotForEvent, loadBindings, saveBindings,
} from '../src/lib/keybindings.js';

const defaults = () => [...DEFAULT_BINDINGS];
const event = (code, extra = {}) => ({code, key: '', repeat: false, isComposing: false, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...extra});
const letters = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', letter => `Key${letter}`);
const digits = Array.from({length: 10}, (_, n) => `Digit${n}`);
const numpadDigits = Array.from({length: 10}, (_, n) => `Numpad${n}`);
const namedKeys = {
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Space: 'Space',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *', NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .', NumpadComma: 'Num ,', NumpadEqual: 'Num =',
};
const supported = [...letters.filter(code => ![...MOVE_KEYS, 'KeyP'].includes(code)), ...digits, ...numpadDigits, ...Object.keys(namedKeys)];
const reserved = [...MOVE_KEYS, 'KeyP', 'Escape', 'Enter', 'NumpadEnter', 'Tab', 'Backspace'];
const unsupported = [
  '', 'Keya', 'keyQ', 'KEYQ', 'Q', '1', 'Digit10', 'Numpad10', 'Unidentified', 'Process',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
  'CapsLock', 'NumLock', 'ScrollLock', 'ContextMenu', 'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown',
  'Pause', 'PrintScreen', 'BrowserBack', 'BrowserForward', 'BrowserRefresh', 'BrowserStop', 'BrowserHome',
  'AudioVolumeUp', 'AudioVolumeDown', 'AudioVolumeMute', 'Power', 'Sleep', 'WakeUp',
  'constructor', '__proto__', 'toString', ...Array.from({length: 24}, (_, n) => `F${n + 1}`),
];
const withFirst = code => [code, ...supported.filter(other => other !== code).slice(0, 4)];

function memoryStorage(initial = null) {
  let value = initial;
  const calls = [];
  return {
    calls,
    getItem(key) { calls.push(['get', key]); return value; },
    setItem(key, next) { calls.push(['set', key, next]); value = next; },
    get value() { return value; },
  };
}

test('defaults are five unique frozen digit bindings, with physical WASD reserved', () => {
  assert.deepEqual(DEFAULT_BINDINGS, ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5']);
  assert.deepEqual(MOVE_KEYS, ['KeyW', 'KeyA', 'KeyS', 'KeyD']);
  assert.ok(Object.isFrozen(DEFAULT_BINDINGS));
  assert.ok(Object.isFrozen(MOVE_KEYS));
  assert.deepEqual(validateBindings(DEFAULT_BINDINGS), {valid: true, errors: []});
  assert.equal(STORAGE_KEY, 'veilweaver.keybindings.v1');
  DEFAULT_BINDINGS.forEach((code, slot) => assert.equal(slotForEvent(event(code), DEFAULT_BINDINGS), slot));
});

for (const code of supported) {
  test(`supports the physical ${code} key for capture and casting`, () => {
    const bindings = withFirst(code);
    assert.deepEqual(validateBindings(bindings), {valid: true, errors: []});
    assert.deepEqual(captureBinding(event(code), bindings, 0), {ok: true, code});
    assert.equal(slotForEvent(event(code), bindings), 0);
    assert.match(keyLabel(code), /^[\x20-\x7e]+$/);
  });
}

test('labels cover letters, digits, punctuation, arrows, numpad and reserved controls', () => {
  for (const code of letters) assert.equal(keyLabel(code), code.slice(3));
  for (const code of digits) assert.equal(keyLabel(code), code.slice(5));
  for (const code of numpadDigits) assert.equal(keyLabel(code), `Num ${code.slice(6)}`);
  for (const [code, label] of Object.entries(namedKeys)) assert.equal(keyLabel(code), label);
  assert.equal(keyLabel('Escape'), 'Esc');
  assert.equal(keyLabel('NumpadEnter'), 'Num Enter');
  assert.equal(keyLabel('Enter'), 'Enter');
  assert.equal(keyLabel('Tab'), 'Tab');
  assert.equal(keyLabel('UnknownCode'), 'UnknownCode');
  for (const value of ['', null, undefined, {}, 3]) assert.equal(keyLabel(value), '?');
});

test('numpad keys stay separate from number-row and punctuation keys regardless of Num Lock', () => {
  const bindings = ['Digit1', 'Numpad1', 'Period', 'NumpadDecimal', 'NumpadAdd'];
  assert.equal(validateBindings(bindings).valid, true);
  assert.equal(slotForEvent(event('Digit1', {key: '1'}), bindings), 0);
  assert.equal(slotForEvent(event('Numpad1', {key: '1'}), bindings), 1);
  assert.equal(slotForEvent(event('Numpad1', {key: 'End'}), bindings), 1);
  assert.equal(slotForEvent(event('Period', {key: '.'}), bindings), 2);
  assert.equal(slotForEvent(event('NumpadDecimal', {key: 'Delete'}), bindings), 3);
});

for (const code of [...reserved, ...unsupported]) {
  test(`rejects ${code || '(empty code)'} without changing bindings`, () => {
    const bindings = defaults();
    const attempt = captureBinding(event(code), bindings, 0);
    assert.equal(attempt.ok, false);
    assert.ok(attempt.reason.length);
    const invalid = validateBindings([code, ...DEFAULT_BINDINGS.slice(1)]);
    assert.equal(invalid.valid, false);
    assert.ok(invalid.errors.length);
    assert.equal(slotForEvent(event(code), bindings), -1);
    assert.deepEqual(bindings, DEFAULT_BINDINGS);
  });
}

test('exactly five supported strings are required, including holes and invalid elements', () => {
  for (const value of [null, undefined, {}, '12345', [], ['Digit1'], [...DEFAULT_BINDINGS, 'KeyQ'], Array(5), [1, 2, 3, 4, 5], [null, ...DEFAULT_BINDINGS.slice(1)], [{toString: null}, ...DEFAULT_BINDINGS.slice(1)]]) {
    const result = validateBindings(value);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length);
    assert.equal(slotForEvent(event('Digit1'), value), -1);
    assert.equal(captureBinding(event('KeyQ'), value, 0).ok, false);
  }
});

test('duplicate rejection names the conflicting slot, while reselecting the same key is allowed', () => {
  const bindings = defaults();
  assert.deepEqual(captureBinding(event('Digit1'), bindings, 0), {ok: true, code: 'Digit1'});
  assert.match(captureBinding(event('Digit2'), bindings, 0).reason, /already bound to slot 2/);
  assert.match(validateBindings(['KeyQ', 'KeyQ', 'KeyQ', 'Digit4', 'Digit5']).errors.join(' '), /already bound to slot 1/);
  assert.equal(slotForEvent(event('KeyQ'), ['KeyQ', 'KeyQ', 'KeyE', 'KeyR', 'KeyT']), -1);
  assert.deepEqual(bindings, DEFAULT_BINDINGS);
});

test('capture requires a valid zero-based slot', () => {
  for (const slot of [-1, 5, 99, 1.5, NaN, Infinity, '0', null, undefined]) {
    assert.equal(captureBinding(event('KeyQ'), DEFAULT_BINDINGS, slot).ok, false);
  }
});

test('capture accepts new assignments without mutating inputs or invoking event methods', () => {
  const input = Object.freeze(event('KeyQ', {preventDefault() { assert.fail('pure helper must not mutate the event'); }}));
  assert.deepEqual(captureBinding(input, DEFAULT_BINDINGS, 2), {ok: true, code: 'KeyQ'});
  assert.deepEqual(DEFAULT_BINDINGS, defaults());
});

test('physical codes, not character case or keyboard layout, select the slot', () => {
  const bindings = ['KeyQ', 'KeyE', 'KeyR', 'Digit4', 'Digit5'];
  for (const key of ['q', 'Q', 'a', 'A', '\u03b1']) {
    assert.deepEqual(captureBinding(event('KeyQ', {key}), bindings, 0), {ok: true, code: 'KeyQ'});
    assert.equal(slotForEvent(event('KeyQ', {key}), bindings), 0);
  }
  assert.equal(slotForEvent(event('KeyT', {key: 'Q'}), bindings), -1);
  assert.equal(captureBinding(event('KeyW', {key: 'z'}), bindings, 0).ok, false);
});

test('any modifier combination is rejected both while capturing and casting', () => {
  const modifiers = ['ctrlKey', 'altKey', 'metaKey', 'shiftKey'];
  for (let mask = 1; mask < 16; mask++) {
    const extra = Object.fromEntries(modifiers.map((name, index) => [name, Boolean(mask & (1 << index))]));
    assert.equal(captureBinding(event('Digit1', extra), DEFAULT_BINDINGS, 0).ok, false);
    assert.equal(slotForEvent(event('Digit1', extra), DEFAULT_BINDINGS), -1);
  }
});

test('repeats, IME composition, dead keys and missing events do not capture or cast', () => {
  const invalid = [null, undefined, 2, 'Digit1', {}, {key: '1'}, event('Digit1', {repeat: true}), event('Digit1', {isComposing: true}), event('Digit1', {keyCode: 229}), event('Digit1', {key: 'Process'}), event('Digit1', {key: 'Dead'})];
  for (const input of invalid) {
    assert.equal(captureBinding(input, DEFAULT_BINDINGS, 0).ok, false);
    assert.equal(slotForEvent(input, DEFAULT_BINDINGS), -1);
  }
});

test('bindings remain attached to slot positions after a spell reorder or smaller loadout', () => {
  const bindings = ['KeyQ', 'KeyE', 'KeyR', 'Digit4', 'Digit5'];
  const original = ['veil-bolt', 'lingering-glimmer', 'gloam-thread'];
  const reordered = ['gloam-thread', 'veil-bolt'];
  const slot = slotForEvent(event('KeyQ'), bindings);
  assert.equal(original[slot], 'veil-bolt');
  assert.equal(reordered[slot], 'gloam-thread');
  assert.equal(slotForEvent(event('Digit5'), bindings), 4);
  assert.equal(reordered[slotForEvent(event('Digit5'), bindings)], undefined);
});

test('missing saved preferences return fresh default arrays and do not write storage', () => {
  const storage = memoryStorage();
  const first = loadBindings(storage);
  assert.deepEqual(first, {bindings: defaults(), status: 'default'});
  first.bindings[0] = 'KeyQ';
  assert.deepEqual(loadBindings(storage), {bindings: defaults(), status: 'default'});
  assert.ok(storage.calls.every(([operation, key]) => operation === 'get' && key === STORAGE_KEY));
});

test('saved custom bindings round-trip in a versioned envelope and can be reset', () => {
  const storage = memoryStorage();
  const bindings = ['KeyQ', 'Numpad1', 'BracketLeft', 'ArrowUp', 'Space'];
  assert.deepEqual(saveBindings(bindings, storage), {ok: true});
  assert.deepEqual(JSON.parse(storage.value), {version: 1, bindings});
  assert.deepEqual(loadBindings(storage), {bindings, status: 'loaded'});
  const loaded = loadBindings(storage);
  loaded.bindings[0] = 'KeyE';
  assert.deepEqual(loadBindings(storage).bindings, bindings);
  assert.deepEqual(saveBindings(DEFAULT_BINDINGS, storage), {ok: true});
  assert.deepEqual(loadBindings(storage), {bindings: defaults(), status: 'loaded'});
  assert.ok(storage.calls.every(([, key]) => key === STORAGE_KEY));
});

test('corrupt, old-version and invalid stored preferences fall back atomically without rewriting', () => {
  const corrupt = [
    '', '{', 'undefined', 'null', 'true', '1', '"string"', '{}', '[]',
    JSON.stringify(DEFAULT_BINDINGS),
    ...[undefined, null, 0, 2, '1'].map(version => JSON.stringify({version, bindings: defaults()})),
    ...[null, [], ['KeyQ'], ['KeyQ', 'KeyQ', 'KeyR', 'Digit4', 'Digit5'], ['KeyW', ...DEFAULT_BINDINGS.slice(1)], [null, ...DEFAULT_BINDINGS.slice(1)], [...DEFAULT_BINDINGS, 'KeyQ'], '12345'].map(bindings => JSON.stringify({version: 1, bindings})),
  ];
  for (const raw of corrupt) {
    const storage = memoryStorage(raw);
    assert.deepEqual(loadBindings(storage), {bindings: defaults(), status: 'corrupt'});
    assert.equal(storage.value, raw);
    assert.equal(storage.calls.filter(([operation]) => operation === 'set').length, 0);
  }
});

test('invalid saves leave previous preferences untouched and never access storage', () => {
  const previous = JSON.stringify({version: 1, bindings: defaults()});
  const storage = memoryStorage(previous);
  for (const bindings of [null, [], ['KeyQ', 'KeyQ', 'KeyR', 'Digit4', 'Digit5'], ['KeyP', ...DEFAULT_BINDINGS.slice(1)]]) {
    const result = saveBindings(bindings, storage);
    assert.equal(result.ok, false);
    assert.ok(result.reason.length);
  }
  assert.equal(storage.value, previous);
  assert.equal(storage.calls.length, 0);
});

test('absent, incomplete and throwing storage do not throw or lose the in-memory map', () => {
  const failures = [null, {}, {getItem: null, setItem: null}, {
    getItem() { throw new Error('Read denied'); },
    setItem() { throw new Error('Quota exceeded'); },
  }, {
    get getItem() { throw new Error('Read getter denied'); },
    get setItem() { throw new Error('Write getter denied'); },
  }];
  for (const storage of failures) {
    assert.deepEqual(loadBindings(storage), {bindings: defaults(), status: 'unavailable'});
    const bindings = ['KeyQ', ...DEFAULT_BINDINGS.slice(1)];
    const saved = saveBindings(bindings, storage);
    assert.equal(saved.ok, false);
    assert.match(saved.reason, /this visit only/);
    assert.deepEqual(bindings, ['KeyQ', ...DEFAULT_BINDINGS.slice(1)]);
    assert.equal(slotForEvent(event('KeyQ'), bindings), 0);
  }
});

test('default storage is resolved safely at call time, including a throwing localStorage getter', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: undefined});
    assert.equal(loadBindings().status, 'unavailable');
    assert.equal(saveBindings(DEFAULT_BINDINGS).ok, false);
    Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() { throw new Error('Access denied'); }});
    assert.equal(loadBindings().status, 'unavailable');
    assert.equal(saveBindings(DEFAULT_BINDINGS).ok, false);
    const storage = memoryStorage();
    assert.equal(loadBindings(storage).status, 'default');
    assert.equal(saveBindings(DEFAULT_BINDINGS, storage).ok, true);
    Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: storage});
    assert.deepEqual(loadBindings(), {bindings: defaults(), status: 'loaded'});
    assert.equal(saveBindings(['KeyQ', ...DEFAULT_BINDINGS.slice(1)]).ok, true);
    assert.equal(loadBindings().bindings[0], 'KeyQ');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});
