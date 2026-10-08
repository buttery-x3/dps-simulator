export function registerTrainingTools(context, actions) {
  const {sim, readSession = () => sim.snapshot(), startSession, pauseSession, resumeSession, stopSession, configure, selectTarget, castSpell, setMode = () => { throw new Error('Mode changes are unavailable.'); }} = actions;
  if (!context?.registerTool) return () => {};
  const lifecycle = new AbortController();
  const obj = (input, keys) => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) throw new Error('Invalid tool input.');
    return input;
  };
  const register = (name, description, inputSchema, execute, readOnly = false) => {
    try {
      Promise.resolve(context.registerTool({name, description, inputSchema,
        annotations: {readOnlyHint: readOnly, untrustedContentHint: false},
        execute: async input => execute(input),
      }, {signal: lifecycle.signal})).catch(() => {});
    } catch { /* Browser-tool support is optional; registration must not break play. */ }
  };
  const empty = {type: 'object', properties: {}, additionalProperties: false};
  register('read_training_session', 'Read Fight/Edit mode, browser-local drill library, unsaved editor draft, immutable active-run drill, current real-time training state, next-session setup and validation, selected ability IDs and current physical spell key codes/labels by slot, shared Astral charges, separate stored spell charges, and exact metrics. An empty setup draft has no equipped spells and cannot start. Stopped metrics retain their completed loadout; setup describes the next-session draft. Does not advance time.', empty, input => { obj(input, []); return readSession(); }, true);
  register('start_training_session', 'Start a new session using the current setup. Resets prior results. Runs only at real-time speed in a visible page.', empty, input => {
    obj(input, []); if (['running', 'paused'].includes(sim.phase)) throw new Error('A session is already active.'); return startSession();
  });
  register('pause_training_session', 'Pause the current session and its clock.', empty, input => { obj(input, []); if (sim.phase !== 'running') throw new Error('No running session.'); return pauseSession(); });
  register('resume_training_session', 'Resume the paused session at real-time speed in a visible page.', empty, input => { obj(input, []); if (sim.phase !== 'paused') throw new Error('No paused session.'); return resumeSession(); });
  register('stop_training_session', 'Stop the active session and show the preserved summary.', empty, input => { obj(input, []); return stopSession(); });
  register('configure_training_session', 'Set the ordered selection of one to five abilities and zero or one talent per ability, or select a saved drillId for the next Start. Active runs keep their captured drill. Seed, layout and mechanics now belong to the drill editor and legacy fields are rejected. Close Edit before configuring.', {
    type: 'object', properties: {
      drillId: {type: 'string'},
      loadout: {type: 'object', properties: {
        abilities: {type: 'array', items: {type: 'string'}, minItems: 1, maxItems: 5, uniqueItems: true},
        talents: {type: 'object', additionalProperties: {type: 'string', enum: ['v1', 'v2', 'v3']}},
      }, required: ['abilities'], additionalProperties: false},
    }, additionalProperties: false,
  }, input => configure(obj(input, ['loadout', 'drillId'])));
  register('set_training_mode', 'Switch between Fight and Edit. Entering Edit pauses and preserves the active run. Returning to Fight never resumes automatically; unsaved drafts require the visible discard confirmation. Saved edits apply only after Stop and a fresh Start.', {
    type: 'object', properties: {mode: {type: 'string', enum: ['fight', 'edit']}}, required: ['mode'], additionalProperties: false,
  }, input => { obj(input, ['mode']); if (!['fight', 'edit'].includes(input.mode)) throw new Error('Mode must be fight or edit.'); return setMode(input.mode); });
  register('select_training_target', 'Select a live target from the session snapshot.', {
    type: 'object', properties: {targetId: {type: 'string'}}, required: ['targetId'], additionalProperties: false,
  }, input => { obj(input, ['targetId']); if (typeof input.targetId !== 'string' || !sim.target(input.targetId)) throw new Error('Target does not exist.'); return selectTarget(input.targetId); });
  register('cast_training_spell', 'Attempt one currently selected ability by its spell ID from read_training_session. Respects the live global cooldown, activation, movement, range, stored spell charges, and shared Astral charge rules.', {
    type: 'object', properties: {spell: {type: 'string'}}, required: ['spell'], additionalProperties: false,
  }, input => {
    obj(input, ['spell']);
    if (typeof input.spell !== 'string' || !sim.spells.some(spell => spell.id === input.spell)) throw new Error('Spell is not in the selected loadout.');
    return castSpell(input.spell);
  });
  return () => lifecycle.abort();
}
