<script>
  import {onMount, tick, untrack} from 'svelte';
  import {DEFAULT_BINDINGS, keyLabel, captureBinding} from '../lib/keybindings.js';

  let {bindings, spells = [], paused = false, onsave = () => {}, onclose = () => {}} = $props();
  let draft = $state(untrack(() => [...bindings]));
  let capturing = $state(null);
  let feedback = $state('Choose a slot, then press its new key.');
  let dialog;
  let slotButtons = [];
  let disposed = false;
  const capturedHeld = new Set();

  onMount(() => {
    dialog.showModal();
    slotButtons[0]?.focus();
    return () => { disposed = true; if (dialog.open) dialog.close(); };
  });

  function focusSlot(index) {
    tick().then(() => { if (!disposed) slotButtons[index]?.focus(); });
  }
  function capture(index) {
    capturing = index;
    feedback = `Press a key for slot ${index + 1}. Escape cancels capture; Tab cancels and moves focus.`;
    focusSlot(index);
  }
  function cancelCapture() {
    const index = capturing;
    capturing = null;
    feedback = 'Capture canceled. Your draft is unchanged.';
    if (index !== null) focusSlot(index);
  }
  function keydown(event) {
    if (capturedHeld.has(event.code)) { event.preventDefault(); event.stopPropagation(); return; }
    if (event.code === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (event.repeat) return;
      if (capturing !== null) cancelCapture(); else onclose();
      return;
    }
    if (capturing === null) return;
    event.stopPropagation();
    if (event.code === 'Tab') {
      capturing = null;
      feedback = 'Tab is reserved for targeting. Capture canceled; your draft is unchanged.';
      return; // Preserve native keyboard navigation within the modal.
    }
    event.preventDefault();
    const result = captureBinding(event, draft, capturing);
    if (!result.ok) { feedback = result.reason; return; }
    const index = capturing;
    capturedHeld.add(event.code);
    draft = draft.map((code, slot) => slot === index ? result.code : code);
    capturing = null;
    feedback = `Slot ${index + 1} will use ${keyLabel(result.code)}. Save keys to apply.`;
    focusSlot(index);
  }
  function keyup(event) {
    if (capturedHeld.delete(event.code)) { event.preventDefault(); event.stopPropagation(); }
  }
  function interruptCapture() {
    capturedHeld.clear();
    if (capturing !== null) cancelCapture();
  }
  function cancel(event) {
    event.preventDefault();
    if (capturing !== null) cancelCapture(); else onclose();
  }
  function reset() {
    capturing = null; draft = [...DEFAULT_BINDINGS];
    feedback = 'Defaults restored in this draft: 1, 2, 3, 4, 5. Save keys to apply.';
  }
</script>

<svelte:window onblur={interruptCapture} />
<svelte:document onvisibilitychange={() => { if (document.hidden) interruptCapture(); }} />

<dialog id="keybindingsDialog" aria-labelledby="keybindingsTitle" aria-describedby="keybindingsIntro" bind:this={dialog} onkeydown={keydown} onkeyup={keyup} oncancel={cancel}>
  <div class="summary-heading">
    <div><p class="eyebrow">YOUR CONTROLS</p><h2 id="keybindingsTitle">Spell keybindings</h2></div>
    <button type="button" id="closeKeybindings" class="icon-button" aria-label="Cancel keybinding changes" onclick={onclose}>×</button>
  </div>
  <p id="keybindingsIntro">Keys follow slots, even when you reorder your loadout. All five slots can be customized.</p>
  {#if paused}<p class="help-pause-note">Your session is paused. Save or cancel leaves it paused; resume when you’re ready.</p>{/if}
  <ol class="keybinding-list" aria-label="Spell slot bindings">
    {#each draft as code, index (index)}
      <li class:capturing={capturing === index}>
        <div><span class="binding-slot">Slot {index + 1}</span><strong>{spells[index]?.name ?? 'Empty slot'}</strong></div>
        <button type="button" bind:this={slotButtons[index]} data-binding-slot={index} aria-label={`Change slot ${index + 1} key, currently ${keyLabel(code)}`} aria-pressed={capturing === index} aria-describedby="bindingFeedback" onclick={() => capture(index)}>
          {#if capturing === index}Press a key…{:else}<kbd>{keyLabel(code)}</kbd><span>Change</span>{/if}
        </button>
      </li>
    {/each}
  </ol>
  <p id="bindingFeedback" class="binding-feedback" role="status" aria-live="polite" aria-atomic="true">{feedback}</p>
  {#if capturing !== null}<button type="button" id="cancelKeyCapture" class="quiet" onclick={cancelCapture}>Cancel capture</button>{/if}
  <details class="binding-supported"><summary>Supported keys and storage</summary>
    <p>Use a single letter, number, punctuation key, arrow, Space, or numpad key. WASD, P, Tab, Enter and Escape stay reserved. Function keys, browser controls and modifier shortcuts (Shift, Ctrl, Alt, Command) can’t be assigned.</p>
    <p>Bindings use physical key positions, with US-layout labels. Caps Lock doesn’t change them. Numpad keys are separate from the number row. Some device or operating-system keys never reach a web page.</p>
    <p>Saved only in this browser on this device, with no account or cloud sync. Private browsing or blocked storage may keep changes for this visit only.</p>
  </details>
  <div class="keybinding-actions"><button type="button" id="resetKeybindings" class="quiet" onclick={reset}>Reset to 1–5</button><div>
    <button type="button" id="cancelKeybindings" class="quiet" onclick={onclose}>Cancel</button>
    <button type="button" id="saveKeybindings" class="primary" disabled={capturing !== null} onclick={() => onsave([...draft])}>Save keys</button>
  </div></div>
</dialog>
