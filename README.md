# VEILWEAVER

A Svelte browser arena for practicing ranged damage while dodging. Choose a rotation, keep damage-over-time effects rolling, commit to casts and channels, and move out of floor telegraphs. A Veilweaver expands their mind to understand reality, then weaves the veil’s astral threads into the world to reshape it and deal damage.

## Quick start

Use **Node.js 22.12 or newer** and npm:

```sh
npm ci
npm run dev
```

Open the local address printed by Vite (usually <http://127.0.0.1:5173>). The default server binds to this computer. `npm start` is an alias. There is no backend, account or analytics. Only spell keybindings are saved locally in the browser.

## Choose a loadout

Start immediately with five base abilities, or open **Customize loadout** before starting. The same controls are in Help.

- Eight large ability orbs, each with three connected talent orbs.
- Select one to five abilities, with five selected by default.
- Five available talent points. Each selected ability can have zero or one talent; no stacking and no requirement to spend every point.
- The five ordered slots default to **1 / 2 / 3 / 4 / 5**. Use slot arrows to rearrange abilities; customized keys stay with their slots.
- Focus or hover an orb for its description. Click a selected talent again to remove it. Native buttons support keyboard selection.
- A warning explains a spender without a generator. The loadout remains legal for experimentation.
- Choose clustered or spread stationary echoes to compare area attacks and chain bounces.
- Setup is locked during an active or paused run. Stop first; the completed summary stays frozen until the next session.

The default selects Veil Bolt, Lingering Glimmer, Gloam Thread, Astral Flare and Area Pulse, with all five talent points unspent. Destructive Rift, Chain Strike and Focused Energy are available in the catalogue. Rift is intentionally the only Astral charge spender; generation comes from talents. Shared **Astral charges** are capped at three and start at zero. An ability’s **stored spell charges** are a separate pool of uses that recharge over time; they never pay an Astral charge cost.

The 8 abilities and 24 talents are provisional prototype tuning, not a balanced class or historical simulation. See [the spell-system contract and tuning](docs/SPELL_SYSTEM.md).

## Play

- **WASD:** move.
- **Tab or click:** select a target.
- **1 / 2 / 3 / 4 / 5:** use the ability assigned to that slot by default. Open **Keybindings** to customize all five slots.
- **P:** pause/resume. **Escape:** pause and release arena keyboard focus.
- **Help:** controls, loadout, setup, exact metric definitions. Opening Help pauses; closing leaves the run paused unless you choose **Close and resume**.
- **Stop:** preserve a summary. Start a new session when ready.

Instant spells work while moving. Ordinary casts and channels require stillness; Drifting Flare is a moving cast. Moving, losing a target, or clipping a channel stops future ticks. Gloam Storm commits its cooldown at channel start even when interrupted. Full Conduit grants an Astral charge only after a complete Gloam Thread channel, including a lethal final tick.

The sentinel never dies. Two stationary echoes arrive at 14 seconds and every 30 seconds afterward, up to four live echoes. Each fades after 40 seconds. Circles and lanes telegraph ground impacts; a hit adds 1,000 damage taken without ending the session. There is no victory condition or enemy AI. Touch movement and targeting are included; desktop keyboard play remains primary.

## Ability tooltips and details

Hover or keyboard-focus an action-bar ability, a loadout ability orb, or a talent orb to read its details. Action-bar and ability-orb details describe the effective selected talent; a talent orb previews its own variant. Current physical-key labels follow the slot’s saved binding.

- Details explain activation and movement, timing, targeting, damage and effects, Astral charge costs/gains, and separate stored spell charges when applicable.
- Escape dismisses an open tooltip. Moving away or moving keyboard focus away also dismisses it. Scrolling or resizing dismisses it; placement is clamped to the viewport while open.
- For touch, open **Help → Ability details** and choose an equipped ability to read the same information without hovering or triggering a cast.
- The generic `src/lib/ability-details.js` model reads the compiled ability’s numbers and mechanics, including the selected talent. It does not maintain a duplicated per-spell mechanics table. Tooltips add no saved preferences or storage keys.

## Customize spell keybindings

Open **Keybindings** in the header or **Customize spell keys** in Help. Select a slot, then press its new key. Conflicts are explained without replacing another slot. **Save keys** applies the draft; **Cancel** or the close button discards it. **Reset to 1–5** only resets the draft until you save.

- Escape cancels an active capture. Press Escape again to close without saving. Tab cancels capture and continues native dialog navigation. A visible **Cancel capture** button is also available.
- Each slot has exactly one unique physical `KeyboardEvent.code`. Keys follow slots when abilities are reordered, including currently empty slots. Action-bar icons, above-player readiness cues, loadout orbs, Help, arena instructions and WebMCP readback use the same mapping.
- Supported keys: letters other than WASD/P; top-row digits 0–9; the US punctuation positions backquote, minus, equal, brackets, backslash, semicolon, quote, comma, period and slash; arrow keys; Space; numpad digits and add/subtract/multiply/divide/decimal/comma/equal. Numpad bindings are separate from top-row numbers. Num Lock does not change a physical numpad binding when the browser supplies its code.
- WASD movement, Tab targeting, P pause, Escape focus release and Enter start are reserved. Backspace, function keys, modifier keys and browser-control keys are not assignable. Ctrl/Alt/Command/Shift combinations, auto-repeat and text-composition events never cast. Labels use US physical-key names; another keyboard layout or Caps Lock does not change the binding. Some OS/device shortcuts never reach a browser and are not supported.
- Opening the editor pauses a running session and clears held movement. Save and Cancel leave it paused. Resume explicitly when ready; editing does not add elapsed time or damage. Keyboard combat requires arena focus and never runs while a dialog is open or while typing in a form.
- Preferences are stored under `veilweaver.keybindings.v1` in this site's localStorage, only in this browser on this device. They do not sync to an account. Invalid or unsupported saved data safely restores defaults with a notice; unavailable storage permits changes for this visit and reports the limitation. Results and loadout setup are still cleared on page reload.
- A completed summary preserves the keys present when the run stopped, even if preferences are changed afterward. Mid-run edits only change keys, never combat tuning or the selected abilities.

## Extensible spell definitions

`src/lib/catalogue.js` contains a versioned, JSON-compatible catalogue, talent patches, strict validation and a compiler. `effect-handlers.js` supplies reusable damage, periodic damage, buffs, Astral charge gains, cooldown/stored-spell-charge resets, DoT refresh and damage-link effects. `engine.js` supplies shared cast/channel timing, targeting, triggers and deterministic simulation. It contains no ability-ID-specific execution branches.

The user-facing shared resource is Astral charges. For compatibility, `catalogue.resource.id` remains `void`; the `shards` alias exposes the current Astral charge count, and `wastedShards` counts Astral charges lost to overcap. These internal identifiers are not separate resources and are not displayed as resource names.

A new spell or talent composed from the supported mechanics is a data change. [The data-only example](docs/examples/new-spell.json) demonstrates this. A genuinely new mechanic needs one reusable handler plus schema validation and tests. Arbitrary embedded scripts are not accepted. The draft Ability Workshop export is design input, not the runtime schema; the existing Workshop is unchanged.

Future Play/Create editing can use the canonical schema and compiler. An encounter editor, tutorial campaign, sixth utility slot, authentication, backend and leaderboards are outside this implementation.

## Clock and metrics

The simulation uses a 60 Hz integer clock and seeded randomness. Hidden tabs, unfocused windows and frames stalled more than 250 ms pause and clear movement. No paused or missed wall-clock time is fabricated on resume.

- Session DPS = exact total damage / simulated active seconds.
- Rolling DPS = damage in `(now - 15s, now]` / `min(15, active seconds)`. Damage at time zero leaves the rolling window at exactly 15 seconds.
- Overkill is excluded. Display rounding does not change stored totals or time.
- **DoT coverage** replaces the former single-Sorrowbrand coverage label. It pools covered ticks / available ticks for every selected maintenance DoT and every living target. Glimmer and the Lingering Touch talent are maintenance DoTs; short spender/AoE DoTs are not maintenance objectives.
- Every target contributes from its first live tick, including initial application delays and newly spawned echoes. There is no grace period, excluded add time, or post-hoc denominator reduction. Each DoT receives the same live-target denominator; missing one lowers pooled coverage. With no maintenance DoT selected, the metric is N/A.
- A stopped summary preserves exact totals, seed, loadout/talents and coverage until a new session. Reloading the page clears results and setup.

## Verify

```sh
npm run verify
```

This runs Svelte diagnostics, core catalogue/engine/readability tests, compiled Svelte component integration/layout tests, and a production build. Individual commands: `npm run check`, `npm run test:core`, `npm run test:ui`, `npm run build`.

Tests exercise all 32 base/talent forms, interaction boundaries, schema failures, data-only extension, deterministic timers, stored-spell-charge/Astral-charge separation, no-recursion links, cast/channel interruptions, DoT coverage, exact DPS, seed replay, hazards, loadout selection, default/custom keyboard mapping, capture/cancel/conflicts/reset, persistence/storage failure, Help/summary/focus/touch flows, teardown and native Canvas rendering. There is no hosted CI workflow.

### Verification limits

Compiled component tests use Happy DOM with native Canvas; they do not establish real-browser layout, live combat feel or touch-device behavior. Before merging or publishing, smoke-test the branch in a target browser: loadout/orb selection, effective base/talent tooltips on hover and keyboard focus, tooltip Escape/scroll/resize dismissal and viewport clamping, touch Help ability details, reorder, key capture/Save/Cancel/Escape/Tab/reset, browser reload persistence, long key labels, start/cast/move/dodge, pause/resume, Help, Stop/restart, tab switching, desktop viewport heights and mobile layout. WebMCP registration is tested with a mock, not a live browser implementation.

The viewport-height fix is preserved: desktop HUD fits shorter viewports using a bounded letterboxed arena and scrolling sidebar, with stacked layout at mobile widths. This ability-tooltips and Astral-wording branch is based on `feature/custom-keybindings` at `ac00812fe2c14e90775834ce06b133cf674549b0`, preserving its spell catalogue, custom slot keys and UI improvements. This work does not merge or deploy any branch.

## Build and preview

```sh
npm run build
npm run preview
```

The static production output is `dist/`; relative asset URLs support a domain root or subdirectory. The source excludes installed dependencies and generated output. Opening HTML directly with `file://` is unsupported.

## Project layout

```text
src/App.svelte                  Session lifecycle, inputs and reactive HUD
src/components/LoadoutPicker.svelte  Orb/talent selection and ordered slots
src/components/HelpDialog.svelte     Help and setup
src/components/KeybindingsDialog.svelte  Draft key capture, cancel and reset
src/lib/keybindings.js          Physical-key validation and local preferences
src/components/SummaryDialog.svelte  Frozen results
src/lib/catalogue.js            Canonical data, validation, patches and compiler
src/lib/ability-details.js      Compiled-ability tooltip/detail projection
src/lib/effect-handlers.js      Reusable effect handlers
src/lib/engine.js               Deterministic combat and encounter scaffold
src/lib/hud.js                  Pure simulation-to-UI projection
src/lib/icons.js                Sigils and readiness clocks
src/lib/renderer.js             Canvas arena and coordinate mapping
src/lib/browser-tools.js        Optional browser-tool registration
```

Optional WebMCP tools read/start/pause/resume/stop sessions, configure validated setup, select a target and attempt one equipped spell through the same actions as the UI. Unsupported browsers skip registration. No tool fast-forwards time, fabricates damage or automates movement. Registrations, animation callbacks, timers and movement state are cleaned up on unmount.
