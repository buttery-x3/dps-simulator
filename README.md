# VEILWEAVER

A Svelte browser arena for practicing ranged damage while dodging. Choose a rotation, keep damage-over-time effects rolling, commit to casts and channels, and move out of floor telegraphs.

## Quick start

Use **Node.js 22.12 or newer** and npm:

```sh
npm ci
npm run dev
```

Open the local address printed by Vite (usually <http://127.0.0.1:5173>). The default server binds to this computer. `npm start` is an alias. There is no backend, account, analytics, or persistent storage.

## Choose a loadout

Start immediately with five base abilities, or open **Customize loadout** before starting. The same controls are in Help.

- Eight large ability orbs, each with three connected talent orbs.
- Select one to five abilities, with five selected by default.
- Five available talent points. Each selected ability can have zero or one talent; no stacking and no requirement to spend every point.
- The five ordered slots assign **Q / E / R / 4 / 5**. Use slot arrows to rearrange them.
- Focus or hover an orb for its description. Click a selected talent again to remove it. Native buttons support keyboard selection.
- A warning explains a spender without a generator. The loadout remains legal for experimentation.
- Choose clustered or spread stationary echoes to compare area attacks and chain bounces.
- Setup is locked during an active or paused run. Stop first; the completed summary stays frozen until the next session.

The default selects Veil Bolt, Lingering Glimmer, Gloam Thread, Astral Flare and Area Pulse, with all five talent points unspent. Destructive Rift, Chain Strike and Focused Energy are available in the catalogue. Rift is intentionally the only resource spender; generation comes from talents. Shared void resource and an ability's stored charges are separate systems.

The 8 abilities and 24 talents are provisional prototype tuning, not a balanced class or historical simulation. See [the spell-system contract and tuning](docs/SPELL_SYSTEM.md).

## Play

- **WASD:** move.
- **Tab or click:** select a target.
- **Q / E / R / 4 / 5:** use the ability assigned to that slot.
- **P:** pause/resume. **Escape:** pause and release arena keyboard focus.
- **Help:** controls, loadout, setup, exact metric definitions. Opening Help pauses; closing leaves the run paused unless you choose **Close and resume**.
- **Stop:** preserve a summary. Start a new session when ready.

Instant spells work while moving. Ordinary casts and channels require stillness; Drifting Flare is a moving cast. Moving, losing a target, or clipping a channel stops future ticks. Gloam Storm commits its cooldown at channel start even when interrupted. Full Conduit grants resource only after a complete Gloam Thread channel, including a lethal final tick.

The sentinel never dies. Two stationary echoes arrive at 14 seconds and every 30 seconds afterward, up to four live echoes. Each fades after 40 seconds. Circles and lanes telegraph ground impacts; a hit adds 1,000 damage taken without ending the session. There is no victory condition or enemy AI. Touch movement and targeting are included; desktop keyboard play remains primary.

## Extensible spell definitions

`src/lib/catalogue.js` contains a versioned, JSON-compatible catalogue, talent patches, strict validation and a compiler. `effect-handlers.js` supplies reusable damage, periodic damage, buffs, resource gains, cooldown/charge resets, DoT refresh and damage-link effects. `engine.js` supplies shared cast/channel timing, targeting, triggers and deterministic simulation. It contains no ability-ID-specific execution branches.

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

Tests exercise all 32 base/talent forms, interaction boundaries, schema failures, data-only extension, deterministic timers, charge/resource separation, no-recursion links, cast/channel interruptions, DoT coverage, exact DPS, seed replay, hazards, loadout selection, keyboard mapping, Help/summary/focus/touch flows, teardown and native Canvas rendering. There is no hosted CI workflow.

### Verification limits

Compiled component tests use Happy DOM with native Canvas; they do not establish real-browser layout, live combat feel or touch-device behavior. Real-browser launch is unavailable in the current execution environment. Before merging or publishing, smoke-test the branch in a target browser: loadout/orb selection, reorder, start/cast/move/dodge, pause/resume, Help, Stop/restart, tab switching, desktop viewport heights and mobile layout. WebMCP registration is tested with a mock, not a live browser implementation.

The unmerged viewport-height fix is preserved: desktop HUD fits shorter viewports using a bounded letterboxed arena and scrolling sidebar, with stacked layout at mobile widths. This feature branch is based on `fix/arena-viewport-height` (`c31b0bd`), one commit ahead of main at `9ea85a1`. It does not merge or deploy either branch.

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
src/components/SummaryDialog.svelte  Frozen results
src/lib/catalogue.js            Canonical data, validation, patches and compiler
src/lib/effect-handlers.js      Reusable effect handlers
src/lib/engine.js               Deterministic combat and encounter scaffold
src/lib/hud.js                  Pure simulation-to-UI projection
src/lib/icons.js                Sigils and readiness clocks
src/lib/renderer.js             Canvas arena and coordinate mapping
src/lib/browser-tools.js        Optional browser-tool registration
```

Optional WebMCP tools read/start/pause/resume/stop sessions, configure validated setup, select a target and attempt one equipped spell through the same actions as the UI. Unsupported browsers skip registration. No tool fast-forwards time, fabricates damage or automates movement. Registrations, animation callbacks, timers and movement state are cleaned up on unmount.
