import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {flushSync, mount, tick, unmount} from 'svelte';
import App from '../src/App.svelte';
import {ABILITIES, DEFAULT_LOADOUT} from '../src/lib/catalogue.js';

let app, tools, signals;
const $ = id => document.getElementById(id);
const update = () => flushSync(() => app.renderHud());
function key(code, type = 'keydown', target = $('arena'), repeat = false) {
  const event = new KeyboardEvent(type, {code, repeat, bubbles: true, cancelable: true});
  target.dispatchEvent(event); flushSync(); return event;
}
function click(id) { $(id).click(); flushSync(); }
function runFrame(now) {
  const callback = requestAnimationFrame.mock.calls.at(-1)[0];
  flushSync(() => callback(now));
}

beforeEach(() => {
  tools = new Map(); signals = [];
  document.body.replaceChildren(); document.hidden = false; document.hasFocus = () => true;
  document.modelContext = {registerTool(tool, options) { tools.set(tool.name, tool); signals.push(options.signal); }};
  app = mount(App, {target: document.body}); flushSync();
});
afterEach(async () => { if (app) await unmount(app); app = null; vi.restoreAllMocks(); document.body.replaceChildren(); });

describe('Svelte parity', () => {
  test('mounts five abilities, initial positioning, one target, and both dialogs', () => {
    expect(document.querySelectorAll('.ability')).toHaveLength(5);
    expect(document.querySelectorAll('.target-card.selected')).toHaveLength(1);
    expect(document.querySelectorAll('#helpDialog .ability-orb')).toHaveLength(8);
    expect(document.querySelectorAll('#helpDialog .talent-orb')).toHaveLength(24);
    expect(document.querySelectorAll('#helpDialog .talent-orb.selected')).toHaveLength(0);
    expect(document.querySelector('.loadout-budget').textContent).toContain('5 talent points available');
    expect($('helpDialog').open).toBe(false);
    expect(app.sim.player.y).toBe(445);
    expect(app.sim.targets[0].y).toBe(160);
  });
  test('removes the standalone void display while preserving resource generation, Rift readiness and restart', () => {
    const expectNoStandaloneStatus = () => {
      expect($('notice')).toBeNull();
      expect(document.body.textContent).not.toContain('Keep your DoT on every target. Save instant casts for movement.');
      expect(document.querySelector('.shards')).toBeNull();
      expect(document.querySelector('[aria-label^="Void resource:"]')).toBeNull();
      expect(document.querySelector('.combat-status').textContent).not.toContain('VOID');
    };
    expectNoStandaloneStatus();
    flushSync(() => app.configure({loadout: {abilities: ['gloam-thread', 'destructive-rift'], talents: {'gloam-thread': 'v2'}}}));
    const rift = document.querySelector('[data-spell="destructive-rift"]');
    expect(rift.querySelector('.ability-state').textContent).toBe('0/3 void');
    expect(rift.classList.contains('is-locked')).toBe(true);
    flushSync(() => app.startSession()); expectNoStandaloneStatus();
    for (let resource = 1; resource <= 3; resource++) {
      flushSync(() => app.castSpell('gloam-thread')); app.sim.advance(3); update();
      expect(app.sim.resource.value).toBe(resource);
      expectNoStandaloneStatus();
    }
    expect(rift.querySelector('.ability-state').textContent).toBe('READY');
    expect(rift.getAttribute('aria-label')).toContain('Destructive Rift. READY');
    expect(rift.classList.contains('is-ready')).toBe(true);
    flushSync(() => app.castSpell('destructive-rift')); app.sim.advance(1.5); update();
    expect(app.sim.resource.value).toBe(0);
    expect(rift.querySelector('.ability-state').textContent).toBe('0/3 void');
    expect(rift.classList.contains('is-ready')).toBe(false);
    flushSync(() => app.pauseSession()); expectNoStandaloneStatus();
    flushSync(() => app.resumeSession()); expectNoStandaloneStatus();
    flushSync(() => app.stopSession()); expectNoStandaloneStatus();
    click('restartBtn'); expectNoStandaloneStatus();
    expect(app.sim.resource.value).toBe(0);
    expect(rift.classList.contains('is-locked')).toBe(true);
  });
  test('start/cast/pause/resume/stop/restart controls use exact engine state', async () => {
    click('startBtn'); await tick();
    expect(app.sim.phase).toBe('running'); expect($('overlay').hidden).toBe(true);
    flushSync(() => app.castSpell('lingering-glimmer')); app.sim.advance(3); update();
    const total = app.sim.totalDamage;
    expect(total).toBeGreaterThan(0);
    expect($('totalDamage').textContent).toBe(Math.round(total).toLocaleString());
    click('pauseBtn'); expect(app.sim.phase).toBe('paused');
    click('pauseBtn'); expect(app.sim.phase).toBe('running');
    click('stopBtn'); expect($('summaryDialog').open).toBe(true);
    expect($('summaryContent').textContent).toContain(Math.round(total).toLocaleString());
    expect(app.sim.summary.totalDamage).toBe(total);
    click('restartBtn'); await tick(); expect(app.sim.totalDamage).toBe(0);
    expect($('summaryDialog').open).toBe(false);
  });
  test('Q/E/R/4/5 dispatch the selected slots and movement cancels a channel', () => {
    flushSync(() => app.startSession());
    expect(key('Digit1').defaultPrevented).toBe(false);
    for (const [index, code] of ['KeyQ', 'KeyE', 'KeyR', 'Digit4', 'Digit5'].entries()) {
      const id = DEFAULT_LOADOUT.abilities[index];
      key(code);
      expect(app.sim.castCounts[id]).toBeGreaterThan(0);
      app.sim.advance(20);
    }
    key('KeyR'); expect(app.sim.cast.spell).toBe('gloam-thread');
    key('KeyW'); expect(app.sim.input.y).toBe(-1); expect(app.sim.cast).toBe(null);
    key('KeyW', 'keyup'); expect(app.sim.input.y).toBe(0);
    const outside = key('KeyQ', 'keydown', $('seedInput')); expect(outside.defaultPrevented).toBe(false);
  });
  test('Tab cycles, repeats do not recast, and Escape pauses/releases focus', () => {
    flushSync(() => app.startSession()); app.sim.spawnWave(); update();
    key('Tab'); expect(app.sim.selectedId).not.toBe('dummy');
    key('KeyQ', 'keydown', $('arena'), true); expect(app.sim.totalDamage).toBe(0);
    key('Escape'); expect(app.sim.phase).toBe('paused'); expect(document.activeElement).not.toBe($('arena'));
  });
  test('Help pause/close/Escape/explicit resume preserve time and clear movement', async () => {
    flushSync(() => app.startSession()); key('KeyW'); click('helpBtn');
    expect(app.sim.phase).toBe('paused'); expect(app.sim.input.y).toBe(0);
    expect($('helpDialog').open).toBe(true); expect($('seedInput').disabled).toBe(true);
    const time = app.sim.time; app.sim.advance(100); expect(app.sim.time).toBe(time);
    $('helpDialog').dispatchEvent(new Event('cancel', {cancelable: true})); flushSync();
    expect($('helpDialog').open).toBe(false); expect(app.sim.phase).toBe('paused');
    click('helpBtn'); click('helpResume'); await tick();
    expect(app.sim.phase).toBe('running'); expect(document.activeElement).toBe($('arena'));
  });
  test('hidden/unfocused pages pause and cannot start or resume', () => {
    flushSync(() => app.startSession()); key('KeyD'); document.hidden = true;
    document.dispatchEvent(new Event('visibilitychange')); flushSync();
    expect(app.sim.phase).toBe('paused'); expect(app.sim.input.x).toBe(0);
    expect(app.resumeSession().ok).toBe(false); expect(app.startSession().ok).toBe(false);
    document.hidden = false; document.hasFocus = () => false;
    expect(app.resumeSession().ok).toBe(false);
    document.hasFocus = () => true; flushSync(() => app.resumeSession());
    window.dispatchEvent(new Event('blur')); flushSync(); expect(app.sim.phase).toBe('paused');
  });
  test('setup and tool settings apply selected slots, talents and echo layout', () => {
    const loadout = {abilities: ['chain-strike', 'gloam-thread'], talents: {'gloam-thread': 'v1'}};
    flushSync(() => app.configure({seed: 123, loadout, mechanics: false, layout: 'clustered'}));
    expect($('seedInput').value).toBe('123'); expect($('mechanicsInput').checked).toBe(false);
    expect($('layoutInput').value).toBe('clustered');
    expect([...document.querySelectorAll('.ability')].map(button => button.dataset.spell)).toEqual(loadout.abilities);
    expect(document.querySelector('[data-spell="chain-strike"]').getAttribute('aria-label')).toMatch(/^Q\./);
    flushSync(() => app.startSession()); expect(app.sim.loadout).toEqual(loadout);
    expect(app.sim.layout).toBe('clustered');
    expect(() => app.configure({seed: 4})).toThrow(/Stop/);
  });
  test('live targets and selected DoT timers render through keyed Svelte elements', () => {
    flushSync(() => app.startSession()); app.sim.spawnWave(); update();
    expect(document.querySelectorAll('.target-card')).toHaveLength(3);
    const id = app.sim.targets[1].id;
    document.querySelector(`[data-target="${id}"]`).click(); flushSync();
    expect(app.sim.selectedId).toBe(id);
    flushSync(() => app.castSpell('lingering-glimmer')); expect(document.querySelector(`[data-target="${id}"] .target-dot`).textContent).toMatch(/\d+\.\d+s/);
    expect(document.querySelector(`[data-target="${id}"] .target-dot`).textContent).not.toContain('No Brand');
  });
  test('readiness communicates stored charges separately from shared resource', () => {
    const loadout = {abilities: ['astral-flare', 'destructive-rift'], talents: {'astral-flare': 'v3'}};
    flushSync(() => app.configure({loadout}));
    flushSync(() => app.startSession());
    app.sim.shards = 3; update();
    expect(document.querySelector('[data-spell="destructive-rift"]').classList.contains('is-ready')).toBe(true);
    expect(document.querySelector('[data-spell="astral-flare"] .ability-state').textContent).toMatch(/charge/i);
    expect(document.querySelector('[data-spell="destructive-rift"]').getAttribute('aria-label')).toContain('READY');
    expect(document.querySelector('.shards')).toBeNull();
    flushSync(() => app.castSpell('astral-flare')); update();
    expect(app.sim.shards).toBe(3);
  });
  test('touch pointerup, cancel and lost capture stop movement; next-target works', () => {
    flushSync(() => app.startSession());
    const button = document.querySelector('[data-move="1,0"]');
    for (const release of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      button.dispatchEvent(new PointerEvent('pointerdown', {pointerId: 1, bubbles: true, cancelable: true}));
      expect(app.sim.input.x).toBe(1); button.dispatchEvent(new PointerEvent(release, {pointerId: 1, bubbles: true}));
      expect(app.sim.input.x).toBe(0);
    }
    app.sim.spawnWave(); click('touchTarget'); expect(app.sim.selectedId).not.toBe('dummy');
  });
  test('real-time frame driver advances normally and pauses on a long stall', () => {
    const now = performance.now(); vi.spyOn(performance, 'now').mockReturnValue(now);
    flushSync(() => app.startSession()); runFrame(now + 100); expect(app.sim.time).toBeCloseTo(.1);
    runFrame(now + 1100); expect(app.sim.phase).toBe('paused'); expect(app.sim.time).toBeCloseTo(.1);
  });
  test('eight optional tools validate input and share UI actions/read-back', async () => {
    expect(tools.size).toBe(8);
    for (const tool of tools.values()) expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(tools.get('read_training_session').annotations.readOnlyHint).toBe(true);
    await tools.get('configure_training_session').execute({seed: 123, mechanics: false});
    await tools.get('start_training_session').execute({});
    await tools.get('cast_training_spell').execute({spell: 'lingering-glimmer'});
    app.sim.advance(3);
    expect((await tools.get('read_training_session').execute({})).totalDamage).toBeGreaterThan(0);
    await expect(tools.get('cast_training_spell').execute({spell: 'bad'})).rejects.toThrow(/Unknown|selected/);
    await expect(tools.get('select_training_target').execute({targetId: 'missing'})).rejects.toThrow(/exist/);
    await expect(tools.get('read_training_session').execute({extra: true})).rejects.toThrow(/Invalid/);
    await tools.get('pause_training_session').execute({}); expect(app.sim.phase).toBe('paused');
    await tools.get('resume_training_session').execute({}); expect(app.sim.phase).toBe('running');
    await tools.get('stop_training_session').execute({}); flushSync(); expect($('summaryDialog').open).toBe(true);
    await expect(tools.get('configure_training_session').execute({seed: -1})).rejects.toThrow(/Seed/);
  });
  test('Stop while Help is open replaces Help with the preserved summary', async () => {
    flushSync(() => app.startSession()); click('helpBtn');
    await tools.get('stop_training_session').execute({}); flushSync();
    expect($('helpDialog').open).toBe(false); expect($('summaryDialog').open).toBe(true);
    click('reviewBtn'); expect($('helpDialog').open).toBe(false); expect($('summaryDialog').open).toBe(false);
  });
  test('unmount aborts tool registrations and cancels the animation loop', async () => {
    flushSync(() => app.startSession()); key('KeyW');
    const sim = app.sim; await unmount(app); app = null;
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(cancelAnimationFrame).toHaveBeenCalled(); expect(sim.input.y).toBe(0); expect(sim.phase).toBe('paused');
  });
});

