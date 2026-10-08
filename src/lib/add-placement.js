/** ADD-only placement. Ground mechanics deliberately keep their own placement rules. */
import {DRILL_WORLD as WORLD} from './drills.js';

export const ADD_RADIUS = 20;
export const ADD_SPAWN_GAP = 2;
const EPSILON = 1e-7;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function liveSpawnObstacles(targets, tick = 0) {
  return targets.filter(target => (target.kind === 'add' || target.kind === 'dummy')
    && target.hp > 0 && (target.expires === undefined || target.expires > tick));
}
const boundsFor = radius => ({left: Math.max(WORLD.margin, radius), right: Math.min(WORLD.width - WORLD.margin, WORLD.width - radius),
  top: Math.max(WORLD.margin, radius), bottom: Math.min(WORLD.height - WORLD.margin, WORLD.height - radius)});
const circlesFor = (targets, tick, radius) => liveSpawnObstacles(targets, tick)
  .map(target => ({x: target.x, y: target.y, r: target.r + radius + ADD_SPAWN_GAP}));
const free = (point, circles, bounds) => Number.isFinite(point.x) && Number.isFinite(point.y)
  && point.x >= bounds.left - EPSILON && point.x <= bounds.right + EPSILON
  && point.y >= bounds.top - EPSILON && point.y <= bounds.bottom + EPSILON
  && circles.every(circle => (point.x - circle.x) ** 2 + (point.y - circle.y) ** 2 >= circle.r ** 2 - EPSILON);

export function isAddSpawnPointFree(point, targets, tick = 0, radius = ADD_RADIUS) {
  return free(point, circlesFor(targets, tick, radius), boundsFor(radius));
}

/**
 * Find the closest legal center, rather than taking a coarse grid's first vacancy.
 * A nearest point is either the requested point, a radial circle projection, a
 * circle/circle or circle/arena intersection, or a rectangle corner. Enumerating
 * those boundaries is a bounded equivalent to expanding a search radius: there
 * are O(n²) candidates for at most 64 adds + 8 bosses, and no retry/queue can grow.
 * Equal distances prefer up, left, down, right (counterclockwise from up).
 * Dead/expired targets don't occupy space. A completely covered arena returns null.
 */
export function findAddSpawnPosition(requested, targets, tick = 0, radius = ADD_RADIUS) {
  if (!Number.isFinite(requested?.x) || !Number.isFinite(requested?.y) || !Number.isFinite(radius) || radius <= 0) return null;
  const bounds = boundsFor(radius);
  if (bounds.left > bounds.right || bounds.top > bounds.bottom) return null;
  const circles = circlesFor(targets, tick, radius);
  const origin = {x: clamp(requested.x, bounds.left, bounds.right), y: clamp(requested.y, bounds.top, bounds.bottom)};
  if (free(origin, circles, bounds)) return origin;
  let best = null, distance = Infinity, direction = Infinity;
  const candidate = (x, y) => {
    if (!free({x, y}, circles, bounds)) return;
    x = clamp(x, bounds.left, bounds.right); y = clamp(y, bounds.top, bounds.bottom);
    const dx = x - origin.x, dy = y - origin.y, nextDistance = dx * dx + dy * dy;
    const nextDirection = (Math.atan2(-dx, -dy) + 2 * Math.PI) % (2 * Math.PI);
    if (nextDistance < distance - EPSILON || (Math.abs(nextDistance - distance) <= EPSILON && nextDirection < direction)) {
      best = {x, y}; distance = nextDistance; direction = nextDirection;
    }
  };
  for (const x of [bounds.left, bounds.right]) for (const y of [bounds.top, bounds.bottom]) candidate(x, y);
  // Edge projections cover requests clamped against an arena boundary.
  candidate(origin.x, bounds.top); candidate(bounds.left, origin.y);
  candidate(origin.x, bounds.bottom); candidate(bounds.right, origin.y);
  for (let i = 0; i < circles.length; i++) {
    const circle = circles[i], dx = origin.x - circle.x, dy = origin.y - circle.y, d = Math.hypot(dx, dy);
    if (d > EPSILON) candidate(circle.x + circle.r * dx / d, circle.y + circle.r * dy / d);
    else {
      candidate(circle.x, circle.y - circle.r); candidate(circle.x - circle.r, circle.y);
      candidate(circle.x, circle.y + circle.r); candidate(circle.x + circle.r, circle.y);
    }
    for (const x of [bounds.left, bounds.right]) {
      const h2 = circle.r ** 2 - (x - circle.x) ** 2;
      if (h2 >= -EPSILON) { const h = Math.sqrt(Math.max(0, h2)); candidate(x, circle.y - h); candidate(x, circle.y + h); }
    }
    for (const y of [bounds.top, bounds.bottom]) {
      const h2 = circle.r ** 2 - (y - circle.y) ** 2;
      if (h2 >= -EPSILON) { const h = Math.sqrt(Math.max(0, h2)); candidate(circle.x - h, y); candidate(circle.x + h, y); }
    }
    for (let j = i + 1; j < circles.length; j++) {
      const other = circles[j], vx = other.x - circle.x, vy = other.y - circle.y, length = Math.hypot(vx, vy);
      if (length < EPSILON || length > circle.r + other.r + EPSILON || length < Math.abs(circle.r - other.r) - EPSILON) continue;
      const along = (circle.r ** 2 - other.r ** 2 + length ** 2) / (2 * length);
      const h = Math.sqrt(Math.max(0, circle.r ** 2 - along ** 2));
      const x = circle.x + along * vx / length, y = circle.y + along * vy / length;
      candidate(x - h * vy / length, y + h * vx / length);
      candidate(x + h * vy / length, y - h * vx / length);
    }
  }
  return best;
}
