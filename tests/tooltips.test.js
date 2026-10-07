import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {flushSync, mount, tick, unmount} from 'svelte';
import App from '../src/App.svelte';
import {ABILITIES, compileAbility} from '../src/lib/catalogue.js';
import {describeAbility} from '../src/lib/ability-details.js';
import {tooltipPosition} from '../src/lib/ability-tooltip.js';
import {DEFAULT_BINDINGS, STORAGE_KEY} from '../src/lib/keybindings.js';

let app;
const originalPopover = HTMLElement.prototype.showPopover;
const $ = selector => document.querySelector(selector);
const tip = () => $('[role="tooltip"]');
const text = () => tip()?.textContent ?? '';
const spellButton = id => $(`[data-spell="${id}"]`);
function pointer(node, type, pointerType = 'mouse') {
  node.dispatchEvent(new PointerEvent(type, {pointerType, bubbles: true})); flushSync();
}
function focus(node) { node.focus(); flushSync(); }
function click(node) { node.click(); flushSync(); }
function escape(node) {
  const event = new KeyboardEvent('keydown', {key: 'Escape', code: 'Escape', bubbles: true, cancelable: true});
  node.dispatchEvent(event); flushSync(); return event;
}
function configure(id, talent = null) {
  flushSync(() => app.configure({loadout: {abilities: [id], talents: talent ? {[id]: talent} : {}}}));
}

beforeEach(() => {
  localStorage.clear(); document.body.replaceChildren();
  document.hidden = false; document.hasFocus = () => true;
  app = mount(App, {target: document.body}); flushSync();
});
afterEach(async () => {
  if (app) await unmount(app);
  app = null; vi.useRealTimers(); vi.restoreAllMocks();
  if (!originalPopover) delete HTMLElement.prototype.showPopover;
  document.body.replaceChildren();
});

