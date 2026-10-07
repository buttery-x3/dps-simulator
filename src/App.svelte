<script>
  import {onMount, tick} from 'svelte';
  import {RaidSim} from './lib/engine.js';
  import {ABILITIES, DEFAULT_LOADOUT, validateLoadout, compileAbility} from './lib/catalogue.js';
  import {ArenaRenderer} from './lib/renderer.js';
  import {buildHud, num, duration} from './lib/hud.js';
  import {registerTrainingTools} from './lib/browser-tools.js';
  import SpellIcon from './components/SpellIcon.svelte';
  import {describeAbility} from './lib/ability-details.js';
  import {abilityTooltip} from './lib/ability-tooltip.js';
  import LoadoutPicker from './components/LoadoutPicker.svelte';
  import HelpDialog from './components/HelpDialog.svelte';
  import SummaryDialog from './components/SummaryDialog.svelte';
  import KeybindingsDialog from './components/KeybindingsDialog.svelte';
  import {DEFAULT_BINDINGS, MOVE_KEYS, keyLabel, slotForEvent, loadBindings, saveBindings} from './lib/keybindings.js';

  export const sim = new RaidSim();
  const held = new Set();
  const timers = new Set();
  let arena, helpButton, keybindingsButton, pauseButton, combatPanel, sidebar;
  let renderer;
  let frameId;
  let lastFrame = 0;
  let disposed = false;
  let unregisterTools = () => {};
  let view = $state.raw(buildHud(sim));
  let settings = $state({seed: 72821, loadout: {abilities: [...DEFAULT_LOADOUT.abilities], talents: {...DEFAULT_LOADOUT.talents}}, mechanics: true, layout: 'spread'});
  let loadoutOpen = $state(false);
  const loadoutValidation = $derived(validateLoadout(settings.loadout));
  const catalogue = $derived(ABILITIES.map(ability => compileAbility(ability.id, settings.loadout.talents[ability.id])));
  const talentPoints = $derived(5 - Object.values(settings.loadout.talents).filter(Boolean).length);
  let helpOpen = $state(false);
  let keybindingsOpen = $state(false);
  let bindings = $state([...DEFAULT_BINDINGS]);
  const keyLabels = $derived(bindings.map(keyLabel));
  const abilityDetails = $derived(Object.fromEntries(catalogue.map(spell => [spell.id, describeAbility(spell, {key: keyLabels[settings.loadout.abilities.indexOf(spell.id)] ?? ''})])));
  let keybindingNotice = $state('');
  let summaryOpen = $state(false);
  let summary = $state.raw(null);
  let metricsSection = $state(false);
  let selectedSpell = $state(null);
  let used = $state({});
  let arenaFocused = $state(false);
  const active = $derived(['running', 'paused'].includes(view.phase));
  const stateLabel = $derived({ready: 'READY TO TRAIN', running: 'SESSION ACTIVE', paused: 'SESSION PAUSED', stopped: 'SESSION COMPLETE'}[view.phase]);
  const detail = $derived(settings.loadout.abilities.includes(selectedSpell) ? abilityDetails[selectedSpell] : null);

  export function renderHud() { view = buildHud(sim); }
  function later(callback, delay = 0) {
    const id = setTimeout(() => { timers.delete(id); if (!disposed) callback(); }, delay);
    timers.add(id);
  }
  function focusArena() {
    arena?.focus({preventScroll: true});
    arenaFocused = document.activeElement === arena;
  }
  function focusAfterUpdate() {
    tick().then(() => { if (!disposed && !helpOpen && !summaryOpen && !keybindingsOpen) focusArena(); });
  }
  function clearMovement() { held.clear(); sim.setMovement(0, 0); }
  function updateMovement() {
    sim.setMovement((held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0), (held.has('KeyS') ? 1 : 0) - (held.has('KeyW') ? 1 : 0));
    renderHud();
  }
  function visibleAndFocused() { return !document.hidden && (!document.hasFocus || document.hasFocus()); }
  function readSettings() { return {seed: Number(settings.seed) || 72821, loadout: {abilities: [...settings.loadout.abilities], talents: {...settings.loadout.talents}}, mechanics: settings.mechanics, layout: settings.layout}; }

  export function startSession() {
    if (keybindingsOpen) return {ok: false, reason: 'Close keybindings before starting a session'};
    if (['running', 'paused'].includes(sim.phase)) return {ok: false, reason: 'Stop the active session first'};
    if (!visibleAndFocused()) return {ok: false, reason: 'Bring the game into view and focus it first'};
    if (!loadoutValidation.valid) return {ok: false, reason: loadoutValidation.errors.join(' ')};
    const current = readSettings();
    sim.seed = current.seed >>> 0 || 1;
    sim.configureLoadout(current.loadout);
    sim.layout = current.layout;
    sim.mechanics = current.mechanics;
    clearMovement();
    sim.start();
    if (renderer) { renderer.floats = []; renderer.lastEvent = 0; }
    lastFrame = performance.now();
    summaryOpen = false;
    helpOpen = false;
    loadoutOpen = false;
    summary = null;
    used = {};
    renderHud();
    focusArena();
    focusAfterUpdate();
    return sim.snapshot();
  }
  export function pauseSession(reason = 'Take a breath. The clock is paused.') {
    clearMovement(); sim.pause(reason); renderHud(); return sim.snapshot();
  }
  export function resumeSession() {
    if (keybindingsOpen) return {ok: false, reason: 'Save or cancel keybindings before resuming'};
    if (!visibleAndFocused()) return {ok: false, reason: 'Bring the game into view and focus it first'};
    helpOpen = false;
    clearMovement(); sim.resume(); lastFrame = performance.now(); renderHud();
    focusArena(); focusAfterUpdate(); return sim.snapshot();
  }
  export function stopSession() {
    clearMovement();
    if (!sim.stop()) return {ok: false, reason: 'No active session'};
    helpOpen = false; keybindingsOpen = false; renderHud(); showSummary(); return sim.snapshot();
  }
  export function castSpell(id) {
    if (helpOpen || summaryOpen || keybindingsOpen) return {ok: false, reason: 'Close the dialog before casting'};
    const result = sim.use(id);
    if (result.ok) { used = {...used, [id]: true}; later(() => { used = {...used, [id]: false}; }, 130); }
    renderHud(); return result;
  }
  export function selectTarget(id) {
    if (helpOpen || summaryOpen || keybindingsOpen) return {ok: false, reason: 'Close the dialog before selecting a target'};
    const ok = sim.select(id); renderHud(); return {ok, selectedId: sim.selectedId};
  }
  function showSummary() { if (sim.summary) { summary = sim.summary; summaryOpen = true; } }
  export function openHelp(section) {
    if (keybindingsOpen) return;
    if (sim.phase === 'running') pauseSession('Help is open. Resume when you’re ready.');
    clearMovement(); metricsSection = section === 'metrics'; helpOpen = true; renderHud();
  }
  export function closeHelp(resume = false) {
    helpOpen = false;
    if (resume && sim.phase === 'paused') resumeSession();
    else tick().then(() => { if (!disposed) helpButton?.focus({preventScroll: true}); });
  }
  function openKeybindings() {
    if (sim.phase === 'running') pauseSession('Keybindings are open. Resume when you’re ready.');
    clearMovement(); helpOpen = false; keybindingsOpen = true;
  }
  function closeKeybindings() {
    keybindingsOpen = false; clearMovement();
    tick().then(() => { if (!disposed) keybindingsButton?.focus({preventScroll: true}); });
  }
  function applyKeybindings(next) {
    sim.configureKeybindings(next);
    bindings = [...next];
    const result = saveBindings(next);
    keybindingNotice = result.ok ? 'Spell keys saved in this browser on this device.' : 'Spell keys applied for this visit only. Browser storage is unavailable.';
    renderHud(); closeKeybindings();
  }
  export function configure(next) {
    if (keybindingsOpen) throw new Error('Close keybindings before changing setup.');
    if (['running', 'paused'].includes(sim.phase)) throw new Error('Stop the active session before changing setup.');
    if (next.seed !== undefined && (!Number.isInteger(next.seed) || next.seed < 1 || next.seed > 4294967295)) throw new Error('Seed must be an integer from 1 to 4294967295.');
    if (next.loadout !== undefined) {
      const validation = validateLoadout(next.loadout);
      if (!validation.valid) throw new Error(validation.errors.join(' '));
    }
    if (next.layout !== undefined && !['spread', 'clustered'].includes(next.layout)) throw new Error('Target layout must be spread or clustered.');
    if (next.mechanics !== undefined && typeof next.mechanics !== 'boolean') throw new Error('Mechanics must be a boolean.');
    updateSettings(next);
    return readSettings();
  }
  function updateSettings(next) {
    if (['running', 'paused'].includes(sim.phase)) return;
    if (next.loadout !== undefined) next = {...next, loadout: {abilities: [...next.loadout.abilities], talents: Object.fromEntries(Object.entries(next.loadout.talents ?? {}).filter(([, talent]) => talent && talent !== 'base'))}};
    settings = {...settings, ...next};
    if (next.seed !== undefined) sim.seed = next.seed;
    if (next.loadout !== undefined && validateLoadout(next.loadout).valid) sim.configureLoadout(next.loadout);
    if (next.layout !== undefined) sim.layout = next.layout;
    if (next.mechanics !== undefined) sim.mechanics = next.mechanics;
    renderHud();
  }
  function cycleTarget() { if (helpOpen || summaryOpen || keybindingsOpen) return; sim.cycleTarget(); renderHud(); }
  function pointerTarget(event) {
    if (helpOpen || summaryOpen || keybindingsOpen) return;
    focusArena();
    if (!renderer) return;
    const {x, y} = renderer.pointFromClient(event.clientX, event.clientY);
    const target = [...sim.targets].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    if (target && Math.hypot(target.x - x, target.y - y) < Math.max(38, target.r + 15)) selectTarget(target.id);
  }
  function keyDown(event) {
    if (helpOpen || summaryOpen || keybindingsOpen || event.target !== arena || document.activeElement !== arena || event.isComposing || event.keyCode === 229 || event.key === 'Process' || event.key === 'Dead' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (MOVE_KEYS.includes(event.code)) { event.preventDefault(); if (sim.phase === 'running' && !event.repeat) { held.add(event.code); updateMovement(); } return; }
    if (event.code === 'Escape') { event.preventDefault(); pauseSession('Keyboard released. Resume when you’re ready.'); pauseButton?.focus(); return; }
    if (event.code === 'Tab') { event.preventDefault(); if (!event.repeat) cycleTarget(); return; }
    if (event.code === 'KeyP') {
      event.preventDefault();
      if (!event.repeat) { if (sim.phase === 'paused') resumeSession(); else if (sim.phase === 'running') pauseSession(); }
      return;
    }
    if (event.code === 'Enter' && ['ready', 'stopped'].includes(sim.phase)) { event.preventDefault(); if (!event.repeat) startSession(); return; }
    // Assigned arrows/Space must not scroll even on a held-key repeat or an empty slot.
    if (bindings.includes(event.code)) event.preventDefault();
    const id = sim.spells[slotForEvent(event, bindings)]?.id;
    if (id) { event.preventDefault(); if (!event.repeat) castSpell(id); }
  }
  function keyUp(event) { if (MOVE_KEYS.includes(event.code)) { event.preventDefault(); held.delete(event.code); updateMovement(); } }
  function arenaBlur() {
    arenaFocused = false; clearMovement(); renderHud();
    later(() => {
      if (sim.phase === 'running' && !combatPanel?.contains(document.activeElement) && !sidebar?.contains(document.activeElement)) pauseSession('Controls unfocused. Resume when you’re ready.');
    });
  }
  function windowBlur() { if (sim.phase === 'running') pauseSession('Window unfocused. Your session is paused.'); else { clearMovement(); renderHud(); } }
  function visibilityChange() {
    if (document.hidden && sim.phase === 'running') pauseSession('Tab hidden. Your session is paused.');
    clearMovement(); renderHud();
  }
  function touchMove(event, x, y) {
    if (helpOpen || summaryOpen || keybindingsOpen || sim.phase !== 'running') return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    clearMovement(); sim.setMovement(x, y); renderHud();
  }
  function touchStop() { sim.setMovement(0, 0); renderHud(); }

  onMount(() => {
    disposed = false;
    const stored = loadBindings();
    bindings = [...stored.bindings]; sim.configureKeybindings(bindings); renderHud();
    if (stored.status === 'corrupt') keybindingNotice = 'Saved spell keys were invalid. Using defaults: 1, 2, 3, 4, 5.';
    if (stored.status === 'unavailable') keybindingNotice = 'Browser storage is unavailable. Keybindings will last for this visit only.';
    renderer = new ArenaRenderer(arena);
    lastFrame = performance.now();
    unregisterTools = registerTrainingTools(document.modelContext, {sim, startSession, pauseSession, resumeSession, stopSession, configure, selectTarget, castSpell});
    function frame(now) {
      const delta = (now - lastFrame) / 1000;
      lastFrame = now;
      if (sim.phase === 'running') {
        if (delta > .25) pauseSession('The browser stalled. Paused to keep the clock fair.');
        else sim.advance(delta);
      }
      renderer.draw(sim);
      renderHud();
      frameId = requestAnimationFrame(frame);
    }
    frameId = requestAnimationFrame(frame);
    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      timers.forEach(clearTimeout); timers.clear();
      unregisterTools(); clearMovement(); sim.pause();
    };
  });
