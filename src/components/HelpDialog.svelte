<script>
  import { SPELLS } from '../lib/engine.js';
  import SpellIcon from './SpellIcon.svelte';

  let {
    open = false,
    paused = false,
    active = false,
    settings = { seed: 72821, loadout: 'rift', mechanics: true },
    onsettings = () => {},
    onclose = () => {},
    detail = null,
    proc = { charges: 0, seconds: 0 },
    metricsSection = false,
  } = $props();

  let dialog = $state();
  let metricHelp = $state();
  const defaultDetail = {
    type: 'YOUR ROTATION',
    name: 'Keep the pressure on',
    text: 'Brand each target, use Nightglass on cooldown, then fill with Gloam Thread. Spend procs while moving and void shards at three.',
  };
  let currentDetail = $derived(detail ?? defaultDetail);
  let bloom = $derived(settings.loadout === 'bloom');

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });

  $effect(() => {
    if (open && metricsSection && metricHelp) {
      metricHelp.scrollIntoView?.({ block: 'start' });
    }
  });

  function cancel(event) {
    event.preventDefault();
    onclose(false);
  }
</script>

<dialog id="helpDialog" aria-labelledby="helpTitle" bind:this={dialog} oncancel={cancel}>
  <div class="summary-heading">
    <div>
      <p class="eyebrow">CONTROLS · SPELLBOOK · SETUP</p>
      <h2 id="helpTitle">Train at your own pace</h2>
    </div>
    <button id="closeHelp" class="icon-button" aria-label="Close help" onclick={() => onclose(false)}>×</button>
  </div>
  <p id="helpPauseNote" class="help-pause-note" hidden={!paused}>Your session is paused while Help is open.</p>
  <div class="help-body">
    <div class="control-legend">
      <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move</span>
      <span><kbd>Q</kbd><kbd>E</kbd><kbd>R</kbd><kbd>4</kbd><kbd>5</kbd> Cast</span>
      <span><kbd>Tab</kbd> Target</span>
      <span><kbd>P</kbd> Pause</span>
      <span><kbd>Esc</kbd> Release focus</span>
    </div>
    <details id="settings" open>
      <summary>Spellbook &amp; session setup</summary>
      <div class="settings-body">
        <div class="loadout">
          <h2>Your fifth spell</h2>
          <p>Both cost three void shards. Nightglass generates one.</p>
          <div class="loadout-options">
            <label>
              <input type="radio" name="loadout" value="rift" checked={!bloom} disabled={active} onchange={() => onsettings({ loadout: 'rift' })}>
              <span><b>Devouring Rift</b><small>Single-target burst + 6s DoT</small></span>
            </label>
            <label>
              <input type="radio" name="loadout" value="bloom" checked={bloom} disabled={active} onchange={() => onsettings({ loadout: 'bloom' })}>
              <span><b>Umbral Bloom</b><small>1,200 to target + 900 within 220 units</small></span>
            </label>
          </div>
          <label class="seed-label">
            Practice seed
            <input id="seedInput" type="number" value={settings.seed} min="1" max="4294967295" step="1" disabled={active} onchange={(event) => onsettings({ seed: Number(event.currentTarget.value) || 72821 })}>
          </label>
          <label class="check-label">
            <input id="mechanicsInput" type="checkbox" checked={settings.mechanics} disabled={active} onchange={(event) => onsettings({ mechanics: event.currentTarget.checked })}>
            Ground mechanics
          </label>
          <p class="small">Setup changes apply to the next session. Same seed and actions reproduce the same drill. Nothing is saved to an account.</p>
        </div>
        <div class="spellbook" id="spellbook">
          {#each SPELLS as spell (spell.id)}
            {@const isBloom = spell.id === 'spend' && bloom}
            <div class="spellbook-item" data-book={spell.id} data-current={spell.id === 'spend' ? (isBloom ? 'bloom' : 'spend') : undefined}>
              <SpellIcon id={isBloom ? 'bloom' : spell.id} size={96} class="spellbook-icon" data-icon={spell.id} />
              <h3><kbd>{spell.key}</kbd> {isBloom ? 'Umbral Bloom' : spell.name} · {spell.type}</h3>
              <p>{isBloom ? '1,200 to your target and 900 to other targets within 220 units.' : spell.detail}</p>
            </div>
          {/each}
        </div>
      </div>
    </details>
    <p class="inspiration">Inspired by the rhythm of Mists-era Shadow Priest. Original names and tuning; not a historical simulation. Desktop keyboard recommended. Touch controls are available.</p>
  </div>
  <div class="help-secondary">
    <section class="proc-panel" id="procPanel" class:active={proc.charges > 0}>
      <div class="proc-symbol" aria-hidden="true">✦</div>
      <div>
        <h2 id="procTitle">{proc.charges ? 'Wraithbolt ready' : 'Wraithbolt'}</h2>
        <p id="procText">{proc.charges ? `${proc.charges} charge${proc.charges === 1 ? '' : 's'} · ${Math.ceil(proc.seconds)}s left` : 'Waiting for a proc'}</p>
      </div>
      <kbd>4</kbd>
    </section>
    <section class="spell-detail">
      <p class="eyebrow" id="detailType">{currentDetail.type}</p>
      <h2 id="detailName">{currentDetail.name}</h2>
      <p id="detailText">{currentDetail.text}</p>
    </section>
    <section class="help-note">
      <h3>The drill</h3>
      <p>Stationary echoes join at 0:14, then every 30s. They fade after 40s. The sentinel never dies. Dodge amber circles and lanes before their timers reach zero. Ground hits add 1,000 damage taken.</p>
    </section>
  </div>
  <section id="metricHelp" class="help-note" bind:this={metricHelp}>
    <h3>Damage metrics</h3>
    <p id="metricExplanation" class="metric-explanation">Session DPS = exact total damage ÷ simulated active seconds. Rolling DPS = damage in the last 15 seconds ÷ min(15, active seconds). Paused, hidden, and unfocused time does not count. Displayed DPS is rounded; totals are exact.</p>
  </section>
  <section class="help-note">
    <h3>Read your action bar</h3>
    <p>A dark clock sweep and white timer show spell cooldown. A cyan clock sweep and GCD label show the global cooldown. Violet borders mean Wraithbolt charges; gold borders mean three void shards. Those same spell icons appear above your character when ready.</p>
  </section>
  <div class="summary-footer">
    <button id="helpDone" class="quiet" onclick={() => onclose(false)}>Close help</button>
    <button id="helpResume" class="primary" hidden={!paused} onclick={() => onclose(true)}>Close and resume</button>
  </div>
</dialog>
