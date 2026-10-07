export function registerTrainingTools(context, actions) {
  const {sim, startSession, pauseSession, resumeSession, stopSession, configure, selectTarget, castSpell} = actions;
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
  register('read_training_session', 'Read current real-time training state, selected ability IDs and key mappings, the available catalogue, and exact metrics. Does not advance time.', empty, input => { obj(input, []); return sim.snapshot(); }, true);
  register('start_training_session', 'Start a new session using the current setup. Resets prior results. Runs only at real-time speed in a visible page.', empty, input => {
    obj(input, []); if (['running', 'paused'].includes(sim.phase)) throw new Error('A session is already active.'); return startSession();
  });
  register('pause_training_session', 'Pause the current session and its clock.', empty, input => { obj(input, []); if (sim.phase !== 'running') throw new Error('No running session.'); return pauseSession(); });
  register('resume_training_session', 'Resume the paused session at real-time speed in a visible page.', empty, input => { obj(input, []); if (sim.phase !== 'paused') throw new Error('No paused session.'); return resumeSession(); });
  register('stop_training_session', 'Stop the active session and show the preserved summary.', empty, input => { obj(input, []); return stopSession(); });
  register('configure_training_session', 'Set the ordered selection of one to five abilities, zero or one talent per selected ability, reproducible seed, enemy layout, and ground mechanics before starting. App validation applies to the complete loadout.', {
    type: 'object', properties: {
      seed: {type: 'integer', minimum: 1, maximum: 4294967295},
      loadout: {type: 'object', properties: {
        abilities: {type: 'array', items: {type: 'string'}, minItems: 1, maxItems: 5, uniqueItems: true},
        talents: {type: 'object', additionalProperties: {type: 'string', enum: ['v1', 'v2', 'v3']}},
      }, required: ['abilities'], additionalProperties: false},
      layout: {type: 'string', enum: ['spread', 'clustered']},
      mechanics: {type: 'boolean'},
    }, additionalProperties: false,
  }, input => configure(obj(input, ['seed', 'loadout', 'layout', 'mechanics'])));
  register('select_training_target', 'Select a live target from the session snapshot.', {
    type: 'object', properties: {targetId: {type: 'string'}}, required: ['targetId'], additionalProperties: false,
  }, input => { obj(input, ['targetId']); if (typeof input.targetId !== 'string' || !sim.target(input.targetId)) throw new Error('Target does not exist.'); return selectTarget(input.targetId); });
  register('cast_training_spell', 'Attempt one currently selected ability by its spell ID from read_training_session. Respects the live global cooldown, activation, movement, range, stored charges, and shared-resource rules.', {
    type: 'object', properties: {spell: {type: 'string'}}, required: ['spell'], additionalProperties: false,
  }, input => {
    obj(input, ['spell']);
    if (typeof input.spell !== 'string' || !sim.spells.some(spell => spell.id === input.spell)) throw new Error('Spell is not in the selected loadout.');
    return castSpell(input.spell);
  });
  return () => lifecycle.abort();
}
