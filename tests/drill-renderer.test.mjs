import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {RaidSim, HZ} from '../src/lib/engine.js';
import {ArenaRenderer} from '../src/lib/renderer.js';

function canvasFixture(rect = {left: 0, top: 0, width: 1000, height: 560}) {
  const canvas = createCanvas(rect.width, rect.height);
  canvas.getBoundingClientRect = () => rect;
  const context = canvas.getContext('2d'), words = [], colors = [], lines = [];
  const recording = new Proxy(context, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...args) => {
        if (property === 'fillText') words.push(String(args[0]));
        if (property === 'lineTo') lines.push(args);
        return value.apply(target, args);
      };
    },
    set(target, property, value) {
      if (property === 'fillStyle' || property === 'strokeStyle') colors.push(value);
      return Reflect.set(target, property, value, target);
    },
  });
  const renderer = new ArenaRenderer(canvas);
  renderer.ctx = recording;
  return {canvas, context: recording, actual: context, renderer, words, colors, lines};
}
function state() {
  const sim = new RaidSim({mechanics: false});
  sim.start();
  sim.tick = HZ;
  sim.time = 1;
  sim.hazards = [];
  sim.hostileProjectiles = [];
  sim.safeZones = [];
  return sim;
}
const zone = (kind = 'safe-deadline', overrides = {}) => ({id: 'test-zone', kind, x: 250, y: 290, r: 80,
  born: 0, active: 3 * HZ, ends: 8 * HZ, damage: 1000, ruleId: 'safe-rule', ...overrides});
const projectile = (overrides = {}) => ({id: 'test-projectile', x: 500, y: 350, r: 9,
  vx: 180, vy: 0, born: 0, expires: 10 * HZ, damage: 750, ruleId: 'projectile-rule', ...overrides});
const channels = color => /^#[a-f\d]{6}([a-f\d]{2})?$/i.test(color)
  ? [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16)) : null;
const pixel = (context, x, y) => [...context.getImageData(x, y, 1, 1).data];

// Calls are recorded around a native Canvas context; every draw still rasterizes.
test('safe deadlines are cool destinations with readable countdowns, then disappear at expiry', () => {
  const {renderer, context, actual, words, colors} = canvasFixture();
  const sim = state(), destination = zone();
  renderer.safeZone(context, destination, sim, false);
  renderer.safeZone(context, destination, sim, true);
  assert.ok(words.includes('ENTER BY 2.0s'));
  assert.ok(colors.every(color => {const rgb = channels(color); return rgb && rgb[1] > rgb[0] && rgb[2] > rgb[0];}), colors.join(', '));
  const fill = pixel(actual, destination.x + 24, destination.y + 24);
  assert.ok(fill[3] > 0 && fill[1] > fill[0] && fill[2] > fill[0], 'safe-zone fill is genuinely drawn in cyan');
  context.clearRect(0, 0, 1000, 560); words.length = 0; colors.length = 0;
  sim.tick = destination.active;
  renderer.safeZone(context, destination, sim, false);
  renderer.safeZone(context, destination, sim, true);
  assert.deepEqual(words, []);
  assert.equal(actual.getImageData(0, 0, 1000, 560).data.some(Boolean), false);
});

test('safe holds distinguish warm-up from active time and draw a green active boundary', () => {
  const {renderer, context, actual, words} = canvasFixture();
  const sim = state(), hold = zone('safe-hold');
  renderer.safeZone(context, hold, sim, false);
  renderer.safeZone(context, hold, sim, true);
  assert.ok(words.includes('HOLD IN 2.0s'));
  sim.tick = 4 * HZ; words.length = 0;
  renderer.safeZone(context, hold, sim, false);
  renderer.safeZone(context, hold, sim, true);
  assert.ok(words.includes('HOLD · 4.0s'));
  assert.ok(!words.some(label => label.includes('HOLD IN')));
  const edge = pixel(actual, hold.x + hold.r, hold.y);
  assert.ok(edge[1] > edge[0] && edge[1] > edge[2] && edge[3] > 200, 'active hold outline is crisp green');
  words.length = 0; sim.tick = hold.ends;
  renderer.safeZone(context, hold, sim, true);
  assert.deepEqual(words, []);
});

test('safe-zone confirmation requires the complete player collision disk inside', () => {
  const {renderer, context, lines} = canvasFixture();
  const sim = state(), destination = zone();
  sim.player.x = destination.x + destination.r - sim.player.r;
  sim.player.y = destination.y;
  renderer.safeZone(context, destination, sim, true);
  assert.equal(lines.length, 2, 'exact full-disk boundary renders the check mark');
  lines.length = 0;
  sim.player.x += .01;
  renderer.safeZone(context, destination, sim, true);
  assert.equal(lines.length, 0, 'center inside alone does not render the check mark');
});

