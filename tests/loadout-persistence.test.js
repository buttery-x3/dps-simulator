import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {flushSync, mount, tick, unmount} from 'svelte';
import App from '../src/App.svelte';
import {ABILITIES, DEFAULT_LOADOUT} from '../src/lib/catalogue.js';
import {DEFAULT_BINDINGS, STORAGE_KEY as BINDINGS_STORAGE_KEY} from '../src/lib/keybindings.js';
import {LOADOUT_STORAGE_KEY} from '../src/lib/loadout-storage.js';

let app, tools, storageDescriptor;
const $ = id => document.getElementById(id);
const tap = element => { element.click(); flushSync(); };
const click = id => tap($(id));
const ability = (id, root = '#helpDialog') => document.querySelector(`${root} [data-ability-option="${id}"]`);
const talent = (id, choice, root = '#helpDialog') => document.querySelector(`${root} [data-ability="${id}"] [data-talent-option="${choice}"]`);
const deck = () => [...document.querySelectorAll('#abilityDeck .ability')].map(button => button.dataset.spell);
const saved = () => JSON.parse(localStorage.getItem(LOADOUT_STORAGE_KEY));
const envelope = loadout => JSON.stringify({version: 1, loadout});
const writesFor = (spy, storageKey) => spy.mock.calls.filter(([key]) => key === storageKey);

function launch() {
  app = mount(App, {target: document.body});
  flushSync();
}

// Preserve the same browser storage object, but create a genuinely fresh App
// instance, including its engine, settings, dialogs, handlers and onMount hook.
async function reload() {
  const storage = localStorage;
  await unmount(app); app = null;
  document.body.replaceChildren();
  launch();
  expect(localStorage).toBe(storage);
}

function key(code, type = 'keydown', target = $('arena')) {
  const event = new KeyboardEvent(type, {code, bubbles: true, cancelable: true});
  target.dispatchEvent(event); flushSync();
  return event;
}

function setBinding(slot, code) {
  const button = document.querySelector(`[data-binding-slot="${slot}"]`);
  tap(button); key(code, 'keydown', button);
}

function runFrame(now) {
  const callback = requestAnimationFrame.mock.calls.at(-1)[0];
  flushSync(() => callback(now));
}

function expectSelection(loadout) {
  expect(deck()).toEqual(loadout.abilities);
  expect(app.sim.loadout).toEqual(loadout);
  expect(document.querySelectorAll('#helpDialog .ability-orb.selected')).toHaveLength(loadout.abilities.length);
  expect(document.querySelectorAll('#helpDialog .talent-orb.selected')).toHaveLength(Object.keys(loadout.talents).length);
  for (const id of loadout.abilities) {
    expect(ability(id).getAttribute('aria-pressed')).toBe('true');
    for (const choice of ABILITIES.find(item => item.id === id).talents) {
      expect(talent(id, choice.id).getAttribute('aria-pressed')).toBe(String(loadout.talents[id] === choice.id));
    }
  }
}

beforeEach(() => {
  app = null; tools = new Map();
  storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  localStorage.clear();
  document.body.replaceChildren(); document.hidden = false; document.hasFocus = () => true;
  document.modelContext = {registerTool(tool) { tools.set(tool.name, tool); }};
});

afterEach(async () => {
  if (app) await unmount(app);
  app = null;
  vi.restoreAllMocks();
  if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
  else delete globalThis.localStorage;
  document.body.replaceChildren();
  delete document.modelContext;
});

