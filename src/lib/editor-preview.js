export const EDITOR_WORLD = Object.freeze({width: 1000, height: 560});
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** The same contained world is used for painting and client-coordinate input. */
export function editorViewport(width, height) {
  const scale = Math.min(width / EDITOR_WORLD.width, height / EDITOR_WORLD.height);
  return {scale, x: (width - EDITOR_WORLD.width * scale) / 2, y: (height - EDITOR_WORLD.height * scale) / 2};
}

export function editorPoint(clientX, clientY, rect) {
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  const viewport = editorViewport(rect.width, rect.height);
  const x = (clientX - rect.left - viewport.x) / viewport.scale;
  const y = (clientY - rect.top - viewport.y) / viewport.scale;
  if (x < 0 || x > EDITOR_WORLD.width || y < 0 || y > EDITOR_WORLD.height) return null;
  return {x: Math.round(clamp(x, 30, 970)), y: Math.round(clamp(y, 30, 530))};
}

export function drawEditorPreview(canvas, draft, selection = 'player', width = 1000, height = 560, selectedPoint = 0) {
  const ctx = canvas?.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#09101a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const viewport = editorViewport(width, height);
  ctx.save();
  ctx.scale(canvas.width / width, canvas.height / height);
  ctx.translate(viewport.x, viewport.y); ctx.scale(viewport.scale, viewport.scale);
  ctx.fillStyle = '#101c28'; ctx.fillRect(0, 0, 1000, 560);
  const glow = ctx.createRadialGradient(500, 260, 20, 500, 260, 620);
  glow.addColorStop(0, '#253b451c'); glow.addColorStop(1, '#090e1670');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, 1000, 560);
  ctx.lineWidth = 1; ctx.strokeStyle = '#34465a35';
  for (let x = 50; x < 1000; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 560); ctx.stroke(); }
  for (let y = 30; y < 560; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1000, y); ctx.stroke(); }
  ctx.strokeStyle = '#52697980'; ctx.strokeRect(30, 30, 940, 500);
  ctx.font = '12px system-ui'; ctx.fillStyle = '#7e94a7';
  ctx.fillText('0, 0', 9, 16); ctx.fillText('1000 × 560', 909, 547);
  const circle = (x, y, radius, fill, stroke) => {
    ctx.beginPath(); ctx.arc(x, y, Math.max(1, finite(radius, 12)), 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.stroke();
  };
  const activeRule = draft.mechanics.find(rule => `mechanic:${rule.id}` === selection) ?? draft.addWaves.find(rule => `wave:${rule.id}` === selection);
  if (activeRule) {
    const placement = activeRule.placement;
    const origin = placement.mode === 'player' ? draft.playerStart : placement.mode === 'points' ? placement.points[selectedPoint] ?? placement.points[0] : placement;
    const x = finite(origin.x, 500), y = finite(origin.y, 280);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 1000, 560); ctx.clip(); ctx.lineWidth = 2; ctx.setLineDash([7, 6]);
    if (placement.mode === 'points') {
      // Point markers are painted last so they remain selectable over bosses and player markers.
      if (placement.selection === 'ordered' && placement.points.length > 1) {
        ctx.strokeStyle = '#c5a7e170'; ctx.beginPath();
        placement.points.forEach((point, index) => {
          const px = finite(point.x, 500), py = finite(point.y, 280);
          if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.stroke();
      }
    } else if (placement.mode === 'random' && activeRule.pattern !== 'wall') {
      ctx.fillStyle = '#d4c18a09'; ctx.fillRect(30, 30, 940, 500);
      ctx.strokeStyle = '#d4c18a90'; ctx.strokeRect(30, 30, 940, 500);
      ctx.fillStyle = '#dac691'; ctx.fillText(activeRule.kind ? 'RANDOM POSITION · sampled at each occurrence' : 'RANDOM POSITION · sampled for each add', 44, 52);
    } else if (activeRule.kind === 'line') {
      ctx.translate(x, y); ctx.rotate(finite(activeRule.angle) * Math.PI / 180);
      ctx.fillStyle = '#db885124'; ctx.fillRect(-1000, -finite(activeRule.width, 40) / 2, 2000, finite(activeRule.width, 40));
      ctx.strokeStyle = '#e5a56f'; ctx.strokeRect(-1000, -finite(activeRule.width, 40) / 2, 2000, finite(activeRule.width, 40));
    } else if (activeRule.kind === 'projectiles') {
      const angle = activeRule.pattern === 'aimed' ? Math.atan2(draft.playerStart.y - y, draft.playerStart.x - x) : finite(activeRule.angle) * Math.PI / 180;
      const distance = Math.abs(Math.cos(angle)) * 500 + Math.abs(Math.sin(angle)) * 280 + finite(activeRule.size, 8) + 2;
      const originX = activeRule.pattern === 'wall' ? 500 - Math.cos(angle) * distance : x;
      const originY = activeRule.pattern === 'wall' ? 280 - Math.sin(angle) * distance : y;
      const count = Math.min(32, finite(activeRule.count, 1));
      ctx.strokeStyle = '#e5a56f'; ctx.fillStyle = '#e5a56f';
      for (let index = 0; index < count; index++) {
        const spread = finite(activeRule.spread) * Math.PI / 180;
        const heading = activeRule.pattern === 'radial' ? angle + index * Math.PI * 2 / count
          : activeRule.pattern === 'aimed' ? angle
          : angle + (activeRule.pattern === 'fan' && count > 1 ? (index / (count - 1) - .5) * spread : 0);
        const shift = ['wall', 'aimed'].includes(activeRule.pattern) ? (index - (count - 1) / 2) * finite(activeRule.spacing, 60) : 0;
        const startX = originX - Math.sin(angle) * shift, startY = originY + Math.cos(angle) * shift;
        circle(startX, startY, finite(activeRule.size, 6), '#e5a56f65', '#e5a56f');
        ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(startX + Math.cos(heading) * 100, startY + Math.sin(heading) * 100); ctx.stroke();
      }
    } else if (activeRule.kind) {
      const safe = activeRule.kind.startsWith('safe-');
      circle(x, y, finite(activeRule.radius, 65), safe ? '#65c7b424' : '#db885124', safe ? '#89d6c4' : '#e5a56f');
      if (activeRule.kind === 'safe-hold') circle(x, y, Math.max(1, finite(activeRule.radius, 65) - 7), '#0000', '#89d6c450');
    } else circle(x, y, 30, '#b69ddb24', '#c5a7e1');
    ctx.restore();
  }
  for (const boss of draft.bosses) {
    const x = finite(boss.x, 500), y = finite(boss.y, 280);
    if (selection === `boss:${boss.id}`) { ctx.lineWidth = 2; circle(x, y, 29, '#dac69118', '#dac691'); }
    ctx.lineWidth = 2; circle(x, y, 19, '#393146', '#c1a3de');
    ctx.fillStyle = '#e5d4f3'; ctx.font = '17px system-ui'; ctx.textAlign = 'center'; ctx.fillText('◆', x, y + 6);
    ctx.font = '12px system-ui'; ctx.fillStyle = '#d6c2e6'; ctx.fillText(boss.name || 'Boss', x, y + 43);
  }
  const x = finite(draft.playerStart.x, 500), y = finite(draft.playerStart.y, 400);
  if (selection === 'player') { ctx.lineWidth = 2; circle(x, y, 24, '#94d9d718', '#dac691'); }
  ctx.lineWidth = 2; circle(x, y, 12, '#203e45', '#94d9d7');
  ctx.fillStyle = '#d7f4ed'; ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 5, y + 4); ctx.lineTo(x - 5, y + 4); ctx.closePath(); ctx.fill();
  ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#a8d8d3'; ctx.fillText('Player start', x, y + 37);
  if (activeRule?.placement.mode === 'points') {
    const {points, selection: pointSelection} = activeRule.placement;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 1000, 560); ctx.clip(); ctx.setLineDash([]);
    // Draw the selected point last, including when two authored points overlap.
    const indexes = points.map((_, index) => index).filter(index => index !== selectedPoint);
    if (points[selectedPoint]) indexes.push(selectedPoint);
    for (const index of indexes) {
      const point = points[index], px = finite(point.x, 500), py = finite(point.y, 280), selected = index === selectedPoint;
      ctx.lineWidth = selected ? 2.5 : 1.5;
      if (selected) circle(px, py, 25, '#dac69118', '#dac691');
      circle(px, py, 15, selected ? '#493e27' : '#352b44', selected ? '#f1d991' : '#c5a7e1');
      ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = selected ? '#fff2c9' : '#efddff'; ctx.fillText(String(index + 1), px, py);
    }
    ctx.font = '12px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#e0cbee';
    ctx.fillText(`SPAWN POINTS · ${pointSelection.toUpperCase()} · Point ${selectedPoint + 1} selected`, 44, 518);
    ctx.restore();
  }
  ctx.textAlign = 'left'; ctx.restore();
}
