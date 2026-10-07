/**
 * Local, slot-owned spell shortcuts. KeyboardEvent.code identifies a physical
 * key: letter case/layout and Num Lock never change its assigned slot. Labels
 * describe the physical key's usual US keycap, not the active keyboard layout.
 * Numpad digits and +, -, *, /, ., comma and = are separate from the main keys.
 */
export const DEFAULT_BINDINGS = Object.freeze(['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5']);
export const MOVE_KEYS = Object.freeze(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
export const STORAGE_KEY = 'veilweaver.keybindings.v1';

const VERSION = 1;
const KEY_LABELS = Object.freeze({
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Space: 'Space',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *', NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .', NumpadComma: 'Num ,', NumpadEqual: 'Num =',
});
const RESERVED_LABELS = Object.freeze({Escape: 'Esc', Enter: 'Enter', NumpadEnter: 'Num Enter', Tab: 'Tab', Backspace: 'Backspace'});
const RESERVED_KEYS = new Set([...MOVE_KEYS, 'KeyP', ...Object.keys(RESERVED_LABELS)]);
const LETTER = /^Key[A-Z]$/;
const DIGIT = /^Digit[0-9]$/;
const NUMPAD_DIGIT = /^Numpad[0-9]$/;

/** A short ASCII label, including distinct labels for the number pad. */
export function keyLabel(code) {
  if (typeof code !== 'string') return '?';
  if (LETTER.test(code)) return code.slice(3);
  if (DIGIT.test(code)) return code.slice(5);
  if (NUMPAD_DIGIT.test(code)) return `Num ${code.slice(6)}`;
  if (Object.hasOwn(KEY_LABELS, code)) return KEY_LABELS[code];
  if (Object.hasOwn(RESERVED_LABELS, code)) return RESERVED_LABELS[code];
  return code || '?';
}

function codeError(code) {
  if (typeof code !== 'string' || !code) return 'Choose a supported physical key.';
  if (MOVE_KEYS.includes(code)) return `${keyLabel(code)} is reserved for movement.`;
  if (RESERVED_KEYS.has(code)) return `${keyLabel(code)} is reserved for game or browser controls.`;
  if (LETTER.test(code) || DIGIT.test(code) || NUMPAD_DIGIT.test(code) || Object.hasOwn(KEY_LABELS, code)) return null;
  return 'This key is not supported. Use a letter, number, punctuation, arrow, Space, or number-pad key.';
}

/** Validate the entire mapping atomically; partial and duplicate maps fail. */
export function validateBindings(codes) {
  const errors = [];
  if (!Array.isArray(codes) || codes.length !== DEFAULT_BINDINGS.length) {
    return {valid: false, errors: ['Choose exactly five spell keybindings.']};
  }
  const seen = new Map();
  // An indexed loop also rejects holes in sparse arrays.
  for (let slot = 0; slot < codes.length; slot++) {
    const code = codes[slot];
    const reason = codeError(code);
    if (reason) errors.push(`Slot ${slot + 1}: ${reason}`);
    else if (seen.has(code)) errors.push(`${keyLabel(code)} is already bound to slot ${seen.get(code) + 1}.`);
    else seen.set(code, slot);
  }
  return {valid: errors.length === 0, errors};
}

function eventError(event) {
  if (!event || typeof event !== 'object') return 'Press a supported physical key.';
  if (event.isComposing || event.keyCode === 229 || event.key === 'Process' || event.key === 'Dead') return 'Finish text composition before choosing a key.';
  if (event.repeat) return 'Release the key, then press it once.';
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return 'Use a single key without Ctrl, Alt, Meta, or Shift.';
  return codeError(event.code);
}

/** Check a proposed assignment without changing the bindings or the event. */
export function captureBinding(event, bindings, slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= DEFAULT_BINDINGS.length) return {ok: false, reason: 'Choose a spell slot first.'};
  const current = validateBindings(bindings);
  if (!current.valid) return {ok: false, reason: current.errors[0]};
  const reason = eventError(event);
  if (reason) return {ok: false, reason};
  const duplicate = bindings.findIndex((code, index) => index !== slot && code === event.code);
  if (duplicate !== -1) return {ok: false, reason: `${keyLabel(event.code)} is already bound to slot ${duplicate + 1}.`};
  return {ok: true, code: event.code};
}

/** Ignore held, composed and modified keys rather than triggering a spell. */
export function slotForEvent(event, bindings) {
  if (eventError(event) || !validateBindings(bindings).valid) return -1;
  return bindings.indexOf(event.code);
}

/**
 * Resolve storage inside the caller's try/catch. Even reading localStorage can
 * throw in privacy-restricted browsers; importing this module is always safe.
 */
function resolveStorage(storage) {
  return storage === undefined ? globalThis.localStorage : storage;
}

/** Load only a complete versioned mapping; never partially apply corrupt data. */
export function loadBindings(storage) {
  const fallback = status => ({bindings: [...DEFAULT_BINDINGS], status});
  let raw;
  try {
    const target = resolveStorage(storage);
    if (!target || typeof target.getItem !== 'function') return fallback('unavailable');
    raw = target.getItem(STORAGE_KEY);
  } catch {
    return fallback('unavailable');
  }
  if (raw === null) return fallback('default');
  try {
    const saved = JSON.parse(raw);
    if (!saved || Array.isArray(saved) || saved.version !== VERSION || !validateBindings(saved.bindings).valid) return fallback('corrupt');
    return {bindings: [...saved.bindings], status: 'loaded'};
  } catch {
    return fallback('corrupt');
  }
}

/** Storage failure leaves the supplied in-memory mapping intact. */
export function saveBindings(bindings, storage) {
  const result = validateBindings(bindings);
  if (!result.valid) return {ok: false, reason: result.errors[0]};
  try {
    const target = resolveStorage(storage);
    if (!target || typeof target.setItem !== 'function') return {ok: false, reason: 'Browser storage is unavailable. Keybindings will last for this visit only.'};
    target.setItem(STORAGE_KEY, JSON.stringify({version: VERSION, bindings: [...bindings]}));
    return {ok: true};
  } catch {
    return {ok: false, reason: 'Could not save keybindings. They will last for this visit only.'};
  }
}
