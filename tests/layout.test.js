import {describe, expect, test, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {ArenaRenderer} from '../src/lib/renderer.js';
import {RaidSim, WORLD} from '../src/lib/engine.js';

// Happy DOM does not lay out a page. These source-level contracts guard the
// sizing rules; the renderer tests below check the independent canvas geometry.
const styles = readFileSync('src/styles.css', 'utf8');
const sheet = new CSSStyleSheet();
// Happy DOM requires whitespace after @media; both forms are valid CSS.
sheet.replaceSync(styles.replaceAll('@media(', '@media ('));
const desktopRules = [...sheet.cssRules]
  .filter(rule => rule.conditionText === '(min-width:851px)')
  .flatMap(rule => [...rule.cssRules]);
const desktopStyle = selector => Object.assign({}, ...desktopRules
  .filter(rule => rule.selectorText === selector)
  .map(rule => Object.fromEntries(Array.from({length: rule.style.length}, (_, i) => {
    const name = rule.style.item(i);
    return [name, rule.style.getPropertyValue(name)];
  }))));

describe('desktop viewport sizing contracts (not browser layout)', () => {
  test('the app fills the viewport and gives the workspace the remaining height', () => {
    expect(desktopStyle('.app')).toMatchObject({
      'min-height': '100dvh', display: 'flex', 'flex-direction': 'column',
    });
    expect(desktopStyle('.workspace')).toMatchObject({'flex-grow': '1', 'align-items': 'stretch'});
    expect(desktopStyle('.combat-panel')).toMatchObject({display: 'flex', 'flex-direction': 'column'});
  });
  test('the arena grows without a viewport subtraction or upper cap', () => {
    expect(desktopStyle('.arena-wrap')).toMatchObject({'flex-grow': '1', 'min-height': '352px'});
    expect(desktopStyle('#arena')).toMatchObject({
      position: 'absolute', inset: '0', width: '100%', height: '100%', 'aspect-ratio': 'auto',
    });
    expect(desktopStyle('#arena')['max-height']).toBeUndefined();
    expect(desktopStyle('canvas').height).toBeUndefined();
  });
  test('controls retain their natural height and the document can scroll on short screens', () => {
    expect(desktopStyle('.masthead,.metrics')).toMatchObject({'flex-grow': '0', 'flex-shrink': '0', 'flex-basis': 'auto'});
    expect(desktopStyle('.combat-panel> :not(.arena-wrap)')).toMatchObject({'flex-grow': '0', 'flex-shrink': '0', 'flex-basis': 'auto'});
    expect(desktopStyle('.ability-deck')).toMatchObject({width: '100%'});
    expect(desktopStyle('.app').height).toBeUndefined();
    expect(desktopStyle('.app').overflow).toBeUndefined();
    expect(desktopStyle('.workspace').overflow).toBeUndefined();
  });
  test('narrow screens retain the flowing, aspect-ratio arena', () => {
    const narrowRules = [...sheet.cssRules]
      .filter(rule => rule.conditionText === '(max-width:850px)')
      .flatMap(rule => [...rule.cssRules]);
    const arena = narrowRules.filter(rule => rule.selectorText === '#arena').at(-1);
    expect(narrowRules.find(rule => rule.selectorText === '.masthead,.session-controls').style.flexWrap).toBe('wrap');
    expect(arena.style.height).toBe('auto');
    expect(arena.style.getPropertyValue('aspect-ratio')).toBe('1000 / 650');
  });
});

describe('arena resizing and letterboxed pointer mapping', () => {
  test.each([
    [1181, 418], // Wide, short desktop arena.
    [1181, 818], // Tall desktop arena after removing the old height cap.
    [720, 1200], // Large vertical letterbox.
    [320, 208], // Narrow-screen aspect ratio.
  ])('preserves world geometry and targeting in a %i × %i arena', (width, height) => {
    const canvas = document.createElement('canvas');
    const left = 37, top = 91;
    canvas.getBoundingClientRect = () => ({left, top, width, height, right: left + width, bottom: top + height});
    vi.stubGlobal('devicePixelRatio', 1.5);
    try {
      const renderer = new ArenaRenderer(canvas);
      const sim = new RaidSim({seed: 123});
      renderer.draw(sim);
      expect(canvas.width).toBe(Math.round(width * 1.5));
      expect(canvas.height).toBe(Math.round(height * 1.5));
      const transform = renderer.ctx.getTransform();
      expect(transform.a).toBeCloseTo(transform.d, 6);
      expect(transform.e).toBeCloseTo((canvas.width - WORLD.width * transform.a) / 2, 3);
      expect(transform.f).toBeCloseTo((canvas.height - WORLD.height * transform.d) / 2, 3);
      const scale = Math.min(width / WORLD.width, height / WORLD.height);
      const ox = (width - WORLD.width * scale) / 2, oy = (height - WORLD.height * scale) / 2;
      for (const point of [sim.player, sim.targets[0], {x: 0, y: 0}, {x: WORLD.width, y: WORLD.height}]) {
        const mapped = renderer.pointFromClient(left + ox + point.x * scale, top + oy + point.y * scale);
        expect(mapped.x).toBeCloseTo(point.x, 6);
        expect(mapped.y).toBeCloseTo(point.y, 6);
      }
      // A second viewport resize must not keep the old backing-store dimensions.
      canvas.getBoundingClientRect = () => ({left, top, width: 640, height: 350});
      renderer.draw(sim);
      expect(canvas.width).toBe(960);
      expect(canvas.height).toBe(525);
      expect(renderer.pointFromClient(left + 320, top + 175)).toEqual({x: 500, y: 280});
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('loadout layout and interaction styling contracts', () => {
  test('keeps title, count and Customize left aligned with whole groups wrapping', () => {
    const rulesFor = (rules, selector) => rules.filter(rule => rule.selectorText === selector).at(-1)?.style;
    const baseRules = [...sheet.cssRules];
    const heading = rulesFor(baseRules, '.preplay-setup .setup-heading');
    expect(heading.display).toBe('flex');
    expect(heading.justifyContent).toBe('flex-start');
    expect(heading.flexWrap).toBe('wrap');
    expect(heading.minWidth).toBe('0');
    expect(rulesFor(baseRules, '.preplay-setup .setup-action').marginLeft).toBe('');
    expect(rulesFor(baseRules, '.preplay-setup .setup-action').whiteSpace).toBe('nowrap');
    expect(rulesFor(baseRules, '.preplay-setup .setup-count').marginLeft).toBe('');
    expect(rulesFor(baseRules, '.preplay-setup .setup-count').whiteSpace).toBe('nowrap');
    const narrowRules = baseRules.filter(rule => rule.conditionText === '(max-width:650px)').flatMap(rule => [...rule.cssRules]);
    expect(rulesFor(narrowRules, '.preplay-setup>summary').flexWrap).toBe('wrap');
    expect(rulesFor(narrowRules, '.preplay-setup .setup-count').marginLeft).toBe('0px');
    expect(styles).toContain('summary:focus-visible');
  });
  test('removes orphaned standalone void styles and preserves active effect styling', () => {
    expect(styles).not.toContain('.shards');
    expect(styles).toContain('.active-buffs{display:flex;flex-wrap:wrap');
  });
  test('setup is an opt-in flowing section and never adds a viewport subtraction', () => {
    expect(styles).toContain('.preplay-setup{flex:none;');
    expect(styles).toContain('.loadout-catalogue{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))');
    expect(styles).toContain('.preplay-setup .loadout-catalogue{grid-template-columns:repeat(8,minmax(0,1fr))}');
    expect(styles).not.toMatch(/height:\s*calc\(100(?:d)?vh/);
  });
  test('large ability circles and smaller connected talent circles retain selection and focus affordances', () => {
    expect(styles).toMatch(/\.ability-orb\{[^}]*width:84px;[^}]*height:84px;[^}]*border-radius:50%/);
    expect(styles).toMatch(/\.talent-orb\{[^}]*border-radius:50%;[^}]*width:31px;[^}]*height:31px/);
    expect(styles).toContain('.talent-branches::before');
    expect(styles).toContain('.talent-branches::after');
    expect(styles).toContain('.ability-orb.selected');
    expect(styles).toContain('.talent-orb.selected');
    expect(styles).toContain('button:focus-visible');
  });
});
