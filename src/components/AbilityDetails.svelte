<script>
  let {detail, compact = false, preview = false} = $props();
</script>

<div class="ability-details" class:compact>
  <div class="ability-details-heading"><strong>{detail.name}</strong>{#if detail.key}<kbd>{detail.key}</kbd>{/if}</div>
  <p class="ability-details-talent">{detail.talentName ? `${preview ? 'Talent preview' : 'Selected talent'} · ${detail.talentName}` : 'Base ability · No talent selected'}</p>
  <p class="ability-details-facts">{detail.facts.join(' · ')}</p>
  <ul>{#each detail.effects as effect}<li>{effect}</li>{/each}</ul>
  {#if !compact && detail.talentDescription}<p class="ability-details-talent-description">{detail.talentDescription}</p>{/if}
  {#if compact}<p class="ability-details-note">Base values before temporary buffs</p>{/if}
</div>