describe('ability tooltip integration', () => {
  test('all 8 bases and 24 selected talents display the effective compiled model', () => {
    for (const ability of ABILITIES) for (const talent of [null, ...ability.talents.map(talent => talent.id)]) {
      configure(ability.id, talent);
      const button = spellButton(ability.id);
      pointer(button, 'pointerenter');
      const detail = describeAbility(compileAbility(ability.id, talent), {key: '1'});
      expect(text()).toContain(detail.name);
      for (const fact of detail.facts) expect(text()).toContain(fact);
      for (const effect of detail.effects) expect(text()).toContain(effect);
      if (talent) expect(text()).toContain(detail.talentName);
      else expect(text()).toContain('No talent selected');
      expect(text()).not.toMatch(/\bvoid\b/i);
      escape(button);
    }
  }, 15000);

  test('hover shows the selected replacement and has no native title duplicate', () => {
    configure('astral-flare', 'v2');
    const button = spellButton('astral-flare'); pointer(button, 'pointerenter');
    expect(text()).toContain('Drifting Flare'); expect(text()).toContain('1s cast');
    expect(text()).toContain('520 damage'); expect(text()).not.toContain('900');
    expect(text()).not.toContain('8s cooldown'); expect(button.hasAttribute('title')).toBe(false);
    expect(document.activeElement).not.toBe(tip());
  });

  test('keyboard focus exposes an accessible tooltip on a resource-locked ability', () => {
    configure('destructive-rift'); const button = spellButton('destructive-rift');
    expect(button.classList.contains('is-locked')).toBe(true);
    focus(button); expect(tip()).not.toBeNull();
    expect(button.getAttribute('aria-describedby')).toBe(tip().id);
    expect(tip().hasAttribute('tabindex')).toBe(false);
    focus($('#helpBtn')); expect(tip()).toBeNull(); expect(button.hasAttribute('aria-describedby')).toBe(false);
  });

  test('leaving closes the tooltip, while keyboard focus and moving onto the tooltip retain it', () => {
    vi.useFakeTimers(); const button = spellButton('veil-bolt');
    pointer(button, 'pointerenter'); pointer(button, 'pointerleave');
    pointer(tip(), 'pointerenter'); vi.advanceTimersByTime(120); expect(tip()).not.toBeNull();
    pointer(tip(), 'pointerleave'); vi.advanceTimersByTime(120); expect(tip()).toBeNull();
    focus(button); pointer(button, 'pointerenter'); pointer(button, 'pointerleave');
    vi.advanceTimersByTime(120); expect(tip()).not.toBeNull();
    focus($('#helpBtn')); expect(tip()).toBeNull();
  });

  test('moving keyboard focus away keeps a tooltip that the pointer is actively reading', () => {
    vi.useFakeTimers(); const button = spellButton('veil-bolt');
    focus(button); pointer(button, 'pointerenter'); pointer(button, 'pointerleave');
    pointer(tip(), 'pointerenter'); const popup = tip();
    focus($('#helpBtn')); vi.advanceTimersByTime(120); expect(tip()).toBe(popup);
    pointer(popup, 'pointerleave'); vi.advanceTimersByTime(120); expect(tip()).toBeNull();
  });

  test('Escape dismisses without moving focus or reopening on a HUD frame', () => {
    const button = spellButton('veil-bolt'); focus(button); const popup = tip();
    for (let i = 0; i < 12; i++) flushSync(() => app.renderHud());
    expect(tip()).toBe(popup);
    escape(button); expect(tip()).toBeNull(); expect(document.activeElement).toBe(button);
    flushSync(() => app.renderHud()); expect(tip()).toBeNull();
  });

  test('hover never captures arena combat inputs or changes Escape pause behavior', () => {
    flushSync(() => app.startSession()); const arena = $('#arena');
    pointer(spellButton('veil-bolt'), 'pointerenter'); expect(document.activeElement).toBe(arena);
    arena.dispatchEvent(new KeyboardEvent('keydown', {code: 'Digit2', bubbles: true, cancelable: true})); flushSync();
    expect(app.sim.castCounts['lingering-glimmer']).toBe(1);
    expect(tip()).not.toBeNull();
    const event = escape(arena); expect(event.defaultPrevented).toBe(true);
    expect(app.sim.phase).toBe('paused'); expect(tip()).toBeNull();
  });

  test('loadout changes dismiss stale hover; the next inspection uses the new talent', () => {
    configure('astral-flare'); const button = spellButton('astral-flare'); pointer(button, 'pointerenter');
    expect(text()).toContain('900'); configure('astral-flare', 'v2'); expect(tip()).toBeNull();
    pointer(button, 'pointerleave'); pointer(button, 'pointerenter');
    expect(text()).toContain('Drifting Flare'); expect(text()).toContain('520');
    configure('veil-bolt'); expect(tip()).toBeNull(); expect(button.isConnected).toBe(false);
  });

  test('Help previews a talent without selecting it, then uses selected ability details consistently', () => {
    click($('#helpBtn'));
    const talent = $('#helpDialog [data-ability="astral-flare"] [data-talent-option="v2"]');
    pointer(talent, 'pointerenter'); expect(text()).toContain('Drifting Flare');
    expect(app.sim.loadout.talents['astral-flare']).toBeUndefined();
    expect($('#help-loadout-detail').textContent).toContain('Drifting Flare');
    click(talent); expect(tip()).toBeNull();
    const orb = $('#helpDialog [data-ability-option="astral-flare"]'); focus(orb);
    expect(text()).toContain('Drifting Flare'); const selectedText = text();
    expect(orb.getAttribute('aria-describedby')).toBe(tip().id);
    escape(orb); expect(orb.getAttribute('aria-describedby')).toBe('help-loadout-detail');
    click($('#helpDone')); pointer(spellButton('astral-flare'), 'pointerenter');
    expect(text()).toBe(selectedText);
  });

  test('a dialog tooltip uses the native top layer when available; Escape does not close Help', () => {
    HTMLElement.prototype.showPopover = () => {};
    const show = vi.spyOn(HTMLElement.prototype, 'showPopover').mockImplementation(function () { this.dataset.topLayer = 'true'; });
    click($('#helpBtn')); const orb = $('#helpDialog [data-ability-option="veil-bolt"]'); focus(orb);
    expect(show).toHaveBeenCalledOnce(); expect(tip().getAttribute('popover')).toBe('manual');
    expect(tip().dataset.topLayer).toBe('true');
    expect(escape(orb).defaultPrevented).toBe(true); expect($('#helpDialog').open).toBe(true);
    expect(escape(orb).defaultPrevented).toBe(false);
  });

  test('popover fallback is inside Help and hidden Help cannot leave a stale popup', () => {
    click($('#helpBtn')); const orb = $('#helpDialog [data-ability-option="veil-bolt"]'); focus(orb);
    expect(tip().parentElement).toBe($('#helpDialog')); expect(tip().hasAttribute('popover')).toBe(false);
    click($('#helpDone')); expect(tip()).toBeNull();
    pointer(orb, 'pointerenter'); expect(tip()).toBeNull();
  });

  test('key capture opening and closing never leaves a tooltip or consumes capture Escape', () => {
    pointer(spellButton('veil-bolt'), 'pointerenter'); click($('#keybindingsBtn')); expect(tip()).toBeNull();
    pointer(spellButton('veil-bolt'), 'pointerenter'); expect(tip()).toBeNull();
    const capture = $('#keybindingsDialog [data-binding-slot="0"]');
    click(capture); expect(escape(capture).defaultPrevented).toBe(true);
    expect($('#keybindingsDialog').open).toBe(true); expect(tip()).toBeNull();
    click($('#cancelKeybindings')); expect(tip()).toBeNull();
  });

  test('touch taps show persistent picker details without a floating panel or blocking casts', () => {
    click($('#helpBtn')); const orb = $('#helpDialog [data-ability-option="veil-bolt"]');
    pointer(orb, 'pointerenter', 'touch'); pointer(orb, 'pointerdown', 'touch'); focus(orb);
    expect(tip()).toBeNull(); expect($('#help-loadout-detail').textContent).toContain('Veil Bolt');
    click($('#helpDone')); flushSync(() => app.startSession());
    const button = spellButton('lingering-glimmer'); pointer(button, 'pointerenter', 'touch'); pointer(button, 'pointerdown', 'touch'); click(button);
    expect(tip()).toBeNull(); expect(app.sim.castCounts['lingering-glimmer']).toBe(1);
  });

  test('Help offers read-only touch inspection before and during combat', () => {
    configure('astral-flare', 'v2');
    for (const active of [false, true]) {
      if (active) flushSync(() => app.startSession());
      const loadout = structuredClone(app.sim.loadout);
      click($('#helpBtn')); const inspect = $('[data-inspect-ability="astral-flare"]');
      pointer(inspect, 'pointerdown', 'touch'); click(inspect);
      expect($('.spell-detail').textContent).toContain('Drifting Flare');
      expect($('.spell-detail').textContent).toContain('520 damage');
      expect(app.sim.loadout).toEqual(loadout); expect(app.sim.castCounts['astral-flare']).toBeUndefined();
      expect(tip()).toBeNull(); click($('#helpDone'));
    }
  });

  test('current saved/custom key labels reach tooltip, picker and touch details without extra storage', async () => {
    await unmount(app); app = null;
    const bindings = ['KeyQ', ...DEFAULT_BINDINGS.slice(1)];
    localStorage.setItem(STORAGE_KEY, JSON.stringify({version: 1, bindings}));
    app = mount(App, {target: document.body}); flushSync();
    pointer(spellButton('veil-bolt'), 'pointerenter'); expect(tip().querySelector('kbd').textContent).toBe('Q');
    click($('#keybindingsBtn')); click($('#keybindingsDialog [data-binding-slot="0"]'));
    $('#keybindingsDialog [data-binding-slot="0"]').dispatchEvent(new KeyboardEvent('keydown', {code: 'ArrowLeft', bubbles: true, cancelable: true})); flushSync();
    click($('#saveKeybindings')); await tick();
    pointer(spellButton('veil-bolt'), 'pointerenter'); expect(tip().querySelector('kbd').textContent).toBe('Left');
    click($('#helpBtn')); focus($('#helpDialog [data-ability-option="veil-bolt"]'));
    expect(tip().querySelector('kbd').textContent).toBe('Left');
    click($('[data-inspect-ability="veil-bolt"]'));
    expect($('.spell-detail kbd').textContent).toBe('Left');
    expect(localStorage.length).toBe(1); expect(localStorage.key(0)).toBe(STORAGE_KEY);
  });

  test('scroll, resize, window blur, visibility and modal transitions dismiss hints', () => {
    const button = spellButton('veil-bolt');
    for (const [target, type] of [[document, 'scroll'], [window, 'resize'], [window, 'blur'], [document, 'visibilitychange']]) {
      pointer(button, 'pointerenter'); expect(tip()).not.toBeNull();
      target.dispatchEvent(new Event(type)); flushSync(); expect(tip()).toBeNull();
    }
    pointer(button, 'pointerenter'); click($('#helpBtn')); expect(tip()).toBeNull();
  });

  test('keyboard or programmatic modal opening also dismisses underlying preplay hints', () => {
    const setup = $('.preplay-setup'); setup.open = true; setup.dispatchEvent(new Event('toggle')); flushSync();
    const orb = $('.preplay-setup [data-ability-option="veil-bolt"]');
    pointer(orb, 'pointerenter'); expect(tip()).not.toBeNull();
    flushSync(() => app.openHelp()); expect(tip()).toBeNull();
    expect(orb.getAttribute('aria-describedby')).toBe('preplay-loadout-detail');
    pointer(orb, 'pointerenter'); expect(tip()).toBeNull();
    click($('#helpDone')); pointer(orb, 'pointerenter'); expect(tip()).not.toBeNull();
    click($('#keybindingsBtn')); expect(tip()).toBeNull();
    pointer(orb, 'pointerenter'); expect(tip()).toBeNull();
    click($('#cancelKeybindings')); expect(tip()).toBeNull();
  });

  test('collapsing either picker disclosure dismisses the hint and its accessibility relation', () => {
    for (const help of [false, true]) {
      if (help) click($('#helpBtn'));
      const disclosure = $(help ? '#settings' : '.preplay-setup');
      disclosure.open = true; disclosure.dispatchEvent(new Event('toggle')); flushSync();
      const orb = disclosure.querySelector('[data-ability-option="veil-bolt"]');
      pointer(orb, 'pointerenter'); expect(tip()).not.toBeNull();
      disclosure.open = false; disclosure.dispatchEvent(new Event('toggle')); flushSync();
      expect(tip()).toBeNull(); expect(orb.getAttribute('aria-describedby')).not.toMatch(/^ability-tooltip-/);
      pointer(orb, 'pointerenter'); expect(tip()).toBeNull();
    }
  });

  test('clamps the mounted popup and preserves it during its own scroll', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.classList.contains('ability-tooltip')) return {width: 340, height: 300, left: 0, top: 0, right: 340, bottom: 300};
      return {left: window.innerWidth - 40, top: window.innerHeight - 40, width: 30, height: 30, right: window.innerWidth - 10, bottom: window.innerHeight - 10};
    });
    pointer(spellButton('veil-bolt'), 'pointerenter'); const popup = tip();
    expect(parseFloat(popup.style.left) + 340).toBeLessThanOrEqual(window.innerWidth - 12);
    expect(parseFloat(popup.style.top) + 300).toBeLessThanOrEqual(window.innerHeight - 12);
    popup.dispatchEvent(new Event('scroll')); expect(tip()).toBe(popup);
  });

  test('teardown removes a visible popup, pending leave timer and listener effects before remount', async () => {
    vi.useFakeTimers(); const button = spellButton('veil-bolt');
    pointer(button, 'pointerenter'); pointer(button, 'pointerleave');
    await unmount(app); app = null; expect(tip()).toBeNull();
    vi.runOnlyPendingTimers(); window.dispatchEvent(new Event('resize'));
    app = mount(App, {target: document.body}); flushSync();
    pointer(spellButton('veil-bolt'), 'pointerenter'); expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1);
  });
});

test('pure placement fits edges and offset/tiny visual viewports', () => {
  const size = {width: 340, height: 300};
  for (const anchor of [
    {left: 0, top: 0, width: 50, bottom: 50},
    {left: 960, top: 540, width: 40, bottom: 580},
    {left: 480, top: 280, width: 40, bottom: 320},
  ]) {
    const position = tooltipPosition(anchor, size, {width: 1000, height: 600});
    expect(position.left).toBeGreaterThanOrEqual(12); expect(position.left + 340).toBeLessThanOrEqual(988);
    expect(position.top).toBeGreaterThanOrEqual(12); expect(position.top + 300).toBeLessThanOrEqual(588);
  }
  expect(tooltipPosition({left: 0, top: 0, width: 20, bottom: 20}, size, {left: 100, top: 50, width: 200, height: 150})).toEqual({left: 112, top: 62});
});
