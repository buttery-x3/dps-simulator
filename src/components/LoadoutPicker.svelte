<script>
  import SpellIcon from './SpellIcon.svelte';

  let {
    abilities = [],
    loadout = { abilities: [], talents: {} },
    keys = ['Q', 'E', 'R', '4', '5'],
    disabled = false,
    warnings = [],
    idPrefix = 'loadout',
    onchange = () => {},
  } = $props();

  let inspected = $state(null);
  const selected = $derived(loadout.abilities ?? []);
  const talents = $derived(loadout.talents ?? {});
  const spent = $derived(Object.values(talents).filter(Boolean).length);
  const currentDetail = $derived.by(() => {
    if (!inspected) return null;
    const ability = abilities.find(item => item.id === inspected.abilityId);
    if (!ability) return null;
    const talent = ability.talents?.find(item => item.id === inspected.talentId);
    return talent ? { name: talent.name, type: `${ability.name} · TALENT`, detail: talent.detail ?? talent.description }
      : { name: ability.name, type: ability.type, detail: ability.detail ?? ability.description };
  });

  function inspect(abilityId, talentId = null) { inspected = { abilityId, talentId }; }
  function toggleAbility(id) {
    if (disabled) return;
    const index = selected.indexOf(id);
    if (index < 0 && selected.length >= keys.length) return;
    const next = index < 0 ? [...selected, id] : selected.filter(ability => ability !== id);
    const nextTalents = { ...talents };
    if (index >= 0) delete nextTalents[id];
    onchange({ abilities: next, talents: nextTalents });
  }
  function toggleTalent(abilityId, talentId) {
    if (disabled || !selected.includes(abilityId)) return;
    const next = { ...talents };
    if (next[abilityId] === talentId) delete next[abilityId];
    else {
      if (!next[abilityId] && spent >= 5) return;
      next[abilityId] = talentId;
    }
    onchange({ abilities: [...selected], talents: next });
  }
  function reorder(index, offset) {
    const target = index + offset;
    if (disabled || target < 0 || target >= selected.length) return;
    const next = [...selected];
    [next[index], next[target]] = [next[target], next[index]];
    onchange({ abilities: next, talents: { ...talents } });
  }
</script>

<section class="loadout-picker" aria-label="Choose abilities and talents">
  <div class="loadout-heading">
    <div><h3>Make it your rotation</h3><p>Choose up to five abilities. Add one talent per ability, or leave points unspent.</p></div>
    <div class="loadout-budget" aria-live="polite"><strong>{selected.length}/5 abilities</strong><span>{5 - spent} talent point{5 - spent === 1 ? '' : 's'} available</span></div>
  </div>
  {#if disabled}<p class="loadout-lock">Stop the session to change your loadout.</p>{/if}
  <ol class="loadout-slots" aria-label="Action bar order">
    {#each keys as key, index (key)}
      {@const ability = abilities.find(item => item.id === selected[index])}
      <li class:empty={!ability} data-slot={key}>
        <div class="loadout-slot-title"><kbd>{key}</kbd><span>{ability?.name ?? 'Empty slot'}</span></div>
        {#if ability}
          <div class="slot-order">
            <button type="button" disabled={disabled || index === 0} aria-label={`Move ${ability.name} earlier`} onclick={() => reorder(index, -1)}>←</button>
            <button type="button" disabled={disabled || index === selected.length - 1} aria-label={`Move ${ability.name} later`} onclick={() => reorder(index, 1)}>→</button>
          </div>
        {/if}
      </li>
    {/each}
  </ol>
  <div class="loadout-catalogue" aria-label="Ability catalogue">
    {#each abilities as ability (ability.id)}
      {@const index = selected.indexOf(ability.id)}
      {@const picked = index >= 0}
      {@const atLimit = !picked && selected.length >= keys.length}
      <div class="ability-node" data-ability={ability.id} class:selected={picked} style:--node-color={ability.color}>
        <button type="button" class="ability-orb" class:selected={picked} aria-disabled={disabled || atLimit} aria-pressed={picked} aria-label={`${ability.name}${picked ? `, assigned to ${keys[index]}` : atLimit ? ', five abilities selected; remove one first' : ', add ability'}`} aria-describedby={`${idPrefix}-detail`} data-ability-option={ability.id} onfocus={() => inspect(ability.id)} onpointerenter={() => inspect(ability.id)} onclick={() => { inspect(ability.id); toggleAbility(ability.id); }}>
          <SpellIcon id={ability.icon ?? ability.id} size={144} class="loadout-orb-icon" state={{ key: picked ? keys[index] : '' }} />
          {#if picked}<span class="orb-selected" aria-hidden="true">✓</span>{/if}
        </button>
        <h4>{ability.name}</h4>
        <span class="orb-assignment">{picked ? `${keys[index]} · Selected` : 'Available'}</span>
        <div class="talent-branches" aria-label={`${ability.name} talents`}>
          {#each ability.talents ?? [] as talent, talentIndex (talent.id)}
            {@const chosen = talents[ability.id] === talent.id}
            <button type="button" class="talent-orb" class:selected={chosen} aria-disabled={disabled || !picked} aria-pressed={chosen} aria-label={`${talent.name}, ${ability.name} talent${!picked ? ', select this ability first' : ''}`} aria-describedby={`${idPrefix}-detail`} title={talent.name} data-talent-option={talent.id} onfocus={() => inspect(ability.id, talent.id)} onpointerenter={() => inspect(ability.id, talent.id)} onclick={() => { inspect(ability.id, talent.id); toggleTalent(ability.id, talent.id); }}><span aria-hidden="true">{talent.glyph ?? ['◆', '✦', '✺'][talentIndex]}</span>{#if chosen}<span class="talent-check" aria-hidden="true">✓</span>{/if}</button>
          {/each}
        </div>
      </div>
    {/each}
  </div>
  <div class="loadout-inspector" id={`${idPrefix}-detail`} aria-live="polite" aria-atomic="true">
    {#if currentDetail}<p class="eyebrow">{currentDetail.type}</p><h4>{currentDetail.name}</h4><p>{currentDetail.detail}</p>
    {:else}<h4>Explore the orbs</h4><p>Hover or focus an ability or talent for details. Select a glowing talent again to remove it. Reorder slots with the arrow buttons.</p>{/if}
  </div>
  {#each warnings as warning (warning)}<p class="loadout-warning" role="status">{warning}</p>{/each}
  {#if selected.length === 0}<p class="loadout-warning" role="status">Choose at least one ability to start a session.</p>{/if}
  <div class="loadout-footer"><span>Void resource is shared by spells. Stored spell charges are separate.</span><button type="button" class="quiet" disabled={disabled || spent === 0} onclick={() => onchange({ abilities: [...selected], talents: {} })}>Clear talents</button></div>
</section>
