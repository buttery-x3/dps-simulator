<script>
  import {onMount, untrack} from 'svelte';
  import {DEFAULT_DRILL, DRILL_LIMITS, createDrill, createMechanic, createAddWave, validateDrill, exportDrill} from '../lib/drills.js';
  import {MAX_DRILL_IMPORT_BYTES, MAX_DRILL_LIBRARY_SIZE, newDrillId, parseDrillImport, mergeDrillImport, exportDrillLibrary} from '../lib/drill-storage.js';
  import {drawEditorPreview, editorPoint} from '../lib/editor-preview.js';

  let {library = [DEFAULT_DRILL], selectedId = DEFAULT_DRILL.id, onlibrarychange = () => {}, onselect = () => {}, onnotice = () => {}} = $props();
  const copy = value => JSON.parse(JSON.stringify(value));
  let draft = $state(copy(DEFAULT_DRILL));
  let baseline = $state(JSON.stringify(DEFAULT_DRILL));
  let loadedId = $state(null);
  let isNew = $state(false);
  let tool = $state('player');
  let selectedPoints = $state({});
  let notice = $state('');
  let noticeIsError = $state(false);
  let importOpen = $state(false);
  let importText = $state('');
  let importBusy = $state(false);
  let canvas;
  let previewSize = $state({width: 1000, height: 560});
  let dragging = false;
  let disposed = false;
  let importGeneration = 0;
  const dirty = $derived(isNew || JSON.stringify(draft) !== baseline);
  const validation = $derived(validateDrill(draft));
  const kindLabels = {circle: 'Hostile circle', line: 'Hostile line', projectiles: 'Projectile pattern', 'safe-deadline': 'Safe-zone deadline', 'safe-hold': 'Safe-zone hold'};
  const activeRule = $derived(draft.mechanics.find(rule => `mechanic:${rule.id}` === tool) ?? draft.addWaves.find(rule => `wave:${rule.id}` === tool));
  const selectedBoss = $derived(draft.bosses.find(boss => `boss:${boss.id}` === tool));
  const activePointList = $derived(activeRule && !activeRule.kind && activeRule.placement.mode === 'points' ? activeRule : null);
  const activePointIndex = $derived(activePointList ? pointIndex(activePointList) : 0);
  const toolLabel = $derived(tool === 'player' ? 'Player start' : selectedBoss ? selectedBoss.name || 'Boss' : activePointList ? `Add-wave point ${activePointIndex + 1}` : activeRule ? activeRule.kind ? kindLabels[activeRule.kind] : 'Add-wave origin' : 'Player start');
  const canPlace = $derived(!activeRule || Boolean(activePointList) || (activeRule.placement.mode === 'fixed' && !(activeRule.kind === 'projectiles' && activeRule.pattern === 'wall')));

  $effect(() => {
    const selected = library.find(item => item.id === selectedId) ?? library[0];
    if (selected && selected.id !== untrack(() => loadedId)) loadDraft(selected);
  });
  $effect(() => { if (canvas) drawEditorPreview(canvas, draft, tool, previewSize.width, previewSize.height, activePointIndex); });

  onMount(() => {
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const width = rect.width || 1000, height = rect.height || 560;
      const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      previewSize = {width, height};
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    observer?.observe(canvas); resize();
    const beforeUnload = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('resize', resize);
    return () => { disposed = true; cancelImportRead(); observer?.disconnect(); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('resize', resize); };
  });

  function announce(message, error = false) { notice = message; noticeIsError = error; if (error) onnotice(message); }
  function cancelImportRead() { importGeneration++; importBusy = false; }
  function closeImport() { cancelImportRead(); importOpen = false; }
  function toggleImport() { if (importOpen) closeImport(); else importOpen = true; }
  function loadDraft(drill) {
    cancelImportRead();
    draft = copy(drill); baseline = JSON.stringify(draft); loadedId = drill.id; isNew = false; tool = 'player'; selectedPoints = {}; notice = '';
  }
  function discardAllowed() { return !dirty || window.confirm('Discard your unsaved changes to this drill?'); }
  export function prepareLeave() {
    if (!discardAllowed()) return false;
    const saved = library.find(item => item.id === selectedId) ?? library[0];
    if (saved) loadDraft(saved);
    return true;
  }
  export function getDraft() { return {drill: copy(draft), dirty, valid: validation.valid, errors: [...validation.errors]}; }
  function selectDrill(event) {
    const id = event.currentTarget.value;
    if (!discardAllowed()) { event.currentTarget.value = isNew ? '' : draft.id; return; }
    const saved = library.find(item => item.id === id);
    if (saved) { loadDraft(saved); onselect(id); }
  }
  function newDrill(fromDefault = false) {
    if (!discardAllowed()) return;
    cancelImportRead();
    draft = createDrill({id: newDrillId(), name: fromDefault ? `${DEFAULT_DRILL.name} variation` : 'Untitled drill', ...(fromDefault ? {} : {addWaves: [], mechanics: []})});
    baseline = ''; isNew = true; tool = fromDefault && draft.addWaves[0] ? `wave:${draft.addWaves[0].id}` : 'player'; selectedPoints = {}; notice = '';
  }
  function saveDrill(asNew = false, duplicate = false) {
    const result = validateDrill(draft);
    if (!result.valid) { announce('Fix the highlighted drill settings before saving.', true); return; }
    const newItem = asNew || isNew || !library.some(item => item.id === draft.id);
    if (newItem && library.length >= MAX_DRILL_LIBRARY_SIZE) { announce(`Your library is full (${MAX_DRILL_LIBRARY_SIZE} drills). Delete a drill first.`, true); return; }
    const saved = copy(result.value);
    if (asNew) {
      saved.id = newDrillId();
      if (duplicate || library.some(item => item.name === saved.name)) saved.name = `${saved.name.slice(0, 95)} copy`;
    }
    const next = newItem ? [...library.map(copy), saved] : library.map(item => item.id === saved.id ? saved : copy(item));
    loadDraft(saved);
    onlibrarychange(next, saved.id);
    announce(`“${saved.name}” is ready for your next Start.`);
  }
  function deleteDrill() {
    const saved = library.find(item => item.id === draft.id);
    if (!saved || library.length <= 1) return;
    if (!window.confirm(`Delete “${saved.name}” from this browser?${dirty ? ' Your unsaved changes will also be discarded.' : ''}`)) return;
    const next = library.filter(item => item.id !== saved.id).map(copy);
    loadDraft(next[0]); onlibrarychange(next, next[0].id); announce(`Deleted “${saved.name}”.`);
  }
  function numberValue(object, key, event) {
    object[key] = event.currentTarget.value === '' ? undefined : Number(event.currentTarget.value);
  }
  function addBoss() {
    const id = `boss-${newDrillId().slice(6)}`;
    draft.bosses.push({id, name: `Boss ${draft.bosses.length + 1}`, x: Math.min(900, 360 + draft.bosses.length * 100), y: 160});
    tool = `boss:${id}`;
  }
  function addWave() { const wave = createAddWave({id: `wave-${newDrillId().slice(6)}`}); draft.addWaves.push(wave); tool = `wave:${wave.id}`; }
  function pointIndex(wave) { return Math.min(Math.max(selectedPoints[wave.id] ?? 0, 0), wave.placement.points.length - 1); }
  function selectPoint(wave, index) { tool = `wave:${wave.id}`; selectedPoints[wave.id] = index; }
  function changePlacement(rule, event) {
    const mode = event.currentTarget.value;
    if (mode === rule.placement.mode) return;
    if (mode === 'points' && !rule.kind) {
      rule.placement = {mode, selection: 'ordered', points: [{x: rule.placement.x, y: rule.placement.y}]};
      selectPoint(rule, 0);
    } else if (rule.placement.mode === 'points') {
      const point = rule.placement.points[pointIndex(rule)];
      rule.placement = {mode, x: point.x, y: point.y};
      delete selectedPoints[rule.id];
    } else rule.placement.mode = mode;
  }
  function addPoint(wave) {
    if (wave.placement.points.length >= DRILL_LIMITS.spawnPoints) return;
    wave.placement.points.push({x: 500, y: 280});
    selectPoint(wave, wave.placement.points.length - 1);
  }
  function removePoint(wave, index) {
    const points = wave.placement.points;
    if (points.length <= 1) return;
    const selected = pointIndex(wave);
    points.splice(index, 1);
    selectedPoints[wave.id] = Math.min(selected - (index < selected ? 1 : 0), points.length - 1);
  }
  function movePoint(wave, index, direction) {
    const target = index + direction, points = wave.placement.points;
    if (target < 0 || target >= points.length) return;
    const selected = pointIndex(wave);
    [points[index], points[target]] = [points[target], points[index]];
    selectedPoints[wave.id] = selected === index ? target : selected === target ? index : selected;
  }
  function changePattern(rule, event) {
    rule.pattern = event.currentTarget.value;
    if (rule.pattern === 'aimed') { rule.angle = 0; rule.direction = 'fixed'; }
    if (rule.pattern === 'wall') rule.spacing = Math.max(rule.spacing, 2 * rule.size + 26);
  }
  function addRule(kind) { const rule = createMechanic(kind, {id: `rule-${newDrillId().slice(6)}`}); draft.mechanics.push(rule); tool = `mechanic:${rule.id}`; }
  function removeItem(collection, id) { draft[collection] = draft[collection].filter(item => item.id !== id); if (tool.endsWith(`:${id}`)) tool = 'player'; }
  function place(point) {
    if (!point || !canPlace) return;
    if (tool === 'player') Object.assign(draft.playerStart, point);
    else if (selectedBoss) Object.assign(selectedBoss, point);
    else if (activePointList) Object.assign(activePointList.placement.points[activePointIndex], point);
    else if (activeRule) Object.assign(activeRule.placement, point);
  }
  function pointerDown(event) {
    if (event.button !== 0) return;
    const point = editorPoint(event.clientX, event.clientY, canvas.getBoundingClientRect());
    if (!point) return;
    if (activePointList) {
      const hit = activePointList.placement.points.map((item, index) => ({index, distance: Math.hypot(item.x - point.x, item.y - point.y)}))
        .filter(item => item.distance < 18).sort((a, b) => a.distance - b.distance || (a.index === activePointIndex ? -1 : b.index === activePointIndex ? 1 : a.index - b.index))[0];
      if (hit) selectPoint(activePointList, hit.index);
    } else {
      const boss = [...draft.bosses].reverse().find(item => Math.hypot(item.x - point.x, item.y - point.y) < 24);
      if (boss) tool = `boss:${boss.id}`;
      else if (Math.hypot(draft.playerStart.x - point.x, draft.playerStart.y - point.y) < 19) tool = 'player';
    }
    dragging = true; canvas.setPointerCapture?.(event.pointerId); place(point);
  }
  function pointerMove(event) { if (dragging) place(editorPoint(event.clientX, event.clientY, canvas.getBoundingClientRect())); }
  function pointerEnd() { dragging = false; }
  function canvasKey(event) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || !canPlace) return;
    event.preventDefault();
    const origin = tool === 'player' ? draft.playerStart : selectedBoss ?? (activePointList ? activePointList.placement.points[activePointIndex] : activeRule?.placement);
    if (!origin) return;
    const step = event.shiftKey ? 10 : 1;
    place({x: Math.min(970, Math.max(30, origin.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0))), y: Math.min(530, Math.max(30, origin.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)))});
  }
  function download(text, name) {
    let url;
    try {
      url = URL.createObjectURL(new Blob([`${text}\n`], {type: 'application/json'}));
      const link = document.createElement('a'); link.href = url; link.download = `${name.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 70) || 'drill'}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      announce('JSON export downloaded. Keep this file as a portable backup.');
    } catch { if (url) URL.revokeObjectURL(url); announce('The browser could not download the file. Try again in a browser that supports file downloads.', true); }
  }
  function exportCurrent() {
    try { download(exportDrill(draft), draft.name); } catch { announce('Fix the drill settings before exporting.', true); }
  }
  function exportLibrary() {
    try { download(exportDrillLibrary(library, selectedId), 'training-drill-library'); } catch (error) { announce(error.message, true); }
  }
  function importJSON(text) {
    const parsed = parseDrillImport(text);
    if (!parsed.ok) { announce(`Import rejected: ${parsed.reason}`, true); return; }
    let merged = mergeDrillImport(library, parsed);
    if (!merged.ok && merged.reason === 'collision') {
      const names = merged.collisions.map(item => `“${item.name}”`).join(', ');
      if (!window.confirm(`Replace ${merged.collisions.length} saved drill${merged.collisions.length === 1 ? '' : 's'} with matching IDs (${names})? Other saved drills will be kept.`)) return;
      merged = mergeDrillImport(library, parsed, {replace: true});
    }
    if (!merged.ok) { announce(`Import rejected: ${merged.reason}`, true); return; }
    if (!discardAllowed()) return;
    loadDraft(merged.library.find(item => item.id === merged.selectedId));
    onlibrarychange(merged.library, merged.selectedId); importText = ''; importOpen = false;
    announce(`Imported ${parsed.drills.length} drill${parsed.drills.length === 1 ? '' : 's'}. Saved drills are ready for your next Start.`);
  }
  async function importFile(event) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
    if (!file || importBusy) return;
    if (file.size > MAX_DRILL_IMPORT_BYTES) { announce('Import rejected: choose a JSON file smaller than 1 MiB.', true); return; }
    const generation = ++importGeneration;
    importBusy = true;
    try {
      const text = await file.text();
      if (!disposed && generation === importGeneration) importJSON(text);
    } catch { if (!disposed && generation === importGeneration) announce('The file could not be read. Try pasting its JSON instead.', true); }
    finally { if (!disposed && generation === importGeneration) importBusy = false; }
  }
</script>

{#snippet numberField(object, key, label, min, max, step = 1, accessibleLabel = label)}
  <label class="field"><span>{label}</span><input type="number" aria-label={accessibleLabel} value={object[key] ?? ''} {min} {max} step={key === 'seed' || key === 'count' ? 1 : 'any'} oninput={event => numberValue(object, key, event)} /></label>
{/snippet}
{#snippet placementFields(rule, label)}
  <div class="placement-fields">
    <label class="field"><span>Placement</span><select aria-label={`${label} placement`} value={rule.placement.mode} onchange={event => changePlacement(rule, event)}><option value="fixed">Fixed world position</option><option value="player">Player position on spawn</option><option value="random">Seeded random position</option>{#if !rule.kind}<option value="points">Spawn-point list</option>{/if}</select></label>
    {#if rule.placement.mode === 'fixed'}
      {@render numberField(rule.placement, 'x', 'Origin X', 30, 970)}
      {@render numberField(rule.placement, 'y', 'Origin Y', 30, 530)}
    {/if}
  </div>
  {#if rule.placement.mode === 'points'}
    <div class="point-list" role="group" aria-label={`${label} spawn points`}>
      <label class="field"><span>Point selection</span><select aria-label={`${label} point selection`} value={rule.placement.selection} onchange={event => rule.placement.selection = event.currentTarget.value}><option value="random">Random (seeded)</option><option value="ordered">Ordered (cycle)</option><option value="priority">Priority (first available)</option></select></label>
      <p class="field-help">{rule.placement.selection === 'random' ? "Each target picks a point using the drill's seed; repeats are possible." : rule.placement.selection === 'ordered' ? 'Each target uses the next point in list order. The sequence continues across waves and restarts with a new session.' : 'Each target tries points from top to bottom, avoiding live adds and bosses. If all are occupied, it searches for nearby free space from the first point.'}</p>
      <div class="point-list-heading"><strong>Spawn points</strong><span>{rule.placement.points.length} / {DRILL_LIMITS.spawnPoints}</span></div>
      {#each rule.placement.points as point, index}
        <div class="point-row" class:active={tool === `wave:${rule.id}` && pointIndex(rule) === index}>
          <div class="point-row-actions">
            <button type="button" class="point-select" class:chosen={tool === `wave:${rule.id}` && pointIndex(rule) === index} aria-label={`${label}: select point ${index + 1}`} aria-pressed={tool === `wave:${rule.id}` && pointIndex(rule) === index} onclick={() => selectPoint(rule, index)}>Point {index + 1}</button>
            <div class="point-order-actions"><button type="button" class="quiet" aria-label={`${label}: move point ${index + 1} up`} disabled={index === 0} onclick={() => movePoint(rule, index, -1)}>↑</button><button type="button" class="quiet" aria-label={`${label}: move point ${index + 1} down`} disabled={index === rule.placement.points.length - 1} onclick={() => movePoint(rule, index, 1)}>↓</button><button type="button" class="quiet remove-button" aria-label={`${label}: remove point ${index + 1}`} disabled={rule.placement.points.length <= 1} onclick={() => removePoint(rule, index)}>Remove</button></div>
          </div>
          <div class="field-grid">{@render numberField(point, 'x', `Point ${index + 1} X`, 30, 970, 1, `${label} point ${index + 1} X`)}{@render numberField(point, 'y', `Point ${index + 1} Y`, 30, 530, 1, `${label} point ${index + 1} Y`)}</div>
        </div>
      {/each}
      <button type="button" class="add-button" aria-label={`${label}: add spawn point`} disabled={rule.placement.points.length >= DRILL_LIMITS.spawnPoints} onclick={() => addPoint(rule)}>＋ Add spawn point</button>
      <p class="field-help">Select a numbered point, then click or drag in the world to move it. Arrows change list order. Markers show authored anchors; crowded spawns shift to nearby free space.</p>
    </div>
  {/if}
  {#if rule.placement.mode === 'player'}<p class="field-help">Locks the player's location when each occurrence starts; it does not chase the player.</p>{/if}
  {#if rule.placement.mode === 'random'}<p class="field-help">{rule.kind ? 'Picks a new position each occurrence' : 'Picks a new position for each target'}, reproducible with this drill's seed.</p>{/if}
{/snippet}
{#snippet timingFields(rule)}
  <div class="field-grid">
    {@render numberField(rule, 'first', 'First occurrence (s)', 0, 3600, .1)}
    {@render numberField(rule, 'frequency', 'Repeat every (s)', .25, 3600, .05)}
  </div>
{/snippet}
{#snippet directionFields(rule)}
  <div class="field-grid">
    <label class="field"><span>Direction</span><select value={rule.direction} onchange={event => rule.direction = event.currentTarget.value}><option value="fixed">Fixed angle</option><option value="random">Seeded random angle</option><option value="sequence">Sequenced angle</option></select></label>
    {#if rule.direction !== 'random'}{@render numberField(rule, 'angle', rule.direction === 'sequence' ? 'Starting angle (°)' : 'Angle (°)', -3600, 3600)}{/if}
    {#if rule.direction === 'sequence'}{@render numberField(rule, 'angleStep', 'Angle step per repeat (°)', -3600, 3600)}{/if}
  </div>
  <p class="field-help">0° points right; 90° points down.{rule.direction === 'sequence' ? ' Each repeat adds the angle step.' : ''}</p>
{/snippet}

<section class="drill-editor" aria-label="Training drill editor" data-dirty={dirty}>
  <header class="editor-header">
    <div><p class="editor-eyebrow">ENCOUNTER WORKSHOP</p><h2>Build your practice</h2><p class="editor-intro">Place your targets. Shape the pressure. Repeat with the same seed.</p></div>
    <span class="draft-badge" class:dirty aria-live="polite">{dirty ? '● Unsaved changes' : '✓ Saved drill'}</span>
  </header>

  <div class="library-bar">
    <label class="library-select field"><span>Saved drill library</span><select aria-label="Saved drill library" value={isNew ? '' : draft.id} onchange={selectDrill}>{#if isNew}<option value="" disabled>New unsaved drill</option>{/if}{#each library as item (item.id)}<option value={item.id}>{item.name}</option>{/each}</select></label>
    <div class="library-actions"><button type="button" onclick={() => newDrill()}>＋ New</button><button type="button" title="Create a copy of the current built-in practice drill" onclick={() => newDrill(true)}>New from default</button><button type="button" onclick={() => saveDrill(true, true)} disabled={!validation.valid}>Duplicate</button><button type="button" class="quiet danger" onclick={deleteDrill} disabled={isNew || library.length <= 1}>Delete</button></div>
    <div class="file-actions"><button type="button" class="quiet" onclick={exportCurrent} disabled={!validation.valid}>Export drill</button><button type="button" class="quiet" onclick={exportLibrary}>Export library</button><button type="button" class="quiet" aria-expanded={importOpen} onclick={toggleImport}>Import JSON</button></div>
  </div>

  {#if importOpen}
    <section class="import-panel" aria-label="Import drills">
      <div><h3>Bring a drill with you</h3><p>Import one drill or a library, up to 1 MiB. Matching IDs ask before replacement; other drills stay in your library.</p></div>
      <label class="file-picker">Choose a JSON file<input type="file" accept=".json,application/json" disabled={importBusy} onchange={importFile} /></label>
      <label class="field"><span>Or paste drill JSON</span><textarea bind:value={importText} rows="5" maxlength={MAX_DRILL_IMPORT_BYTES} spellcheck="false" placeholder="Paste exported JSON here"></textarea></label>
      <div class="import-actions"><button type="button" onclick={closeImport}>Cancel</button><button type="button" class="primary" disabled={!importText.trim() || importBusy} onclick={() => importJSON(importText)}>{importBusy ? 'Reading…' : 'Validate & import'}</button></div>
    </section>
  {/if}

  {#if notice}<p class="editor-notice" class:error={noticeIsError} role={noticeIsError ? 'alert' : 'status'}>{notice}</p>{/if}

  <div class="editor-layout">
    <div class="world-column">
      <div class="world-heading"><h3>World layout</h3><span>1000 × 560 world units</span></div>
      <div class="preview-shell">
        <canvas bind:this={canvas} width="1000" height="560" tabindex="0" aria-label="Drill layout. Select a placement tool, then click or drag to move it. Arrow keys move one unit; Shift plus arrow moves ten units." aria-describedby="placementHint" onpointerdown={pointerDown} onpointermove={pointerMove} onpointerup={pointerEnd} onpointercancel={pointerEnd} onlostpointercapture={pointerEnd} onkeydown={canvasKey}></canvas>
      </div>
      <div class="placement-toolbar" role="group" aria-label="Placement tools">
        <button type="button" class:chosen={tool === 'player'} aria-pressed={tool === 'player'} onclick={() => tool = 'player'}><span class="player-dot">●</span> Player start</button>
        {#each draft.bosses as boss (boss.id)}<button type="button" class:chosen={tool === `boss:${boss.id}`} aria-pressed={tool === `boss:${boss.id}`} onclick={() => tool = `boss:${boss.id}`}><span class="boss-dot">◆</span> {boss.name || 'Boss'}</button>{/each}
      </div>
      <p id="placementHint" class="placement-hint"><strong>{toolLabel}</strong> · {canPlace ? activePointList ? 'Click to place the selected point, or drag a numbered marker. Arrow keys move the selected point.' : 'Click the world or drag a marker to place. Arrow keys work when the canvas is focused.' : activeRule?.pattern === 'wall' ? 'Wall spawns follow the arena edge and travel angle.' : 'This rule chooses its position at runtime. Choose Fixed world position to place it here.'}</p>
      <div class="preview-legend"><span><i class="legend-player"></i>Player</span><span><i class="legend-boss"></i>Permanent boss</span><span><i class="legend-hostile"></i>Hostile mechanic</span><span><i class="legend-safe"></i>Safe zone</span></div>
      <p class="preview-note">Layout preview shows the selected rule's footprint or initial projectile direction, before the encounter runs. Random rules show a placement guide. Green areas are places to be safe.</p>

      <section class="editor-card identity-card" aria-label="Drill identity">
        <div class="section-heading"><h3>Drill settings</h3><span>Reproducible practice</span></div>
        <label class="field"><span>Drill name</span><input type="text" maxlength="100" bind:value={draft.name} /></label>
        <div class="field-grid">{@render numberField(draft, 'seed', 'Random seed', 1, 4294967295)}<div class="seed-help">The same seed repeats the same random pattern choices. Start a new session to replay from the beginning.</div></div>
      </section>
      <section class="editor-card" aria-label="Player and permanent bosses">
        <div class="section-heading"><h3>Player & permanent bosses</h3><span>{draft.bosses.length} / 8 bosses</span></div>
        <div class="spawn-row"><strong class="spawn-label">Player start</strong><div class="field-grid">{@render numberField(draft.playerStart, 'x', 'Player X', 30, 970)}{@render numberField(draft.playerStart, 'y', 'Player Y', 30, 530)}</div></div>
        {#each draft.bosses as boss, index (boss.id)}
          <div class="boss-row" class:active={tool === `boss:${boss.id}`}>
            <div class="boss-title"><button type="button" class="boss-select quiet" onclick={() => tool = `boss:${boss.id}`} aria-label={`Place boss ${index + 1}`}>◆ Boss {index + 1}</button><button type="button" class="quiet remove-button" disabled={draft.bosses.length <= 1} onclick={() => removeItem('bosses', boss.id)} aria-label={`Remove boss ${index + 1}`}>Remove</button></div>
            <label class="field"><span>Boss {index + 1} name</span><input type="text" maxlength="100" bind:value={boss.name} /></label>
            <div class="field-grid">{@render numberField(boss, 'x', `Boss ${index + 1} X`, 30, 970)}{@render numberField(boss, 'y', `Boss ${index + 1} Y`, 30, 530)}</div>
          </div>
        {/each}
        <button type="button" class="add-button" disabled={draft.bosses.length >= DRILL_LIMITS.bosses} onclick={addBoss}>＋ Add permanent boss</button>
        <p class="field-help">Keep at least one boss. Permanent bosses stay for the whole session; add waves below are temporary.</p>
      </section>
    </div>

    <div class="rules-column">
      <div class="world-heading"><h3>Recurring rules</h3><span>Seconds · world units · degrees</span></div>
      <p class="rules-intro">Each rule repeats independently from its first occurrence. The drill continues until you stop it.</p>
      <section class="rule-section" aria-label="Add wave rules">
        <div class="section-heading"><h3>Add waves</h3><span>{draft.addWaves.length} / 16</span></div>
        {#if draft.addWaves.length === 0}<p class="empty-rules">A quiet arena for now. Add temporary targets on their own schedule.</p>{/if}
        {#each draft.addWaves as wave, index (wave.id)}
          <details class="rule-card wave-card" open={tool === `wave:${wave.id}`}>
            <summary><span class="rule-number">{String(index + 1).padStart(2, '0')}</span><span>Add wave <small>{wave.count} targets · every {wave.frequency}s</small></span><span class="expand-icon">＋</span></summary>
            <div class="rule-body">
              <div class="rule-actions"><button type="button" class:chosen={tool === `wave:${wave.id}`} aria-pressed={tool === `wave:${wave.id}`} onclick={() => tool = `wave:${wave.id}`}>{wave.placement.mode === 'points' ? 'Preview / place points' : 'Preview / place origin'}</button><button type="button" class="quiet remove-button" aria-label={`Remove add wave ${index + 1}`} onclick={() => removeItem('addWaves', wave.id)}>Remove</button></div>
              {@render timingFields(wave)}
              <div class="field-grid">{@render numberField(wave, 'count', 'Targets per wave', 1, 32)}{@render numberField(wave, 'health', 'Health per target', 1, 10000000)}{@render numberField(wave, 'lifetime', 'Target lifetime (s)', 1 / 60, 120, .1)}</div>
              {@render placementFields(wave, `Add wave ${index + 1}`)}
            </div>
          </details>
        {/each}
        <button type="button" class="add-button" disabled={draft.addWaves.length >= DRILL_LIMITS.addWaves} onclick={addWave}>＋ Add wave rule</button>
      </section>
      <section class="rule-section" aria-label="Mechanic rules">
        <div class="section-heading"><h3>Mechanics</h3><span>{draft.mechanics.length} / 32</span></div>
        {#if draft.mechanics.length === 0}<p class="empty-rules">Layer in shapes, projectiles, and safe zones. Add just what you want to practice.</p>{/if}
        {#each draft.mechanics as rule, index (rule.id)}
          <details class="rule-card" class:safe-card={rule.kind.startsWith('safe-')} open={tool === `mechanic:${rule.id}`}>
            <summary><span class="rule-number">{String(index + 1).padStart(2, '0')}</span><span>{kindLabels[rule.kind]}<small>First at {rule.first}s · every {rule.frequency}s</small></span><span class="expand-icon">＋</span></summary>
            <div class="rule-body">
              <div class="rule-actions"><button type="button" class:chosen={tool === `mechanic:${rule.id}`} aria-pressed={tool === `mechanic:${rule.id}`} onclick={() => tool = `mechanic:${rule.id}`}>Preview / place origin</button><button type="button" class="quiet remove-button" aria-label={`Remove ${kindLabels[rule.kind].toLowerCase()} ${index + 1}`} onclick={() => removeItem('mechanics', rule.id)}>Remove</button></div>
              {#if rule.kind === 'safe-deadline'}<p class="mechanic-help safe-help">Be fully inside when the countdown ends. Being outside at that instant counts as one hit.</p>{:else if rule.kind === 'safe-hold'}<p class="mechanic-help safe-help">After the countdown, keep your whole player inside an active safe zone for the hold duration. Time outside all active safe zones accumulates damage once per second.</p>{:else if rule.kind === 'circle'}<p class="mechanic-help">A warning circle detonates after its delay. Move out before it resolves.</p>{:else if rule.kind === 'line'}<p class="mechanic-help">A warning stripe crosses the arena, then resolves. Move clear of the stripe.</p>{:else}<p class="mechanic-help">Projectiles spawn on each occurrence. Size is projectile radius; speed is world units per second.</p>{/if}
              {@render timingFields(rule)}
              {#if rule.kind === 'projectiles' && rule.pattern === 'wall'}<p class="field-help">Walls enter from the arena edge opposite their travel direction. Their spawn position follows the angle.</p>{:else}{@render placementFields(rule, `${kindLabels[rule.kind]} ${index + 1}`)}{/if}
              {#if rule.kind === 'projectiles'}
                <label class="field"><span>Projectile pattern</span><select value={rule.pattern} onchange={event => changePattern(rule, event)}><option value="aimed">Aimed at the player</option><option value="fan">Fan</option><option value="radial">Radial ring</option><option value="wall">Equidistant wall</option></select></label>
                <div class="field-grid">{@render numberField(rule, 'count', 'Projectile count', 1, 32)}{@render numberField(rule, 'size', 'Projectile radius', 2, 40)}{@render numberField(rule, 'speed', 'Projectile speed', 10, 1200)}{@render numberField(rule, 'lifetime', 'Projectile lifetime (s)', 1 / 60, 120, .1)}</div>
                {#if rule.pattern === 'fan'}{@render numberField(rule, 'spread', 'Fan spread (°)', 0, 360)}{/if}
                {#if rule.pattern === 'wall' || rule.pattern === 'aimed'}{@render numberField(rule, 'spacing', rule.pattern === 'wall' ? 'Wall center-to-center spacing' : 'Projectile center-to-center spacing', rule.pattern === 'wall' ? Math.max(30, 2 * (rule.size || 0) + 26) : 30, 1000)}{#if rule.pattern === 'wall'}<p class="field-help">Even spacing leaves gaps to dodge through. Minimum spacing is twice the projectile radius + 26.</p>{/if}{/if}
                {#if rule.pattern === 'aimed'}<p class="field-help">Aims directly at the player's position when the wave spawns. Parallel shots use the same heading.</p>{:else}{@render directionFields(rule)}{/if}
              {:else}
                <div class="field-grid">{@render numberField(rule, 'delay', rule.kind.startsWith('safe-') ? 'Countdown (s)' : 'Warning delay (s)', 0, 120, .1)}{#if rule.kind === 'line'}{@render numberField(rule, 'width', 'Stripe width', 12, 1000)}{:else}{@render numberField(rule, 'radius', 'Zone radius', 12, 450)}{/if}{#if rule.kind === 'safe-hold'}{@render numberField(rule, 'duration', 'Hold duration (s)', 1 / 60, 120, .1)}{/if}</div>
                {#if rule.kind === 'line'}{@render directionFields(rule)}{/if}
              {/if}
              {@render numberField(rule, 'damage', 'Damage per hit', 0, 100000)}
            </div>
          </details>
        {/each}
        <div class="mechanic-palette" role="group" aria-label="Add mechanic">
          <button type="button" disabled={draft.mechanics.length >= DRILL_LIMITS.mechanics} onclick={() => addRule('circle')}><span>◯</span> Hostile circle</button>
          <button type="button" disabled={draft.mechanics.length >= DRILL_LIMITS.mechanics} onclick={() => addRule('line')}><span>╱</span> Hostile line</button>
          <button type="button" disabled={draft.mechanics.length >= DRILL_LIMITS.mechanics} onclick={() => addRule('projectiles')}><span>⋙</span> Projectiles</button>
          <button type="button" class="safe-add" disabled={draft.mechanics.length >= DRILL_LIMITS.mechanics} onclick={() => addRule('safe-deadline')}><span>◎</span> Safe deadline</button>
          <button type="button" class="safe-add" disabled={draft.mechanics.length >= DRILL_LIMITS.mechanics} onclick={() => addRule('safe-hold')}><span>◉</span> Safe hold</button>
        </div>
      </section>
    </div>
  </div>

  {#if !validation.valid}<div class="validation-errors" role="alert"><strong>Check these settings before saving</strong><ul>{#each validation.errors.slice(0, 6) as error}<li>{error}</li>{/each}</ul>{#if validation.errors.length > 6}<p>And {validation.errors.length - 6} more settings to check.</p>{/if}</div>{/if}
  <footer class="editor-footer"><div><strong>{dirty ? 'Your changes are a draft' : 'Ready for your next session'}</strong><p>Saved in this browser on this device. Saving applies on the next Start; Resume keeps your captured session.</p></div><div class="save-actions"><button type="button" disabled={!validation.valid} onclick={() => saveDrill(true)}>Save as new</button><button type="button" class="primary" disabled={!validation.valid || !dirty} onclick={() => saveDrill()}>Save drill</button></div></footer>
</section>

<style>
  .drill-editor{--editor-gold:#dac691;--editor-muted:#91a2b5;--editor-line:#2c3c4b;--editor-green:#94d7c5;max-width:1440px;margin:0 auto 20px;color:#e1e8ee}
  .editor-header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:14px 0 22px}.editor-eyebrow{font-size:10px;letter-spacing:.2em;color:#af9b74;margin:0 0 7px}.editor-header h2{font-family:Georgia,serif;color:#ecdec0;font-weight:400;font-size:32px;line-height:1.2;margin:0 0 8px}.editor-intro{font-size:13px;color:var(--editor-muted)}.draft-badge{flex:none;font-size:11px;letter-spacing:.02em;color:#9dbfb5;border:1px solid #344c49;padding:6px 10px;border-radius:20px;background:#1b2d2c}.draft-badge.dirty{color:#e3c898;border-color:#665438;background:#302a21}
  .library-bar{display:flex;align-items:end;flex-wrap:wrap;gap:12px;padding:14px;border:1px solid var(--editor-line);border-radius:9px;background:#17212c;margin-bottom:22px}.library-select{min-width:220px;flex:1}.library-actions,.file-actions,.save-actions{display:flex;align-items:center;flex-wrap:wrap;gap:6px}.file-actions{margin-left:auto;padding-left:12px;border-left:1px solid var(--editor-line)}.library-bar button{font-size:12px;min-height:37px;padding:7px 10px}.danger{color:#bd9b94}.editor-layout{display:grid;grid-template-columns:minmax(0,1.18fr) minmax(320px,.82fr);gap:28px;align-items:start}.world-column,.rules-column{min-width:0}.world-heading,.section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 12px}.world-heading h3,.section-heading h3{font-size:14px;font-weight:550;letter-spacing:.01em;margin:0;color:#d6c5a1}.world-heading>span,.section-heading>span{font-size:10px;color:var(--editor-muted);text-align:right}.preview-shell{border:1px solid #435a66;border-radius:9px;overflow:hidden;background:#09101a;box-shadow:0 12px 35px #0002}.preview-shell canvas{display:block;width:100%;height:auto;aspect-ratio:1000/560;touch-action:none;cursor:crosshair;outline:none}.preview-shell canvas:focus-visible{outline:2px solid var(--editor-gold);outline-offset:-3px}.placement-toolbar{display:flex;flex-wrap:wrap;gap:6px;padding:12px 0 8px}.placement-toolbar button{font-size:11px;padding:5px 9px;max-width:100%;overflow-wrap:anywhere}.chosen{background:#3a3426!important;border-color:#a28d59!important;color:#eee0ba!important}.player-dot{color:#94d9d7}.boss-dot{color:#c1a3de}.placement-hint{color:#879bad;font-size:11px;line-height:1.65;margin:0 0 11px}.placement-hint strong{color:#d7c69f;font-weight:500}.preview-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:10px;color:#96a6b7;border-top:1px solid #293a48;padding:10px 0 0}.preview-legend>span{display:flex;gap:5px;align-items:center}.preview-legend i{width:7px;height:7px;border:1px solid currentColor;border-radius:50%}.legend-player{color:#94d9d7;background:#94d9d730}.legend-boss{color:#c1a3de;background:#c1a3de30}.legend-hostile{color:#e5a56f;background:#e5a56f30}.legend-safe{color:#94d7c5;background:#94d7c530}.preview-note{font-size:11px;line-height:1.6;color:#788c9e;margin:10px 0 20px}.editor-card{background:#141f2c;border:1px solid #2c3b4e;border-radius:9px;padding:16px;margin:0 0 16px}.identity-card .field-grid{align-items:center}.field{display:flex;flex-direction:column;gap:5px;min-width:0;margin:0}.field>span{color:#a8b8c9;font-size:11px;line-height:1.4}.field input,.field select,.field textarea{box-sizing:border-box;display:block;width:100%;max-width:100%;min-width:0;background:#0e1825;color:#dce4ed;border:1px solid #34475a;border-radius:5px;padding:8px 9px;font:inherit;font-size:12px;line-height:1.3;min-height:35px}.field input:focus-visible,.field select:focus-visible,.field textarea:focus-visible,.file-picker input:focus-visible{outline:2px solid #94d9d7;outline-offset:2px}.field input:invalid{border-color:#a97455}.field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:11px 0}.field-help{font-size:10px;line-height:1.65;color:#8599aa;margin:6px 0 12px}.seed-help{font-size:10px;line-height:1.65;color:#8599aa;padding-top:13px}.spawn-label{font-size:12px;font-weight:500;color:#a6d5d1}.spawn-row{border-bottom:1px solid #2a3948;padding-bottom:6px;margin-bottom:10px}.boss-row{padding:10px;border:1px solid #2e3d4e;border-radius:6px;margin:9px 0;background:#111b28}.boss-row.active{border-color:#7d6a45}.boss-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;gap:8px}.boss-select{font-size:11px;padding:3px 0;color:#c5addc;border:0}.remove-button{color:#ba9b97;font-size:10px;padding:4px 7px;min-height:28px}.add-button{display:block;width:100%;border:1px dashed #465365;border-radius:6px;font-size:12px;background:transparent;color:#bac7d3;padding:9px;margin:10px 0 0}.add-button:hover{background:#1d2a39}.rules-intro{font-size:11px;line-height:1.7;color:#91a2b4;margin:0 0 20px}.rule-section{margin:0 0 23px}.empty-rules{font-size:12px;line-height:1.7;color:#7f92a6;padding:15px;border:1px dashed #344555;border-radius:7px;background:#121b27;margin:0 0 8px}.rule-card{border:1px solid #3f3c36;border-radius:7px;background:#18202b;margin:0 0 9px;overflow:hidden}.rule-card>summary{max-width:none;display:flex;align-items:center;gap:10px;list-style:none;padding:12px 13px;color:#dac3a6;font-size:12px;cursor:pointer}.rule-card>summary::-webkit-details-marker{display:none}.rule-card>summary:hover{background:#ffffff04}.rule-card>summary small{display:block;font-size:10px;margin-top:3px;color:#8799ab}.rule-number{font-size:10px;border:1px solid #61513e;background:#48392566;width:26px;height:28px;display:grid;place-items:center;border-radius:4px;color:#c8af87;flex:none}.expand-icon{margin-left:auto;font-size:17px;color:#8f9aab}.rule-card[open] .expand-icon{transform:rotate(45deg)}.rule-body{border-top:1px solid #34404c;padding:13px}.rule-actions{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:0 0 12px}.rule-actions>button:first-child{font-size:10px;padding:5px 8px}.mechanic-help{font-size:11px;color:#c7b195;background:#b0854320;border-left:2px solid #9b7950;padding:8px 10px;line-height:1.6;margin:0 0 12px}.safe-card{border-color:#35514a}.safe-card>summary{color:#9fd4c5}.safe-card .rule-number{color:#9ad2be;border-color:#456b60;background:#35514655}.safe-help{color:#a8cfbf;background:#5dba9020;border-color:#66ad91}.wave-card{border-color:#443b53}.wave-card>summary{color:#c9b4dd}.wave-card .rule-number{color:#c9b4dd;border-color:#645373;background:#58416444}.placement-fields{display:grid;grid-template-columns:1.8fr 1fr 1fr;gap:8px;margin:12px 0}.placement-fields .field:first-child:last-child{grid-column:1/-1}.mechanic-palette{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:12px}.mechanic-palette button{display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center;font-size:10px;line-height:1.4;padding:10px 4px;background:#241f20;color:#d1b18f;border-color:#514335}.mechanic-palette button>span{font-size:22px;line-height:1.1}.mechanic-palette button.safe-add{color:#a0cdbd;background:#162b28;border-color:#365a4e}.editor-footer{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:17px 0 0;margin-top:12px;border-top:1px solid #39444c}.editor-footer strong{font-size:12px;color:#d9c89f;font-weight:500}.editor-footer p{font-size:11px;color:#8195a8;line-height:1.65;margin:4px 0 0;max-width:600px}.save-actions{flex:none}.save-actions button{font-size:12px}.editor-notice{font-size:12px;line-height:1.6;background:#182d2c;border:1px solid #3a5a51;color:#acdac7;padding:11px 14px;border-radius:7px;margin:0 0 16px}.editor-notice.error,.validation-errors{background:#34271f;border:1px solid #805e40;color:#e3bf9c}.validation-errors{font-size:11px;line-height:1.65;padding:12px 16px;border-radius:7px;margin-top:15px;overflow-wrap:anywhere}.validation-errors strong{font-size:12px}.validation-errors ul{margin:6px 0 0;padding-left:18px}.import-panel{background:#182330;border:1px solid #495a69;border-radius:8px;padding:17px;display:grid;gap:13px;margin:-8px 0 20px}.import-panel h3{font-size:15px;color:#dfcfad;margin:0 0 5px}.import-panel p{color:#97a9bd;font-size:11px;line-height:1.6;margin:0}.file-picker{font-size:12px;color:#c7d1de;display:flex;align-items:center;gap:15px;flex-wrap:wrap}.file-picker input{max-width:100%;font-size:12px}.import-panel textarea{font-family:ui-monospace,monospace;font-size:11px;resize:vertical}.import-actions{display:flex;justify-content:flex-end;gap:7px}.import-actions button{font-size:12px}
  .point-list{border:1px solid #514460;border-radius:7px;background:#221e2a55;padding:12px;margin:12px 0}.point-list-heading,.point-row-actions,.point-order-actions{display:flex;align-items:center;justify-content:space-between;gap:6px}.point-list-heading{margin:14px 0 9px;font-size:11px;color:#c9b4dd}.point-list-heading>span{color:var(--editor-muted);font-size:10px}.point-row{border:1px solid #393744;border-radius:6px;padding:9px;margin-bottom:8px;background:#17212c}.point-row.active{border-color:#a28d59;background:#2c2a2455}.point-row-actions{margin-bottom:8px;flex-wrap:wrap}.point-row button{font-size:11px;padding:4px 7px}.point-select{color:#ddc7ef}.point-order-actions{margin-left:auto}.point-list .field-grid{margin-bottom:0}
  @media(min-width:1150px){.preview-shell{position:relative}.world-column{position:relative}.preview-shell canvas{min-height:325px}}
  @media(max-width:950px){.editor-layout{gap:18px;grid-template-columns:minmax(0,1fr) minmax(310px,.9fr)}.placement-fields{grid-template-columns:1fr 1fr}.placement-fields .field:first-child{grid-column:1/-1}.file-actions{padding-left:0;border-left:0}.world-heading>span{font-size:9px}.editor-footer{align-items:flex-start}}
  @media(max-width:760px){.editor-layout{grid-template-columns:1fr}.editor-header h2{font-size:27px}.editor-intro{font-size:11px}.editor-header{align-items:flex-start}.draft-badge{font-size:10px}.file-actions{width:100%;justify-content:flex-end;border-top:1px solid var(--editor-line);padding-top:9px}.library-select{min-width:180px}.rules-column{margin-top:6px}.mechanic-palette{grid-template-columns:repeat(5,minmax(0,1fr))}.editor-footer{flex-wrap:wrap}.save-actions{margin-left:auto}.placement-fields{grid-template-columns:1.8fr 1fr 1fr}.placement-fields .field:first-child{grid-column:auto}}
  @media(max-width:450px){.editor-header{gap:10px}.editor-header h2{font-size:24px}.draft-badge{font-size:9px;padding:5px 7px}.editor-intro{max-width:225px}.library-bar{padding:11px}.library-select{flex-basis:100%}.library-actions{width:100%}.file-actions{justify-content:flex-start}.library-bar button{font-size:11px}.editor-card{padding:13px}.mechanic-palette{grid-template-columns:repeat(3,minmax(0,1fr))}.placement-fields{grid-template-columns:1fr 1fr}.placement-fields .field:first-child{grid-column:1/-1}.world-heading>span{max-width:125px}.preview-legend{gap:9px}.save-actions{width:100%;justify-content:flex-end}}
</style>