function helpNode(id) { return document.querySelector(`#helpDialog [data-ability="${id}"]`); }
function abilityOption(id) { return helpNode(id).querySelector('.ability-orb'); }
function talentOption(id, talent) { return helpNode(id).querySelector(`[data-talent-option="${talent}"]`); }
function tap(element) { element.click(); flushSync(); }

describe('orb loadout configuration', () => {
  test('groups Customize beside Your loadout inside the native disclosure and preserves repeated toggles', async () => {
    const setup = document.querySelector('.preplay-setup');
    const summary = setup.querySelector('summary');
    const heading = summary.querySelector('.setup-heading');
    const action = summary.querySelector('.setup-action');
    expect(heading.firstElementChild.textContent).toBe('Your loadout');
    expect(heading.lastElementChild).toBe(action);
    expect(action.textContent).toBe('Customize');
    expect(summary.firstElementChild).toBe(heading);
    expect(heading.nextElementSibling.className).toBe('setup-count');
    expect(summary.querySelector('button, a, [role="button"]')).toBeNull();
    summary.focus(); expect(document.activeElement).toBe(summary);
    // Happy DOM does not implement native summary activation. Toggle its native
    // state to test Svelte's binding without adding custom keyboard handlers.
    for (const open of [true, false, true, false, true]) {
      setup.open = open; setup.dispatchEvent(new Event('toggle')); flushSync(); await tick();
      expect(Boolean(setup.querySelector('.loadout-picker'))).toBe(open);
      expect($('startBtn').disabled).toBe(false);
      expect(app.sim.phase).toBe('ready');
    }
    click('startBtn'); await tick();
    expect(setup.open).toBe(false); expect(setup.hidden).toBe(true);
    click('pauseBtn'); expect(setup.hidden).toBe(true);
    click('stopBtn'); click('reviewBtn');
    expect(setup.hidden).toBe(false); expect(setup.open).toBe(false);
    setup.open = true; setup.dispatchEvent(new Event('toggle')); flushSync(); await tick();
    expect(setup.querySelectorAll('.ability-orb')).toHaveLength(8);
    click('startBtn'); click('restartBtn'); await tick();
    expect(setup.hidden).toBe(true); expect(setup.open).toBe(false);
  });
  test('keeps quick start available and exposes the same picker before play and in Help', async () => {
    expect($('startBtn').disabled).toBe(false);
    const setup = document.querySelector('.preplay-setup');
    expect(setup.open).toBe(false);
    setup.open = true; setup.dispatchEvent(new Event('toggle')); flushSync(); await tick();
    expect(setup.querySelectorAll('.ability-orb')).toHaveLength(8);
    expect(setup.querySelectorAll('.talent-orb')).toHaveLength(24);
    click('startBtn'); await tick();
    expect(setup.hidden).toBe(true);
    click('helpBtn');
    expect($('helpDialog').open).toBe(true);
    expect([...document.querySelectorAll('#helpDialog .ability-orb')].every(button => button.getAttribute('aria-disabled') === 'true')).toBe(true);
    const locked = document.querySelector('#helpDialog .ability-orb');
    locked.focus(); flushSync();
    expect(document.activeElement).toBe(locked);
    const selected = [...app.sim.loadout.abilities];
    tap(locked); expect(app.sim.loadout.abilities).toEqual(selected);
  });
  test('enforces five slots, supports replacement and starts only with a nonempty loadout', () => {
    click('helpBtn');
    const unselected = ABILITIES.find(ability => !DEFAULT_LOADOUT.abilities.includes(ability.id));
    const atCapacity = abilityOption(unselected.id);
    expect(atCapacity.tagName).toBe('BUTTON');
    expect(atCapacity.getAttribute('aria-disabled')).toBe('true');
    expect(atCapacity.disabled).toBe(false); // Still keyboard-focusable for inspection.
    tap(atCapacity); expect(app.sim.loadout.abilities).toEqual(DEFAULT_LOADOUT.abilities);
    tap(abilityOption(DEFAULT_LOADOUT.abilities[0]));
    tap(atCapacity); expect(app.sim.loadout.abilities).toHaveLength(5);
    expect(app.sim.loadout.abilities.at(-1)).toBe(unselected.id);
    for (const id of [...app.sim.loadout.abilities]) tap(abilityOption(id));
    expect(document.querySelectorAll('#helpDialog .ability-orb.selected')).toHaveLength(0);
    expect(document.querySelectorAll('.ability')).toHaveLength(0);
    expect($('startBtn').disabled).toBe(true);
    expect(app.startSession()).toMatchObject({ok: false});
    tap(abilityOption('veil-bolt')); expect($('startBtn').disabled).toBe(false);
  });
  test('spends at most one talent per selected ability and permits clearing every point', () => {
    click('helpBtn');
    const id = DEFAULT_LOADOUT.abilities[0];
    const talentIds = ABILITIES.find(ability => ability.id === id).talents.map(talent => talent.id);
    tap(talentOption(id, talentIds[0])); expect(app.sim.loadout.talents[id]).toBe(talentIds[0]);
    tap(talentOption(id, talentIds[1])); expect(app.sim.loadout.talents[id]).toBe(talentIds[1]);
    expect(helpNode(id).querySelectorAll('.talent-orb.selected')).toHaveLength(1);
    tap(talentOption(id, talentIds[1])); expect(app.sim.loadout.talents[id]).toBeUndefined();
    for (const selected of DEFAULT_LOADOUT.abilities) tap(talentOption(selected, 'v1'));
    expect(Object.keys(app.sim.loadout.talents)).toHaveLength(5);
    expect(document.querySelector('#helpDialog .loadout-budget').textContent).toContain('0 talent points available');
    tap([...document.querySelectorAll('#helpDialog .loadout-footer button')][0]);
    expect(app.sim.loadout.talents).toEqual({});
    tap(talentOption(id, talentIds[0])); tap(abilityOption(id));
    expect(app.sim.loadout.talents[id]).toBeUndefined();
    tap(talentOption(id, talentIds[0])); expect(app.sim.loadout.talents[id]).toBeUndefined();
  });
  test('reordering updates action labels and the actual keyboard cast', () => {
    click('helpBtn');
    tap(document.querySelector('#helpDialog [aria-label="Move Lingering Glimmer earlier"]'));
    expect(app.sim.loadout.abilities.slice(0, 2)).toEqual(['lingering-glimmer', 'veil-bolt']);
    expect(document.querySelector('[data-spell="lingering-glimmer"]').getAttribute('aria-label')).toMatch(/^Q\./);
    expect(document.querySelector('#helpDialog [data-slot="Q"]').textContent).toContain('Lingering Glimmer');
    click('helpDone'); click('startBtn');
    key('KeyQ'); expect(app.sim.castCounts['lingering-glimmer']).toBe(1);
    expect(app.sim.castCounts['veil-bolt']).toBeUndefined();
  });
  test('hover and keyboard focus expose ability and talent details', () => {
    click('helpBtn');
    const ability = ABILITIES[0];
    abilityOption(ability.id).focus(); flushSync();
    expect($('help-loadout-detail').textContent).toContain(ability.name);
    expect(abilityOption(ability.id).getAttribute('aria-describedby')).toBe('help-loadout-detail');
    const talent = ability.talents[0];
    talentOption(ability.id, talent.id).focus(); flushSync();
    expect($('help-loadout-detail').textContent).toContain(talent.name);
    expect($('help-loadout-detail').textContent).toContain(talent.description);
  });
  test('warns about a spender without generation and rejects malformed tool configuration atomically', () => {
    flushSync(() => app.configure({loadout: {abilities: ['destructive-rift'], talents: {}}}));
    expect(document.querySelector('#helpDialog .loadout-warning').textContent).toMatch(/generat/i);
    const previous = structuredClone(app.sim.loadout);
    expect(() => app.configure({loadout: {abilities: ['missing'], talents: {}}})).toThrow();
    expect(app.sim.loadout).toEqual(previous);
    expect(() => app.configure({layout: 'random'})).toThrow(/layout/);
  });
  test('summary retains its session loadout when setup changes and no-DoT coverage is not applicable', () => {
    flushSync(() => app.configure({loadout: {abilities: ['veil-bolt'], talents: {}}}));
    flushSync(() => app.startSession()); app.sim.advance(2); flushSync(() => app.stopSession());
    expect($('summaryContent').textContent).toContain('Not applicable');
    const summary = structuredClone(app.sim.summary);
    click('reviewBtn');
    flushSync(() => app.configure({loadout: {abilities: ['lingering-glimmer'], talents: {}}}));
    click('startBtn');
    expect(app.sim.summary).toEqual(summary);
    expect(document.querySelector('.summary-loadout').textContent).toContain('Veil Bolt');
    expect(document.querySelector('.summary-loadout').textContent).not.toContain('Lingering Glimmer');
  });
  test('selected maintenance DoTs appear in coverage metrics with the initial delay included', () => {
    flushSync(() => app.configure({loadout: {abilities: ['lingering-glimmer'], talents: {}}}));
    flushSync(() => app.startSession()); app.sim.advance(3);
    flushSync(() => app.castSpell('lingering-glimmer')); app.sim.advance(3);
    flushSync(() => app.stopSession());
    const row = document.querySelector('[data-coverage="lingering-glimmer"]');
    expect(row.textContent).toContain('Lingering Glimmer');
    expect(app.sim.summary.dotCoverage).toBeLessThan(1);
    expect(app.sim.summary.dotCoverage).toBeGreaterThan(0);
    expect($('summaryContent').textContent).toContain('including the wait before the first application');
  });
});