describe('saved loadout reloads', () => {
  test('first visit keeps five base abilities and does not write storage during hydration', async () => {
    const write = vi.spyOn(localStorage, 'setItem');
    launch();
    expectSelection(DEFAULT_LOADOUT);
    expect(app.sim.keybindings).toEqual(DEFAULT_BINDINGS);
    expect(document.querySelector('.setup-count').textContent).toContain('5 talent points available');
    expect($('startBtn').disabled).toBe(false);
    expect($('loadoutNotice')).toBeNull();
    expect(write).not.toHaveBeenCalled();
    await reload();
    expectSelection(DEFAULT_LOADOUT);
    expect(write).not.toHaveBeenCalled();
  });

  test('restores five ordered abilities, all five talents and independent custom slot keys', async () => {
    const loadout = {
      abilities: ['focused-energy', 'chain-strike', 'destructive-rift', 'gloam-thread', 'astral-flare'],
      talents: {'focused-energy': 'v3', 'chain-strike': 'v2', 'destructive-rift': 'v1', 'gloam-thread': 'v2', 'astral-flare': 'v3'},
    };
    const bindings = ['KeyQ', 'Digit2', 'Digit3', 'Digit4', 'Numpad5'];
    launch();
    flushSync(() => app.configure({loadout}));
    const loadoutRaw = localStorage.getItem(LOADOUT_STORAGE_KEY);
    click('keybindingsBtn'); setBinding(0, 'KeyQ'); setBinding(4, 'Numpad5'); click('saveKeybindings');
    expect(localStorage.getItem(LOADOUT_STORAGE_KEY)).toBe(loadoutRaw);
    expect(saved()).toEqual({version: 1, loadout});
    expect(JSON.parse(localStorage.getItem(BINDINGS_STORAGE_KEY))).toEqual({version: 1, bindings});
    const write = vi.spyOn(localStorage, 'setItem');
    await reload();
    expectSelection(loadout);
    expect(app.sim.keybindings).toEqual(bindings);
    expect(app.sim.spells.map(spell => spell.keyCode)).toEqual(bindings);
    expect(app.sim.spells.map(spell => spell.talentId)).toEqual(loadout.abilities.map(id => loadout.talents[id]));
    expect(document.querySelector('.setup-count').textContent).toContain('0 talent points available');
    expect(document.querySelector('#helpDialog [data-slot="Q"]').textContent).toContain('Focused Energy');
    expect(document.querySelector('[data-spell="astral-flare"]').getAttribute('aria-label')).toMatch(/^Num 5\./);
    expect(write).not.toHaveBeenCalled();
    click('startBtn'); key('KeyQ');
    expect(app.sim.castCounts['focused-energy']).toBe(1);
  });

  test('a partial selection keeps empty slots and unspent talents after reload', async () => {
    launch(); click('helpBtn');
    for (const id of DEFAULT_LOADOUT.abilities.filter(id => !['veil-bolt', 'lingering-glimmer'].includes(id))) tap(ability(id));
    tap(talent('lingering-glimmer', 'v2'));
    const loadout = {abilities: ['veil-bolt', 'lingering-glimmer'], talents: {'lingering-glimmer': 'v2'}};
    expect(saved()).toEqual({version: 1, loadout});
    await reload();
    expectSelection(loadout);
    expect(document.querySelectorAll('#helpDialog .loadout-slots .empty')).toHaveLength(3);
    expect(document.querySelector('.setup-count').textContent).toContain('4 talent points available');
    expect($('startBtn').disabled).toBe(false);
    click('startBtn'); key('Digit3');
    expect(app.sim.cast).toBeNull();
    key('Digit2'); expect(app.sim.castCounts['lingering-glimmer']).toBe(1);
  });

  test('an intentionally empty draft survives reload, blocks Start, and can be repaired in the picker', async () => {
    launch(); click('helpBtn');
    tap(talent(DEFAULT_LOADOUT.abilities[0], 'v1'));
    for (const id of DEFAULT_LOADOUT.abilities) tap(ability(id));
    expect(saved()).toEqual({version: 1, loadout: {abilities: [], talents: {}}});
    await reload();
    expect(deck()).toEqual([]);
    expect(document.querySelectorAll('#helpDialog .ability-orb.selected')).toHaveLength(0);
    expect(document.querySelectorAll('#helpDialog .talent-orb.selected')).toHaveLength(0);
    expect(document.querySelectorAll('#helpDialog .loadout-slots .empty')).toHaveLength(5);
    expect($('startBtn').disabled).toBe(true);
    expect($('overlayAction').disabled).toBe(true);
    expect($('loadoutNotice')).toBeNull();
    expect(app.startSession()).toMatchObject({ok: false});
    expect(app.sim.phase).toBe('ready');
    const readback = await tools.get('read_training_session').execute({});
    expect(readback.setup.loadout).toEqual({abilities: [], talents: {}});
    expect(readback.loadout).toEqual({abilities: [], talents: {}});
    expect(readback.setupValid).toBe(false);
    expect(readback.setupErrors.length).toBeGreaterThan(0);
    expect(readback.availableSpells).toEqual([]);
    expect(readback.storedCharges).toEqual({});
    click('keybindingsBtn');
    expect([...document.querySelectorAll('.keybinding-list strong')].map(node => node.textContent)).toEqual(Array(5).fill('Empty slot'));
    setBinding(0, 'KeyQ'); click('saveKeybindings');
    expect(saved().loadout).toEqual({abilities: [], talents: {}});
    click('helpBtn'); tap(ability('chain-strike'));
    expect(saved().loadout).toEqual({abilities: ['chain-strike'], talents: {}});
    click('helpDone'); click('startBtn');
    expect(app.sim.phase).toBe('running');
    expect(app.sim.loadout.abilities).toEqual(['chain-strike']);
    const repaired = await tools.get('read_training_session').execute({});
    expect(repaired.setupValid).toBe(true);
    expect(repaired.setupErrors).toEqual([]);
    expect(repaired.availableSpells.map(spell => spell.id)).toEqual(['chain-strike']);
    expect(repaired.availableSpells[0].key).toBe('Q');
  });

  test.each(['running', 'paused', 'stopped'])('reload from %s restores no combat, results or session setup', async phase => {
    const loadout = {abilities: ['lingering-glimmer', 'astral-flare', 'veil-bolt'], talents: {'astral-flare': 'v3'}};
    launch();
    flushSync(() => app.configure({seed: 24680, mechanics: false, layout: 'clustered', loadout}));
    click('startBtn');
    flushSync(() => app.castSpell('lingering-glimmer')); app.sim.advance(3);
    flushSync(() => app.castSpell('astral-flare')); app.sim.advance(2);
    app.sim.spawnWave(); app.sim.select(app.sim.targets[1].id);
    app.sim.setMovement(1, 0); app.sim.advance(.5); app.sim.setMovement(0, 0);
    flushSync(() => app.castSpell('veil-bolt'));
    app.sim.shards = 2; flushSync(() => app.renderHud());
    expect(app.sim.totalDamage).toBeGreaterThan(0);
    expect(app.sim.targets).toHaveLength(3);
    expect(app.sim.player.x).toBeGreaterThan(500);
    if (phase === 'paused') flushSync(() => app.pauseSession());
    if (phase === 'stopped') {
      flushSync(() => app.stopSession());
      expect(app.sim.summary.totalDamage).toBeGreaterThan(0);
      expect($('summaryDialog').open).toBe(true);
    }
    expect(app.sim.phase).toBe(phase);
    expect(saved()).toEqual({version: 1, loadout});
    await reload();
    expectSelection(loadout);
    expect(app.sim.phase).toBe('ready');
    expect(app.sim.seed).toBe(72821);
    expect(app.sim.layout).toBe('spread');
    expect(app.sim.mechanics).toBe(true);
    expect($('seedInput').value).toBe('72821');
    expect($('layoutInput').value).toBe('spread');
    expect($('mechanicsInput').checked).toBe(true);
    expect(app.sim.time).toBe(0);
    expect(app.sim.totalDamage).toBe(0);
    expect(app.sim.damageTaken).toBe(0);
    expect(app.sim.castCounts).toEqual({});
    expect(app.sim.summary).toBeNull();
    expect(app.sim.cast).toBeNull();
    expect(app.sim.resource.value).toBe(0);
    expect(app.sim.player).toMatchObject({x: 500, y: 445});
    expect(app.sim.input).toEqual({x: 0, y: 0});
    expect(app.sim.targets).toHaveLength(1);
    expect(app.sim.selectedId).toBe('dummy');
    expect(app.sim.targets[0].dots).toEqual({});
    expect(app.sim.hazards).toEqual([]);
    expect(app.sim.buffs).toEqual({});
    expect(Object.values(app.sim.cooldowns).every(value => value === 0)).toBe(true);
    expect(Object.values(app.sim.spellCharges).every(value => value.current === value.max)).toBe(true);
    expect($('summaryDialog').open).toBe(false);
    expect($('helpDialog').open).toBe(false);
    expect($('totalDamage').textContent).toBe('0');
    expect($('startBtn').disabled).toBe(false);
  });
});

