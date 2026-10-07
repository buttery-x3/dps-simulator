<script>
  let {
    open = false,
    summary = null,
    onclose = () => {},
    onrestart = () => {},
  } = $props();

  let dialog = $state();
  const names = {
    brand: 'Sorrowbrand',
    glass: 'Nightglass',
    thread: 'Gloam Thread',
    bolt: 'Wraithbolt',
    rift: 'Devouring Rift',
    bloom: 'Umbral Bloom',
  };
  const num = (value) => Math.round(value).toLocaleString();
  const duration = (seconds) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
  let rows = $derived(Object.entries(summary?.breakdown ?? {}).sort((a, b) => b[1] - a[1]));

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });

  function cancel(event) {
    event.preventDefault();
    onclose();
  }
</script>

<dialog id="summaryDialog" bind:this={dialog} oncancel={cancel}>
  <div class="summary-heading">
    <div>
      <p class="eyebrow">SESSION COMPLETE</p>
      <h2>Your time in the chamber</h2>
    </div>
    <button id="closeSummary" class="icon-button" aria-label="Close session summary" onclick={() => onclose()}>×</button>
  </div>
  <div id="summaryContent">
    {#if summary}
      <div class="summary-grid">
        <div><span>Session DPS</span><strong>{num(summary.sessionDps)}</strong></div>
        <div><span>Total damage</span><strong>{num(summary.totalDamage)}</strong></div>
        <div><span>Active time</span><strong>{duration(summary.elapsed)}</strong></div>
      </div>
      <div class="summary-detail"><span>Damage taken</span><strong>{num(summary.damageTaken)} · {summary.hitsTaken} hit{summary.hitsTaken === 1 ? '' : 's'}</strong></div>
      <div class="summary-detail"><span>Echoes defeated / faded</span><strong>{summary.kills} / {summary.escaped}</strong></div>
      <div class="summary-detail"><span>Sorrowbrand coverage</span><strong>{Math.round(summary.brandUptime * 100)}%</strong></div>
      <div class="summary-detail"><span>Movement interrupts / shards overcapped</span><strong>{summary.interrupts} / {summary.wastedShards}</strong></div>
      <div class="summary-breakdown">
        <h3>Damage by spell</h3>
        {#each rows as [id, damage] (id)}
          <div class="breakdown-row">
            <span>{names[id]}</span>
            <div class="breakdown-bar"><i style:width={`${damage / summary.totalDamage * 100}%`}></i></div>
            <span>{num(damage)}</span>
          </div>
        {:else}
          <p class="summary-formula">No damage dealt this session.</p>
        {/each}
      </div>
      <p class="summary-formula">DPS uses total damage ÷ exact active time ({summary.elapsed.toFixed(3)}s). Coverage is the share of all live-target time with Sorrowbrand active. Absorbed or overkill damage is not counted. Seed {summary.seed} · {summary.loadout === 'bloom' ? 'Umbral Bloom' : 'Devouring Rift'}.</p>
    {/if}
  </div>
  <div class="summary-footer">
    <button id="reviewBtn" class="quiet" onclick={() => onclose()}>Review arena</button>
    <button id="restartBtn" class="primary" onclick={() => onrestart()}>New session</button>
  </div>
</dialog>