describe('loadout lifecycle regressions', () => {
  test('normalizes omitted talents and base selections without spending talent points', () => {
    flushSync(() => app.configure({loadout: {abilities: ['veil-bolt']}}));
    expect(app.sim.loadout).toEqual({abilities: ['veil-bolt'], talents: {}});
    expect(document.querySelector('#helpDialog .loadout-budget').textContent).toContain('5 talent points available');
    flushSync(() => app.configure({loadout: {abilities: ['veil-bolt'], talents: {'veil-bolt': 'base'}}}));
    expect(app.sim.loadout.talents).toEqual({});
    expect(document.querySelector('#helpDialog .loadout-budget').textContent).toContain('5 talent points available');
  });
  test('a repeated Start cannot reset an active or paused session', () => {
    flushSync(() => app.startSession()); app.sim.advance(3);
    expect(app.startSession()).toMatchObject({ok: false, reason: 'Stop the active session first'});
    expect(app.sim.time).toBe(3); expect(app.sim.phase).toBe('running');
    flushSync(() => app.pauseSession());
    expect(app.startSession()).toMatchObject({ok: false});
    expect(app.sim.time).toBe(3); expect(app.sim.phase).toBe('paused');
  });
  test('all selected maintenance DoTs appear in targets and the summary', () => {
    flushSync(() => app.configure({loadout: {abilities: ['veil-bolt', 'lingering-glimmer'], talents: {'veil-bolt': 'v2'}}}));
    flushSync(() => app.startSession()); app.sim.advance(2);
    flushSync(() => app.castSpell('veil-bolt')); app.sim.advance(1.5);
    flushSync(() => app.castSpell('lingering-glimmer')); app.sim.advance(2); update();
    const dotText = document.querySelector('[data-target="dummy"] .target-dot').textContent;
    expect(dotText).toContain('Lingering Touch'); expect(dotText).toContain('Lingering Glimmer');
    flushSync(() => app.stopSession());
    expect(document.querySelectorAll('[data-coverage]')).toHaveLength(2);
    expect(document.querySelector('[data-coverage="lingering-touch"]').textContent).toContain('Lingering Touch');
    expect(document.querySelector('[data-coverage="lingering-glimmer"]').textContent).toContain('Lingering Glimmer');
    for (const coverage of app.sim.summary.coverageDetails) expect(coverage.ratio).toBeLessThan(1);
  });
  test('Focused Energy exposes its active self-buff and expiry in the HUD', () => {
    flushSync(() => app.configure({loadout: {abilities: ['focused-energy'], talents: {}}}));
    flushSync(() => app.startSession()); flushSync(() => app.castSpell('focused-energy'));
    expect(document.querySelector('.active-buffs').textContent).toContain('Focused Energy');
    expect(document.querySelector('.active-buffs').textContent).toContain('15s');
    app.sim.advance(15); update();
    expect(document.querySelector('.active-buffs').textContent).toBe('');
  });
});