test('hostile projectiles render orange-red heads and directional tails, distinct from friendly magic', () => {
  const {renderer, context, actual, colors} = canvasFixture();
  const sim = state(), bolt = projectile();
  renderer.hostileProjectile(context, bolt, sim, false);
  renderer.hostileProjectile(context, bolt, sim, true);
  assert.ok(colors.length >= 5);
  assert.ok(colors.every(color => {const rgb = channels(color); return rgb && rgb[0] > rgb[1] && rgb[1] > rgb[2];}), colors.join(', '));
  const head = pixel(actual, bolt.x, bolt.y), tail = pixel(actual, bolt.x - 22, bolt.y);
  assert.ok(head[0] > head[1] && head[1] > head[2] && head[3] > 200);
  assert.ok(tail[0] > tail[1] && tail[3] > 200, 'tail is behind a rightward projectile');
  assert.equal(pixel(actual, bolt.x + 22, bolt.y)[3], 0, 'tail does not point forward');
  context.clearRect(0, 0, 1000, 560);
  renderer.hostileProjectile(context, projectile({vx: 0, vy: 180}), sim, false);
  renderer.hostileProjectile(context, projectile({vx: 0, vy: 180}), sim, true);
  assert.ok(pixel(actual, bolt.x, bolt.y - 22)[3] > 200, 'tail rotates behind a downward projectile');
  assert.equal(pixel(actual, bolt.x, bolt.y + 22)[3], 0);
  colors.length = 0;
  sim.effect('projectile', sim.target(), {color: '#bc9dff', duration: 1});
  sim.tick += HZ / 4;
  renderer.magic(context, sim);
  assert.ok(colors.includes('#bc9dff'), 'friendly projectile retains its own spell palette');
});

test('expired and unborn projectiles produce no pixels', () => {
  const {renderer, context, actual} = canvasFixture();
  const sim = state();
  for (const bolt of [projectile({born: sim.tick + 1}), projectile({expires: sim.tick})]) {
    renderer.hostileProjectile(context, bolt, sim, false);
    renderer.hostileProjectile(context, bolt, sim, true);
  }
  assert.equal(actual.getImageData(0, 0, 1000, 560).data.some(Boolean), false);
});

test('real arena draws mechanics under actors and crisp outlines above friendly effects', () => {
  const {renderer, canvas, words} = canvasFixture();
  const sim = state(), order = [];
  sim.safeZones = [zone()];
  sim.hostileProjectiles = [projectile()];
  sim.hazards = [{type: 'circle', x: 650, y: 340, r: 76, born: 0, impact: 2 * HZ, ends: 3 * HZ}];
  sim.targets[0].name = 'Council north';
  for (const name of ['safeZone', 'hazard', 'hostileProjectile', 'target', 'magic', 'player']) {
    const draw = renderer[name].bind(renderer);
    renderer[name] = (...args) => {order.push(`${name}${typeof args[3] === 'boolean' ? `:${args[3]}` : ''}`); return draw(...args);};
  }
  renderer.draw(sim);
  assert.deepEqual(order, ['safeZone:false', 'hazard:false', 'hostileProjectile:false', 'target', 'magic', 'player', 'safeZone:true', 'hazard:true', 'hostileProjectile:true']);
  assert.ok(words.includes('COUNCIL NORTH'), 'permanent council members retain their real names');
  assert.ok(!words.includes('SENTINEL'));
  assert.ok(canvas.toBuffer('image/png').length > 10000, 'a complete native Canvas arena rasterizes');
});

test('letterboxed pointer coordinates retain exact world mapping for wide and tall arenas', () => {
  const wide = canvasFixture({left: 31, top: 47, width: 1200, height: 560}).renderer;
  assert.deepEqual(wide.pointFromClient(131, 47), {x: 0, y: 0});
  assert.deepEqual(wide.pointFromClient(631, 327), {x: 500, y: 280});
  assert.deepEqual(wide.pointFromClient(1131, 607), {x: 1000, y: 560});
  const tall = canvasFixture({left: 17, top: 23, width: 1000, height: 800}).renderer;
  assert.deepEqual(tall.pointFromClient(17, 143), {x: 0, y: 0});
  assert.deepEqual(tall.pointFromClient(517, 423), {x: 500, y: 280});
  assert.deepEqual(tall.pointFromClient(1017, 703), {x: 1000, y: 560});
});

test('offscreen wall projectiles and ground lines do not paint the letterbox gutters', () => {
  const {renderer, actual} = canvasFixture({left: 0, top: 0, width: 1200, height: 560});
  const sim = state();
  sim.hostileProjectiles = [projectile({x: -40, y: 280}), projectile({x: 1040, y: 280, vx: -180})];
  sim.hazards = [{type: 'line', x: 500, y: 280, angle: 0, width: 72, born: 0, impact: 2 * HZ, ends: 3 * HZ}];
  renderer.draw(sim);
  assert.deepEqual(pixel(actual, 60, 280), [13, 22, 34, 255]);
  assert.deepEqual(pixel(actual, 1140, 280), [13, 22, 34, 255]);
  assert.notDeepEqual(pixel(actual, 600, 280), [13, 22, 34, 255], 'the same lane still renders inside the arena');
});