</script>

<svelte:window onblur={windowBlur} onpagehide={() => unregisterTools()} />
<svelte:document onvisibilitychange={visibilityChange} />

<main class="app">
  <header class="masthead">
    <div class="identity"><span class="brand-mark" aria-hidden="true">◈</span><div><h1>Veilweaver</h1><p>RANGED RAID LAB</p></div></div>
    <div class="session-controls">
      <button bind:this={helpButton} id="helpBtn" class="help-button" aria-label="Open help and session setup" onclick={() => openHelp()}>? <span>Help</span></button>
      <button bind:this={keybindingsButton} id="keybindingsBtn" class="quiet" onclick={openKeybindings}>Keybindings</button>
      <span id="stateLabel" class="state-label" class:active={view.phase === 'running'}>{stateLabel}</span>
      <button bind:this={pauseButton} id="pauseBtn" class="quiet" hidden={!active} onclick={() => view.phase === 'paused' ? resumeSession() : pauseSession()}>{view.phase === 'paused' ? 'Resume' : 'Pause'}</button>
      <button id="stopBtn" class="quiet" disabled={!active} onclick={stopSession}>Stop</button>
      <button id="startBtn" class="primary" hidden={active} disabled={view.phase !== 'stopped' && !loadoutValidation.valid} onclick={() => view.phase === 'stopped' ? showSummary() : startSession()}>{view.phase === 'stopped' ? 'Session summary' : 'Start session'}</button>
    </div>
  </header>
  {#if keybindingNotice}<p id="keybindingNotice" class="keybinding-notice" role="status">{keybindingNotice}</p>{/if}
  <section class="metrics" aria-label="Session metrics">
    <div class="metric leading"><span>Session DPS</span><strong id="sessionDps">{num(view.metrics.sessionDps)}</strong></div>
    <div class="metric"><span>Last 15s DPS <button class="info" type="button" aria-label="Explain damage metrics" id="metricInfo" onclick={() => openHelp('metrics')}>?</button></span><strong id="rollingDps">{num(view.metrics.rollingDps)}</strong></div>
    <div class="metric"><span>Total damage</span><strong id="totalDamage">{num(view.metrics.totalDamage)}</strong></div>
    <div class="metric"><span>Active time</span><strong id="elapsed">{duration(view.metrics.elapsed)}</strong></div>
    <div class="metric damage"><span>Damage taken</span><strong id="damageTaken">{num(view.metrics.damageTaken)}</strong></div>
  </section>

  <details class="preplay-setup" hidden={active} bind:open={loadoutOpen}>
    <summary><span class="setup-heading"><span class="setup-title">Your loadout</span><span class="setup-action">Customize</span></span><span class="setup-count">{settings.loadout.abilities.length}/5 abilities · {talentPoints} talent point{talentPoints === 1 ? '' : 's'} available</span></summary>
    {#if loadoutOpen}<LoadoutPicker tooltipsEnabled={!helpOpen && !summaryOpen && !keybindingsOpen} abilities={catalogue} loadout={settings.loadout} keys={keyLabels} warnings={loadoutValidation.warnings} idPrefix="preplay-loadout" onchange={loadout => updateSettings({loadout})} />{/if}
  </details>
  <div class="workspace">
    <section bind:this={combatPanel} class="combat-panel" aria-label="Combat arena">
      <div id="arenaWrap" class="arena-wrap">
        <canvas bind:this={arena} id="arena" width="1000" height="560" tabindex="0" aria-label={`Raid training arena. WASD to move, Tab to switch target, ${keyLabels.join(", ")} to cast by slot. Escape releases keyboard focus.`} onpointerdown={pointerTarget} onkeydown={keyDown} onkeyup={keyUp} onblur={arenaBlur} onfocus={() => { arenaFocused = true; }}></canvas>
        <div id="overlay" class="arena-overlay" hidden={view.phase === 'running'}><div class="overlay-card">
          <p class="eyebrow" id="overlayEyebrow">{view.phase === 'paused' ? 'CLOCK STOPPED' : view.phase === 'stopped' ? 'SESSION COMPLETE' : 'THE CHAMBER IS YOURS'}</p>
          <h2 id="overlayTitle">{view.phase === 'paused' ? 'Take your time.' : view.phase === 'stopped' ? `${num(view.metrics.sessionDps)} DPS` : "Stand still. Until you can't."}</h2>
          <p id="overlayBody">{#if view.phase === 'paused'}{view.pauseReason || 'Your session is paused.'}{:else if view.phase === 'stopped'}{num(view.metrics.totalDamage)} damage across {duration(view.metrics.elapsed)} of active time.{:else}Pick your rhythm. Keep your DoTs rolling.<br />Cast in the gaps. Dodge red ground marks.{/if}</p>
          <button id="overlayAction" class="primary" disabled={!active && view.phase !== 'stopped' && !loadoutValidation.valid} onclick={() => view.phase === 'paused' ? resumeSession() : view.phase === 'stopped' ? showSummary() : startSession()}>{view.phase === 'paused' ? 'Resume session' : view.phase === 'stopped' ? 'View session summary' : 'Start session'}</button>
          <p class="overlay-foot" id="overlayFoot">{view.phase === 'paused' ? 'Your target, cooldowns, and damage are preserved.' : view.phase === 'stopped' ? 'The result stays here until you start a new session.' : "An endless drill. Stop whenever you're ready."}</p>
        </div></div>
        <div class="arena-keyhint" id="focusHint" hidden={arenaFocused || view.phase !== 'running'}>Click the arena to take control</div>
      </div>
      <div class="cast-strip" class:channel={view.cast.channel}>
        <div class="cast-label"><span id="castName">{view.cast.name}</span><span id="castTime">{view.cast.time}</span></div>
        <div class="cast-track"><div id="castFill" style:transform={`scaleX(${view.cast.progress})`}></div><i class="channel-mark one"></i><i class="channel-mark two"></i><i class="channel-mark three"></i></div>
      </div>
      <div class="ability-deck" id="abilityDeck" aria-label="Spells">
        {#each (active || loadoutValidation.valid ? view.abilities : []) as spell (spell.id)}
          <button type="button" class="ability" class:is-locked={spell.state.locked} class:is-proc={spell.state.ready === 'charges'} class:is-ready={spell.state.ready === 'resource'} class:is-queued={spell.queued} class:is-used={used[spell.id]} style:--spell-color={spell.color} data-spell={spell.id} use:abilityTooltip={{detail: abilityDetails[spell.id], disabled: helpOpen || summaryOpen || keybindingsOpen, revision: view.phase}} aria-label={`${spell.key}. ${spell.name}. ${spell.label}`} onpointerdown={event => event.preventDefault()} onclick={() => { selectedSpell = spell.id; castSpell(spell.id); focusArena(); }} onpointerenter={() => { selectedSpell = spell.id; }} onfocus={() => { selectedSpell = spell.id; }}>
            <SpellIcon id={spell.icon} class="ability-icon" state={{...spell.state, key: spell.key}} />
            <span class="ability-name">{spell.name}</span><span class="ability-state">{spell.label}</span>
          </button>
        {/each}
      </div>
      <div class="combat-status"><div class="active-buffs" aria-label="Active spell effects">{#each view.buffs ?? [] as buff (buff.id)}<span>{buff.name} · {Math.ceil(buff.seconds)}s</span>{/each}</div></div>
      <div class="touch-controls" aria-label="Touch movement controls">
        <div class="dpad">{#each [{x: 0, y: -1, label: 'up', glyph: '↑'}, {x: -1, y: 0, label: 'left', glyph: '←'}, {x: 0, y: 1, label: 'down', glyph: '↓'}, {x: 1, y: 0, label: 'right', glyph: '→'}] as direction}<button data-move={`${direction.x},${direction.y}`} aria-label={`Move ${direction.label}`} onpointerdown={event => touchMove(event, direction.x, direction.y)} onpointerup={touchStop} onpointercancel={touchStop} onlostpointercapture={touchStop}>{direction.glyph}</button>{/each}</div>
        <button id="touchTarget" onclick={() => { cycleTarget(); focusArena(); }}>Next target</button>
      </div>
    </section>
    <aside bind:this={sidebar} class="sidebar">
      <section class="targets-panel"><div class="section-label"><h2>Targets</h2><span id="targetCount">{view.targets.length} active</span></div><div id="targetList">
        {#each view.targets as target (target.id)}
          <button type="button" class="target-card" class:selected={target.selected} data-target={target.id} aria-pressed={target.selected} title={target.title} onpointerdown={event => event.preventDefault()} onclick={() => { selectTarget(target.id); focusArena(); }}>
            <span class="target-top"><span class="target-name">{target.name}</span><span class="target-kind">{target.dummy ? 'DUMMY' : 'PRIORITY'}</span></span>
            <span class="target-bottom"><span class={`target-dot ${target.dotClass}`}>{target.dot}</span><span class="target-health">{target.hp}</span></span>
            <span class="target-hp" hidden={target.dummy}><i style:width={`${target.healthPercent}%`}></i></span>
          </button>
        {/each}
      </div></section>
      <section class="compact-counters"><div><span>Echoes</span><strong id="killCount">{view.metrics.kills}</strong></div><div><span>DoT coverage</span><strong id="brandUptime">{view.metrics.dotCoverage === null ? '—' : `${Math.round(view.metrics.dotCoverage * 100)}%`}</strong></div></section>
    </aside>
  </div>

  <HelpDialog keys={keyLabels} onkeybindings={openKeybindings} open={helpOpen} paused={view.phase === 'paused'} {active} {settings} onsettings={updateSettings} onclose={closeHelp} {detail} abilities={catalogue} warnings={loadoutValidation.warnings} {metricsSection} />
  {#if keybindingsOpen}<KeybindingsDialog {bindings} spells={view.abilities} paused={view.phase === 'paused'} onsave={applyKeybindings} onclose={closeKeybindings} />{/if}
  <SummaryDialog open={summaryOpen} {summary} canStart={loadoutValidation.valid} onclose={() => { summaryOpen = false; }} onrestart={startSession} />
</main>