describe('loadout autosave entry points and unrelated interactions', () => {
  test('Help orb, talent, reorder and clear controls persist immediately before Help closes', async () => {
    launch(); click('helpBtn');
    const write = vi.spyOn(localStorage, 'setItem');
    tap(talent('veil-bolt', 'v2'));
    expect(saved().loadout.talents).toEqual({'veil-bolt': 'v2'});
    tap(ability('veil-bolt'));
    expect(saved().loadout.talents).toEqual({});
    tap(ability('chain-strike'));
    tap(talent('chain-strike', 'v3'));
    tap(document.querySelector('#helpDialog [aria-label="Move Chain Strike earlier"]'));
    const loadout = {
      abilities: ['lingering-glimmer', 'gloam-thread', 'astral-flare', 'chain-strike', 'area-pulse'],
      talents: {'chain-strike': 'v3'},
    };
    expectSelection(loadout);
    expect(saved()).toEqual({version: 1, loadout});
    expect(writesFor(write, LOADOUT_STORAGE_KEY)).toHaveLength(5);
    expect($('helpDialog').open).toBe(true);
    await reload();
    expectSelection(loadout);
    click('helpBtn'); tap(document.querySelector('#helpDialog .loadout-footer button'));
    expect(saved().loadout).toEqual({...loadout, talents: {}});
    await reload();
    expectSelection({...loadout, talents: {}});
  });

  test('the preplay picker uses the same autosave path as Help', async () => {
    launch();
    const setup = document.querySelector('.preplay-setup');
    // Happy DOM does not implement native summary activation.
    setup.open = true; setup.dispatchEvent(new Event('toggle')); flushSync(); await tick();
    tap(talent('gloam-thread', 'v2', '.preplay-setup'));
    tap(document.querySelector('.preplay-setup [aria-label="Move Gloam Thread earlier"]'));
    const loadout = {abilities: ['veil-bolt', 'gloam-thread', 'lingering-glimmer', 'astral-flare', 'area-pulse'], talents: {'gloam-thread': 'v2'}};
    expect(saved().loadout).toEqual(loadout);
    expect(talent('gloam-thread', 'v2').getAttribute('aria-pressed')).toBe('true');
    await reload();
    expectSelection(loadout);
    expect(document.querySelector('.preplay-setup').open).toBe(false);
  });

  test('repeated Help close, keybinding Save, Cancel and reset never clobber the saved loadout', async () => {
    launch();
    const loadout = {abilities: ['chain-strike', 'gloam-thread'], talents: {'gloam-thread': 'v2'}};
    flushSync(() => app.configure({loadout}));
    const loadoutRaw = localStorage.getItem(LOADOUT_STORAGE_KEY);
    const write = vi.spyOn(localStorage, 'setItem');
    for (const close of ['helpDone', 'closeHelp', 'cancel', 'helpDone']) {
      click('helpBtn');
      if (close === 'cancel') { $('helpDialog').dispatchEvent(new Event('cancel', {cancelable: true})); flushSync(); }
      else click(close);
      expect($('helpDialog').open).toBe(false);
      expect(localStorage.getItem(LOADOUT_STORAGE_KEY)).toBe(loadoutRaw);
    }
    click('helpBtn'); click('helpKeybindings');
    setBinding(0, 'KeyQ'); click('saveKeybindings');
    const bindingRaw = localStorage.getItem(BINDINGS_STORAGE_KEY);
    click('keybindingsBtn'); setBinding(0, 'KeyE'); click('cancelKeybindings');
    expect(localStorage.getItem(BINDINGS_STORAGE_KEY)).toBe(bindingRaw);
    click('keybindingsBtn'); click('resetKeybindings'); click('cancelKeybindings');
    expect(localStorage.getItem(BINDINGS_STORAGE_KEY)).toBe(bindingRaw);
    click('keybindingsBtn'); setBinding(1, 'KeyR'); click('saveKeybindings');
    expect(writesFor(write, LOADOUT_STORAGE_KEY)).toHaveLength(0);
    expect(localStorage.getItem(LOADOUT_STORAGE_KEY)).toBe(loadoutRaw);
    await reload();
    expectSelection(loadout);
    expect(app.sim.keybindings).toEqual(['KeyQ', 'KeyR', 'Digit3', 'Digit4', 'Digit5']);
  });

  test('frames, casts, movement keyup, pause, resume, Stop and restart do not write storage', async () => {
    launch();
    flushSync(() => app.configure({loadout: {abilities: ['lingering-glimmer', 'veil-bolt'], talents: {}}}));
    const loadoutRaw = localStorage.getItem(LOADOUT_STORAGE_KEY);
    const write = vi.spyOn(localStorage, 'setItem');
    const now = performance.now(); vi.spyOn(performance, 'now').mockReturnValue(now);
    click('startBtn'); await tick();
    key('Digit1'); key('KeyW'); key('KeyW', 'keyup'); key('Digit1', 'keyup');
    for (let frame = 1; frame <= 8; frame++) runFrame(now + frame * 20);
    click('pauseBtn'); runFrame(now + 300);
    click('pauseBtn'); await tick(); runFrame(now + 100);
    click('helpBtn'); click('helpResume'); await tick();
    click('stopBtn'); click('restartBtn'); await tick();
    expect(write).not.toHaveBeenCalled();
    expect(localStorage.getItem(LOADOUT_STORAGE_KEY)).toBe(loadoutRaw);
    await reload();
    expect(write).not.toHaveBeenCalled();
  });

  test('configure and WebMCP persist canonical selections through the same path without saving other setup', async () => {
    launch();
    const write = vi.spyOn(localStorage, 'setItem');
    flushSync(() => app.configure({seed: 345, layout: 'clustered', mechanics: false}));
    expect(write).not.toHaveBeenCalled();
    flushSync(() => app.configure({loadout: {abilities: ['veil-bolt'], talents: {'veil-bolt': 'base'}}}));
    expect(saved()).toEqual({version: 1, loadout: {abilities: ['veil-bolt'], talents: {}}});
    const loadout = {abilities: ['gloam-thread', 'chain-strike'], talents: {'gloam-thread': 'v1'}};
    const result = await tools.get('configure_training_session').execute({loadout, seed: 987}); flushSync();
    expect(result).toMatchObject({loadout, seed: 987, layout: 'clustered', mechanics: false});
    expect(saved()).toEqual({version: 1, loadout});
    expect(writesFor(write, LOADOUT_STORAGE_KEY)).toHaveLength(2);
    expect(writesFor(write, BINDINGS_STORAGE_KEY)).toHaveLength(0);
    await reload();
    expectSelection(loadout);
    expect(app.sim.seed).toBe(72821);
    expect(app.sim.layout).toBe('spread');
    expect(app.sim.mechanics).toBe(true);
  });

  test('invalid configuration is rejected atomically without any save or changing the previous selection', async () => {
    launch();
    const loadout = {abilities: ['chain-strike', 'veil-bolt'], talents: {'veil-bolt': 'v2'}};
    flushSync(() => app.configure({seed: 123, loadout}));
    const loadoutRaw = localStorage.getItem(LOADOUT_STORAGE_KEY);
    const write = vi.spyOn(localStorage, 'setItem');
    for (const next of [
      {seed: -1, loadout: {abilities: ['gloam-thread']}},
      {seed: 456, loadout: {abilities: ['missing'], talents: {}}},
      {loadout: {abilities: [], talents: {}}},
      {loadout: {abilities: ['veil-bolt', 'veil-bolt'], talents: {}}},
      {loadout: {abilities: ['veil-bolt'], talents: {'veil-bolt': 'missing'}}},
      {loadout: {abilities: ['veil-bolt'], talents: {'chain-strike': 'v1'}}},
      {layout: 'random', loadout: {abilities: ['gloam-thread']}},
      {mechanics: 'false', loadout: {abilities: ['gloam-thread']}},
    ]) {
      expect(() => app.configure(next)).toThrow(); flushSync();
      expectSelection(loadout);
      expect(app.sim.seed).toBe(123);
      expect(localStorage.getItem(LOADOUT_STORAGE_KEY)).toBe(loadoutRaw);
    }
    await expect(tools.get('configure_training_session').execute({loadout, unexpected: true})).rejects.toThrow(/Invalid/);
    await expect(tools.get('configure_training_session').execute({loadout: {abilities: []}})).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
    click('startBtn');
    expect(() => app.configure({loadout: DEFAULT_LOADOUT})).toThrow(/Stop/);
    click('pauseBtn');
    expect(() => app.configure({loadout: DEFAULT_LOADOUT})).toThrow(/Stop/);
    expect(write).not.toHaveBeenCalled();
    expect(localStorage.getItem(LOADOUT_STORAGE_KEY)).toBe(loadoutRaw);
  });
});

