/** Functional spell sigils and cooldown clocks shared by the action bar and arena. */
// Readiness is a projection of the resolved loadout, not a second spell registry.
// Keeping the clock constant local also avoids an engine/icon dependency cycle.
const HZ = 60;
export const ICONS = {
  'veil-bolt': {name: 'Veil Bolt', light: '#e2cbff', mid: '#8763b6', dark: '#2a1b42'},
  'lingering-glimmer': {name: 'Lingering Glimmer', light: '#f6d8ff', mid: '#a36bb4', dark: '#371d43'},
  'gloam-thread': {name: 'Gloam Thread', light: '#b0edff', mid: '#397faa', dark: '#102d42'},
  'astral-flare': {name: 'Astral Flare', light: '#fff0c0', mid: '#ae8050', dark: '#3b291c'},
  'destructive-rift': {name: 'Destructive Rift', light: '#ffe5a2', mid: '#b9974c', dark: '#3b2c12'},
  'area-pulse': {name: 'Area Pulse', light: '#cce5ff', mid: '#5e8bbd', dark: '#172c48'},
  'chain-strike': {name: 'Chain Strike', light: '#b7ffdf', mid: '#488e85', dark: '#173b39'},
  'focused-energy': {name: 'Focused Energy', light: '#f2c7ff', mid: '#a370c7', dark: '#352044'},
};
const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const secondsLeft = (until, tick) => Math.max(0, ((until || 0) - tick) / HZ);
function path(c, points, fill = false) {
  c.beginPath();
  points.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p));
  if (fill) { c.closePath(); c.fill(); } else c.stroke();
}
function ring(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke(); }
function label(c, value, x, y, size, color = '#fff') {
  c.font = `700 ${size}px "Segoe UI", sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineJoin = 'round'; c.lineWidth = 3; c.strokeStyle = '#090d18'; c.strokeText(value, x, y);
  c.fillStyle = color; c.fillText(value, x, y);
}
function drawKeyLabel(c, value) {
  // Keep the single-key badge unchanged. Longer names use the available top
  // edge instead of extending left of the icon (including the 42px arena cue).
  if (value.length === 1) { label(c, value, 13, 14, 15); return; }
  c.font = '700 15px "Segoe UI", sans-serif';
  const width = c.measureText(value).width;
  const size = Math.min(15, 15 * 64 / Math.max(1, width));
  c.font = `700 ${size}px "Segoe UI", sans-serif`;
  const fittedWidth = c.measureText(value).width;
  label(c, value, Math.max(13, 8 + fittedWidth / 2), 14, size);
}

export function spellReadiness(sim, id) {
  const spell = sim.spells?.find(value => value.id === id);
  if (!spell) return {key: '', cooldown: 0, cooldownMax: 0, gcd: 0, gcdMax: 0, locked: true, ready: null, charges: 0, maxCharges: 0, recharge: 0, storedCharges: false};
  const chargeState = sim.spellCharges?.[id];
  const storedCharges = Boolean(chargeState);
  const charges = chargeState?.current ?? 0;
  const maxCharges = chargeState?.max ?? 0;
  const recharge = storedCharges && charges < maxCharges ? secondsLeft(chargeState.nextRecharge, sim.tick) : 0;
  const cooldown = storedCharges ? charges > 0 ? 0 : recharge : secondsLeft(sim.cooldowns?.[id], sim.tick);
  const gcd = spell.gcd > 0 ? secondsLeft(sim.gcdUntil, sim.tick) : 0;
  const required = spell.cost ? spell.cost.min ?? spell.cost.amount ?? 0 : 0;
  const resource = sim.resource?.value ?? 0;
  const resourceLocked = Boolean(spell.cost) && resource < required;
  const chargesLocked = storedCharges && charges <= 0;
  const locked = resourceLocked || chargesLocked;
  const ready = !locked && cooldown === 0 ? spell.cost ? 'resource' : storedCharges && charges > 0 ? 'charges' : null : null;
  return {
    key: spell.key, cooldown, cooldownMax: spell.cooldown || 0,
    gcd, gcdMax: sim.gcdDuration || spell.gcd || 0,
    locked, ready, charges, maxCharges, recharge, storedCharges,
    resource, resourceRequired: required, resourceLocked, chargesLocked,
  };
}

export function drawSpellIcon(c, id, x, y, size, {
  cooldown = 0, cooldownMax = 0, gcd = 0, gcdMax = 0,
  locked = false, ready = null, charges = 0, maxCharges = 0,
  storedCharges = false, key = true, clock = true,
} = {}) {
  const icon = ICONS[id] || ICONS['veil-bolt'];
  c.save(); c.translate(x, y); c.scale(size / 80, size / 80);
  c.fillStyle = '#090e18'; c.fillRect(0, 0, 80, 80);
  const bg = c.createRadialGradient(40, 31, 3, 40, 40, 55);
  bg.addColorStop(0, icon.mid); bg.addColorStop(.5, icon.dark); bg.addColorStop(1, '#101522');
  c.fillStyle = bg; c.fillRect(3, 3, 74, 74); c.strokeStyle = icon.light + '66'; c.lineWidth = 1; c.strokeRect(6.5, 6.5, 67, 67);
  c.save(); c.translate(40, 40); c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = icon.light; c.fillStyle = icon.light; c.lineWidth = 4;
  if (id === 'veil-bolt') {
    path(c, [[7, -29], [-20, 4], [-2, 2], [-8, 29], [22, -9], [4, -7]], true);
  } else if (id === 'lingering-glimmer') {
    ring(c, 0, 0, 17); c.lineWidth = 2; ring(c, 0, 0, 24);
    path(c, [[0, -12], [4, -4], [12, 0], [4, 4], [0, 12], [-4, 4], [-12, 0], [-4, -4]], true);
    for (const [x1, y1] of [[-22, -22], [23, -19], [21, 24]]) { c.beginPath(); c.arc(x1, y1, 3, 0, TAU); c.fill(); }
  } else if (id === 'gloam-thread') {
    for (const dy of [-12, 0, 12]) { c.beginPath(); c.moveTo(-25, dy + 4); c.bezierCurveTo(-8, dy - 16, 8, dy + 16, 25, dy - 4); c.stroke(); }
  } else if (id === 'astral-flare') {
    path(c, [[0, -29], [7, -9], [26, 0], [7, 8], [0, 29], [-7, 8], [-26, 0], [-7, -9]], true);
    c.lineWidth = 2; ring(c, 0, 0, 17); c.fillStyle = icon.dark; c.beginPath(); c.arc(0, 0, 4, 0, TAU); c.fill();
  } else if (id === 'destructive-rift') {
    c.save(); c.rotate(-.3); c.lineWidth = 5; c.beginPath(); c.ellipse(0, 0, 14, 25, 0, 0, TAU); c.stroke(); c.lineWidth = 2;
    c.beginPath(); c.ellipse(0, 0, 21, 30, 0, -1, 1.5); c.stroke();
    c.beginPath(); c.ellipse(0, 0, 21, 30, 0, Math.PI - 1, Math.PI + 1.5); c.stroke(); c.restore();
  } else if (id === 'area-pulse') {
    ring(c, 0, 0, 6); ring(c, 0, 0, 16); c.lineWidth = 3;
    for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(0, 0, 27, i * Math.PI / 2 + .15, i * Math.PI / 2 + 1.2); c.stroke(); }
  } else if (id === 'chain-strike') {
    path(c, [[-24, 17], [-5, -12], [8, 11], [26, -20]]); c.lineWidth = 3;
    for (const [cx, cy] of [[-24, 17], [-5, -12], [8, 11], [26, -20]]) { c.fillStyle = icon.dark; c.beginPath(); c.arc(cx, cy, 5, 0, TAU); c.fill(); c.stroke(); }
  } else if (id === 'focused-energy') {
    path(c, [[0, -21], [14, 0], [0, 21], [-14, 0]], true); c.lineWidth = 3;
    path(c, [[-15, -24], [-27, -24], [-27, -12]]); path(c, [[15, -24], [27, -24], [27, -12]]);
    path(c, [[-15, 24], [-27, 24], [-27, 12]]); path(c, [[15, 24], [27, 24], [27, 12]]);
  } else {
    ring(c, 0, 0, 20); path(c, [[0, -12], [0, 5]]); ring(c, 0, 13, 1);
  }
  c.restore();
  if (locked) { c.fillStyle = '#060b17b0'; c.fillRect(3, 3, 74, 74); }
  const cooldownFraction = cooldown > 0 ? clamp(cooldown / Math.max(cooldownMax, cooldown), 0, 1) : 0;
  const gcdFraction = gcd > 0 ? clamp(gcd / Math.max(gcdMax, gcd), 0, 1) : 0;
  const fraction = cooldown > 0 ? cooldownFraction : gcdFraction;
  if (clock && fraction > 0) {
    const angle = -Math.PI / 2 + TAU * (1 - fraction);
    c.save(); c.beginPath(); c.rect(3, 3, 74, 74); c.clip(); c.fillStyle = cooldown > 0 ? '#030814e8' : '#081725c7';
    c.beginPath(); c.moveTo(40, 40); c.arc(40, 40, 56, angle, Math.PI * 1.5); c.closePath(); c.fill();
    c.strokeStyle = cooldown > 0 ? '#e2e8ff' : '#9ae5ed'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(40, 40); c.lineTo(40 + Math.cos(angle) * 57, 40 + Math.sin(angle) * 57); c.stroke(); c.restore();
  }
  c.strokeStyle = ready === 'resource' ? '#ffe29a' : ready === 'charges' ? '#efc7ff' : cooldown > 0 ? '#687c9e' : icon.mid;
  c.lineWidth = ready ? 4 : 2; c.strokeRect(2, 2, 76, 76);
  if (gcd > 0 && clock) { c.strokeStyle = '#9ce5ed'; c.lineWidth = 2; c.beginPath(); c.arc(40, 40, 34, -Math.PI / 2 + TAU * (1 - gcdFraction), Math.PI * 1.5); c.stroke(); }
  if (ready) {
    c.strokeStyle = ready === 'resource' ? '#fff0c5' : '#fae7ff'; c.lineWidth = 2;
    for (const [sx, sy, dx, dy] of [[0, 0, 1, 1], [80, 0, -1, 1], [0, 80, 1, -1], [80, 80, -1, -1]]) path(c, [[sx + dx * 13, sy], [sx, sy], [sx, sy + dy * 13]]);
  }
  if (clock && (cooldown > 0 || gcd > 0)) {
    label(c, (cooldown > 0 ? cooldown : gcd).toFixed(1), 40, 45, cooldown > 0 ? 25 : 21, cooldown > 0 ? '#fff' : '#c5f9ff');
    label(c, cooldown > 0 ? 'CD' : 'GCD', 40, 63, 10, cooldown > 0 ? '#d9e3ff' : '#9ce5ed');
  }
  if (typeof key === 'string' && key) drawKeyLabel(c, key);
  if (storedCharges || maxCharges > 0 || charges > 0) label(c, String(charges), 67, 67, 14, icon.light);
  c.restore();
}
