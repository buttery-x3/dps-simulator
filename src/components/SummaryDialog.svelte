<script>
  import { ABILITIES, SLOT_KEYS, compileAbility } from '../lib/catalogue.js';
  let {
    open = false,
    summary = null,
    canStart = true,
    onclose = () => {},
    onrestart = () => {},
  } = $props();

  let dialog = $state();
  const names = Object.fromEntries(ABILITIES.map(ability => [ability.id, ability.name]));
  const num = (value) => Math.round(value).toLocaleString();
  const duration = (seconds) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
  const seconds = (value) => `${(value ?? 0).toFixed(2)}s`;
  const percent = (value) => value == null ? 'Not applicable' : `${Math.round(value * 100)}%`;
  let selected = $derived(summary?.loadout?.abilities ?? []);
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

<dialog id="summaryDialog" aria-labelledby="summaryTitle" bind:this={dialog} oncancel={cancel}>
  <div class="summary-heading">
    <div>
      <p class="eyebrow">SESSION SUMMARY</p>
      <h2 id="summaryTitle">{summary?.drillName ?? 'Your time in the chamber'}</h2>
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
      <div class="summary-detail"><span>Projectile hits</span><strong>{summary.projectileHits ?? 0}</strong></div>
      <div class="summary-detail" data-drill-metric="deadlines"><span>Safe deadlines reached / completed</span><strong>{summary.safeDeadlineReached ?? 0} / {summary.safeDeadlineOpportunities ?? 0} · {percent(summary.safeDeadlineRatio)}</strong></div>
      <div class="summary-detail"><span>Safe deadline misses</span><strong>{summary.safeDeadlineMisses ?? 0}</strong></div>
      <div class="summary-detail" data-drill-metric="hold"><span>Hold zone coverage</span><strong>{percent(summary.safeHoldRatio)}</strong></div>
      <div class="summary-detail"><span>Inside / active hold time</span><strong>{seconds(summary.safeHoldInsideSeconds)} / {seconds(summary.safeHoldActiveSeconds)}</strong></div>
      <div class="summary-detail"><span>Outside active hold zones</span><strong>{seconds(summary.safeHoldOutsideSeconds)}</strong></div>
      <div class="summary-detail"><span>Echoes defeated / faded</span><strong>{summary.kills} / {summary.escaped}</strong></div>
      <div class="summary-detail"><span>DoT coverage</span><strong>{summary.dotCoverage === null ? 'Not applicable' : `${Math.round(summary.dotCoverage * 100)}%`}</strong></div>
      {#each summary.coverageDetails ?? [] as coverage (coverage.id)}
        <div class="summary-detail coverage-detail" data-coverage={coverage.id}><span>{coverage.name}</span><strong>{Math.round(coverage.ratio * 100)}%</strong></div>
      {/each}
      <div class="summary-detail"><span>Movement interrupts / Astral charges overcapped</span><strong>{summary.interrupts} / {summary.wastedShards}</strong></div>
      <div class="summary-breakdown">
        <h3>Damage by spell</h3>
        {#each rows as [id, damage] (id)}
          <div class="breakdown-row">
            <span>{summary.spellNames?.[id] ?? names[id] ?? id}</span>
            <div class="breakdown-bar"><i style:width={`${summary.totalDamage ? damage / summary.totalDamage * 100 : 0}%`}></i></div>
            <span>{num(damage)}</span>
          </div>
        {:else}
          <p class="summary-formula">No damage dealt this session.</p>
        {/each}
      </div>
      <div class="summary-loadout"><h3>Session loadout</h3><ol>{#each selected as id, index (id)}
        {@const spell = compileAbility(id, summary.loadout.talents?.[id])}
        <li><kbd>{summary.keyLabels?.[index] ?? SLOT_KEYS[index]}</kbd> {summary.spellNames?.[id] ?? names[id] ?? id}{#if summary.loadout.talents?.[id]}<span> · {spell.talentName}</span>{/if}</li>
      {/each}</ol></div>
      <p class="summary-formula">DPS uses total damage ÷ exact active time ({summary.elapsed.toFixed(3)}s). DoT coverage pools every selected maintenance DoT across all live-target time, including the wait before the first application. With no maintenance DoTs, coverage is not applicable. Absorbed or overkill damage is not counted.</p>
      <p class="summary-formula">Safe deadline coverage = fully inside at expiry ÷ completed deadlines; pending deadlines do not count. Hold coverage = seconds fully inside any active hold zone ÷ seconds with at least one active hold zone. Overlapping holds count once. The whole player disk must fit inside. Ready time, pauses and hold countdowns are excluded. A zero denominator is not applicable.</p>
      <p class="summary-formula">Deadline misses deal the rule’s configured damage. Every accumulated second outside active hold zones deals the highest currently active hold damage once. Projectile hits count hostile projectile collisions. Seed {summary.drill?.seed ?? summary.seed} · {summary.drillName ?? 'Training drill'}{#if summary.drillId} · {summary.drillId}{/if}. This summary preserves the drill and loadout used in this session.</p>
    {/if}
  </div>
  <div class="summary-footer">
    <button id="reviewBtn" class="quiet" onclick={() => onclose()}>Review arena</button>
    <button id="restartBtn" class="primary" disabled={!canStart} onclick={() => onrestart()}>New session</button>
  </div>
</dialog>