describe('loadout storage recovery in the compiled app', () => {
  test.each([
    ['invalid JSON', '{bad json'],
    ['unknown version', JSON.stringify({version: 999, loadout: {abilities: ['chain-strike'], talents: {}}})],
    ['entirely stale ability IDs', envelope({abilities: ['retired-spell'], talents: {'retired-spell': 'v1'}})],
  ])('%s falls back with a notice and leaves independent saved keys intact', async (_name, raw) => {
    const bindings = ['KeyQ', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
    localStorage.setItem(LOADOUT_STORAGE_KEY, raw);
    localStorage.setItem(BINDINGS_STORAGE_KEY, JSON.stringify({version: 1, bindings}));
    const write = vi.spyOn(localStorage, 'setItem');
    launch();
    expectSelection(DEFAULT_LOADOUT);
    expect(app.sim.keybindings).toEqual(bindings);
    expect($('loadoutNotice').getAttribute('role')).toBe('status');
    expect($('loadoutNotice').textContent).toContain('could not be restored');
    expect($('loadoutNotice').textContent).toContain('default abilities');
    expect(write).not.toHaveBeenCalled();
    expect(localStorage.getItem(LOADOUT_STORAGE_KEY)).toBe(raw);
    click('helpBtn'); tap(talent('veil-bolt', 'v1'));
    expect($('loadoutNotice')).toBeNull();
    expect(saved().loadout.talents).toEqual({'veil-bolt': 'v1'});
    await reload();
    expect($('loadoutNotice')).toBeNull();
    expect(app.sim.loadout.talents).toEqual({'veil-bolt': 'v1'});
    expect(app.sim.keybindings).toEqual(bindings);
    click('startBtn'); key('KeyQ');
    expect(app.sim.castCounts['veil-bolt']).toBe(1);
  });

  test('stale IDs and talents are repaired in saved order, disclosed, and saved only on a later edit', async () => {
    const raw = envelope({
      abilities: ['retired-spell', 'chain-strike', 'gloam-thread', 'chain-strike', 'veil-bolt'],
      talents: {'retired-spell': 'v1', 'chain-strike': 'retired-talent', 'gloam-thread': 'v2', 'area-pulse': 'v1'},
    });
    const repaired = {abilities: ['chain-strike', 'gloam-thread', 'veil-bolt'], talents: {'gloam-thread': 'v2'}};
    localStorage.setItem(LOADOUT_STORAGE_KEY, raw);
    const write = vi.spyOn(localStorage, 'setItem');
    launch();
    expectSelection(repaired);
    expect($('loadoutNotice').textContent).toContain('unavailable or invalid choices were removed');
    expect($('loadoutNotice').textContent).toContain('Review your loadout');
    expect(write).not.toHaveBeenCalled();
    expect(localStorage.getItem(LOADOUT_STORAGE_KEY)).toBe(raw);
    await reload();
    expectSelection(repaired);
    click('helpBtn'); tap(talent('chain-strike', 'v1'));
    expect(saved().loadout).toEqual({...repaired, talents: {...repaired.talents, 'chain-strike': 'v1'}});
    expect($('loadoutNotice')).toBeNull();
    expect(writesFor(write, LOADOUT_STORAGE_KEY)).toHaveLength(1);
  });

  test('corrupt keybindings do not discard a valid saved loadout', () => {
    const loadout = {abilities: ['chain-strike', 'gloam-thread'], talents: {'gloam-thread': 'v2'}};
    localStorage.setItem(LOADOUT_STORAGE_KEY, envelope(loadout));
    localStorage.setItem(BINDINGS_STORAGE_KEY, '{bad json');
    launch();
    expectSelection(loadout);
    expect(app.sim.keybindings).toEqual(DEFAULT_BINDINGS);
    expect($('loadoutNotice')).toBeNull();
    expect($('keybindingNotice').textContent).toContain('invalid');
    click('keybindingsBtn'); setBinding(0, 'KeyQ'); click('saveKeybindings');
    expect(saved().loadout).toEqual(loadout);
  });

  test('a throwing localStorage getter keeps the app usable and explains visit-only loadouts', () => {
    Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() { throw new Error('Storage blocked'); }});
    expect(launch).not.toThrow();
    expectSelection(DEFAULT_LOADOUT);
    expect($('loadoutNotice').textContent).toContain('storage is unavailable');
    expect($('loadoutNotice').textContent).toContain('this visit only');
    click('helpBtn'); tap(talent('veil-bolt', 'v1'));
    expect(app.sim.loadout.talents).toEqual({'veil-bolt': 'v1'});
    expect($('loadoutNotice').textContent).toContain('Loadout applied for this visit only');
    click('helpDone'); click('startBtn'); key('Digit1');
    expect(app.sim.castCounts['veil-bolt']).toBe(1);
  });

  test('a throwing getItem falls back gracefully without preventing later saves', async () => {
    const read = vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('Read blocked'); });
    expect(launch).not.toThrow();
    expectSelection(DEFAULT_LOADOUT);
    expect($('loadoutNotice').textContent).toContain('storage is unavailable');
    read.mockRestore();
    const loadout = {abilities: ['chain-strike'], talents: {'chain-strike': 'v2'}};
    flushSync(() => app.configure({loadout}));
    expect(saved()).toEqual({version: 1, loadout});
    expect($('loadoutNotice')).toBeNull();
    await reload();
    expectSelection(loadout);
  });

  test('a throwing setItem applies this visit only, preserves old data, and recovers on the next successful edit', async () => {
    const previous = {abilities: ['veil-bolt'], talents: {}};
    localStorage.setItem(LOADOUT_STORAGE_KEY, envelope(previous));
    launch();
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
    click('helpBtn'); tap(ability('chain-strike')); tap(talent('chain-strike', 'v2'));
    const current = {abilities: ['veil-bolt', 'chain-strike'], talents: {'chain-strike': 'v2'}};
    expectSelection(current);
    expect($('loadoutNotice').textContent).toContain('Loadout applied for this visit only');
    expect($('loadoutNotice').textContent).toContain('storage is unavailable');
    expect(saved().loadout).toEqual(previous);
    click('helpDone'); click('startBtn'); key('Digit2');
    expect(app.sim.castCounts['chain-strike']).toBe(1);
    write.mockRestore();
    await reload();
    expectSelection(previous);
    flushSync(() => app.configure({loadout: current}));
    expect($('loadoutNotice')).toBeNull();
    await reload();
    expectSelection(current);
  });
});
