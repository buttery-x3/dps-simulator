<script>
  import { DEFAULT_LOADOUT, SLOT_KEYS } from '../lib/catalogue.js';
  import LoadoutPicker from './LoadoutPicker.svelte';
  import AbilityDetails from './AbilityDetails.svelte';
  import {describeAbility} from '../lib/ability-details.js';

  let {
    open = false,
    paused = false,
    active = false,
    settings = { seed: 72821, loadout: DEFAULT_LOADOUT, mechanics: true, layout: 'spread' },
    abilities = [],
    warnings = [],
    keys = SLOT_KEYS,
    onkeybindings = () => {},
    onsettings = () => {},
    onclose = () => {},
    detail = null,
    metricsSection = false,
  } = $props();

  let dialog = $state();
  let metricHelp = $state();
  let settingsOpen = $state(true);
  const defaultDetail = {
    type: 'YOUR ROTATION',
    name: 'Find your rhythm',
    text: 'Keep selected maintenance DoTs active, use casts and channels while stationary, and save instant abilities for movement. Talents change how your chosen spells behave.',
  };
  let inspectedAbility = $state(null);
  const equipped = $derived(settings.loadout.abilities.map(id => abilities.find(ability => ability.id === id)).filter(Boolean));
  const inspected = $derived(equipped.find(ability => ability.id === inspectedAbility));
  const abilityDetail = $derived(inspected ? describeAbility(inspected, {key: keys[settings.loadout.abilities.indexOf(inspected.id)] ?? ''}) : detail);
  let currentDetail = $derived(defaultDetail);

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });

  $effect(() => {
    if (open && metricsSection && metricHelp) metricHelp.scrollIntoView?.({ block: 'start' });
  });

  function cancel(event) { event.preventDefault(); onclose(false); }
</script>

<dialog id="helpDialog" aria-labelledby="helpTitle" bind:this={dialog} oncancel={cancel}>
  <div class="summary-heading">
    <div><p class="eyebrow">CONTROLS · LOADOUT · SETUP</p><h2 id="helpTitle">Train at your own pace</h2></div>
    <button id="closeHelp" class="icon-button" aria-label="Close help" onclick={() => onclose(false)}>×</button>
  </div>
  <p id="helpPauseNote" class="help-pause-note" hidden={!paused}>Your session is paused while Help is open.</p>
  <div class="help-body">
    <div class="control-legend">
      <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move</span>
      <span>{#each keys as key}<kbd>{key}</kbd>{/each} Cast</span>
      <span><kbd>Tab</kbd> Target</span><span><kbd>P</kbd> Pause</span><span><kbd>Esc</kbd> Release focus</span>
    </div>
    <button type="button" id="helpKeybindings" class="quiet" onclick={onkeybindings}>Customize spell keys</button>
    <details id="settings" bind:open={settingsOpen}>
      <summary>Loadout &amp; session setup</summary>
      <LoadoutPicker tooltipsEnabled={open && settingsOpen} {abilities} loadout={settings.loadout} {keys} disabled={active} {warnings} idPrefix="help-loadout" onchange={loadout => onsettings({loadout})} />
      <div class="session-setup">
        <label class="seed-label">Practice seed<input id="seedInput" type="number" value={settings.seed} min="1" max="4294967295" step="1" disabled={active} onchange={event => onsettings({seed: Number(event.currentTarget.value) || 72821})}></label>
        <label class="seed-label">Echo layout<select id="layoutInput" value={settings.layout} disabled={active} onchange={event => onsettings({layout: event.currentTarget.value})}><option value="spread">Spread</option><option value="clustered">Clustered</option></select></label>
        <label class="check-label"><input id="mechanicsInput" type="checkbox" checked={settings.mechanics} disabled={active} onchange={event => onsettings({mechanics: event.currentTarget.checked})}>Ground mechanics</label>
        <p class="small">Setup applies to the next session. Clustered echoes make area and chain effects easier to practice. Same seed and actions reproduce the same drill. Ability choices, slot order and talents save automatically in this browser on this device. Practice seed, echo layout, ground mechanics and session results reset on reload. Nothing is saved to an account.</p>
      </div>
    </details>
    <p class="inspiration">Expand your understanding of reality. Reach into the astral and weave its threads through the veil. Desktop keyboard recommended. Touch controls are available.</p>
  </div>
  <div class="help-secondary">
    <section class="spell-detail" aria-labelledby="abilityDetailsTitle"><h3 id="abilityDetailsTitle">Ability details</h3>
      <div class="ability-detail-choices" aria-label="Inspect equipped abilities">{#each equipped as ability (ability.id)}<button type="button" class="quiet" data-inspect-ability={ability.id} aria-pressed={inspectedAbility === ability.id} onclick={() => { inspectedAbility = ability.id; }}>{ability.name}</button>{/each}</div>
      {#if abilityDetail}<AbilityDetails detail={abilityDetail} />{:else}<p class="eyebrow" id="detailType">{currentDetail.type}</p><h2 id="detailName">{currentDetail.name}</h2><p id="detailText">{currentDetail.text}</p>{/if}</section>
    <section class="help-note"><h3>The drill</h3><p>Stationary echoes join at 0:14, then every 30s. They fade after 40s. The sentinel never dies. Dodge red circles and lanes before their timers reach zero. Ground hits add 1,000 damage taken.</p></section>
  </div>
  <section id="metricHelp" class="help-note" bind:this={metricHelp}>
    <h3>Damage metrics</h3>
    <p id="metricExplanation" class="metric-explanation">Session DPS = exact total damage ÷ simulated active seconds. Rolling DPS = damage in the last 15 seconds ÷ min(15, active seconds). Paused, hidden, and unfocused time does not count. Displayed DPS is rounded; totals are exact.</p>
    <p>DoT coverage includes every selected maintenance DoT across all live targets, from each target’s arrival. Time before your first application counts too. With no maintenance DoTs selected, coverage is not applicable.</p>
  </section>
  <section class="help-note"><h3>Read your action bar</h3><p>Hover or keyboard-focus an ability for its current talent and effects. Escape dismisses the tooltip. On touch, use the Ability details buttons above to inspect equipped abilities without casting or changing your loadout. Talent previews also appear below the loadout picker. The key on each icon follows its slot. A dark clock sweep shows spell cooldown; a cyan sweep shows the global cooldown. Violet highlights mark stored spell charges. Gold highlights mean enough Astral charges for a spender. Shared Astral charges and stored spell charges are separate.</p></section>
  <div class="summary-footer"><button id="helpDone" class="quiet" onclick={() => onclose(false)}>Close help</button><button id="helpResume" class="primary" hidden={!paused} onclick={() => onclose(true)}>Close and resume</button></div>
</dialog>
