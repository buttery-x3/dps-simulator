import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {flushSync, mount, tick, unmount} from 'svelte';
import App from '../src/App.svelte';

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
    expect(document.querySelectorAll('.spellbook-icon')).toHaveLength(5);
    expect($('helpDialog').open).toBe(false);
    expect(app.sim.player.y).toBe(445);
    expect(app.sim.targets[0].y).toBe(160);
  });
  test('start/cast/pause/resume/stop/restart controls use exact engine state', async () => {
    click('startBtn'); await tick();
    expect(app.sim.phase).toBe('running'); expect($('overlay').hidden).toBe(true);
    flushSync(() => app.castSpell('brand')); app.sim.advance(3); update();
    expect($('totalDamage').textContent).toBe('312');
    click('pauseBtn'); expect(app.sim.phase).toBe('paused');
    click('pauseBtn'); expect(app.sim.phase).toBe('running');
    click('stopBtn'); expect($('summaryDialog').open).toBe(true);
    expect($('summaryContent').textContent).toContain('312');
    expect(app.sim.summary.totalDamage).toBe(312);
    click('restartBtn'); await tick(); expect(app.sim.totalDamage).toBe(0);
    expect($('summaryDialog').open).toBe(false);
  });
  test('Q/E/R replace 1/2/3, 4/5 work, and movement cancels a cast', () => {
    flushSync(() => app.startSession());
    expect(key('Digit1').defaultPrevented).toBe(false);
    key('KeyQ'); expect(app.sim.totalDamage).toBe(72);
    app.sim.advance(1.2); key('KeyE'); expect(app.sim.cast.spell).toBe('glass');
    key('KeyW'); expect(app.sim.input.y).toBe(-1); expect(app.sim.cast).toBe(null);
    key('KeyW', 'keyup'); expect(app.sim.input.y).toBe(0);
    app.sim.advance(1.2); key('KeyR'); expect(app.sim.cast.spell).toBe('thread');
    app.sim.advance(1.2); app.sim.grantProc(); key('Digit4'); expect(app.sim.proc.charges).toBe(0);
    app.sim.advance(1.2); app.sim.shards = 3; key('Digit5'); expect(app.sim.shards).toBe(0);
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
  test('setup controls and tool setup update the fifth spell before starting', () => {
    flushSync(() => app.configure({seed: 123, loadout: 'bloom', mechanics: false}));
    expect($('seedInput').value).toBe('123'); expect($('mechanicsInput').checked).toBe(false);
    expect(document.querySelector('[data-spell="spend"] .ability-name').textContent).toBe('Umbral Bloom');
    expect(document.querySelector('[data-book="spend"]').textContent).toContain('Umbral Bloom');
    flushSync(() => app.startSession()); expect(app.sim.loadout).toBe('bloom');
    expect(() => app.configure({seed: 4})).toThrow(/Stop/);
  });
  test('live targets and Brand timers render through keyed Svelte elements', () => {
    flushSync(() => app.startSession()); app.sim.spawnWave(); update();
    expect(document.querySelectorAll('.target-card')).toHaveLength(3);
    const id = app.sim.targets[1].id;
    document.querySelector(`[data-target="${id}"]`).click(); flushSync();
    expect(app.sim.selectedId).toBe(id);
    flushSync(() => app.castSpell('brand')); expect(document.querySelector(`[data-target="${id}"] .target-dot`).textContent).toContain('18.0s');
    app.sim.advance(14); update(); expect(document.querySelector(`[data-target="${id}"] .target-dot`).classList.contains('refresh')).toBe(true);
  });
  test('proc/shard/cooldown states update both action text and readiness classes', () => {
    flushSync(() => app.startSession()); app.sim.grantProc(); app.sim.shards = 3; update();
    expect(document.querySelector('[data-spell="bolt"]').classList.contains('is-proc')).toBe(true);
    expect(document.querySelector('[data-spell="spend"]').classList.contains('is-ready')).toBe(true);
    flushSync(() => app.castSpell('bolt')); expect(document.querySelector('[data-spell="bolt"]').classList.contains('is-proc')).toBe(false);
    app.sim.advance(1.2); flushSync(() => app.castSpell('glass')); app.sim.advance(1.5); update();
    expect(document.querySelector('[data-spell="glass"] .ability-state').textContent).toContain('Cooldown 8.0s');
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
    await tools.get('cast_training_spell').execute({spell: 'brand'});
    expect((await tools.get('read_training_session').execute({})).totalDamage).toBe(72);
    await expect(tools.get('cast_training_spell').execute({spell: 'bad'})).rejects.toThrow(/Unknown/);
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
