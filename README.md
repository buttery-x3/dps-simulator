# VEILWEAVER

A Svelte browser game for practicing ranged DPS while dodging. Open the arena, keep DoTs rolling, weave instant procs, and move out of floor telegraphs.

This is a parity port of the working practice arena to **Svelte 5 + Vite**. The combat simulation, Canvas renderer, spell icons, and visual stylesheet are preserved. Svelte owns the HUD, controls, Help, setup, session summary, and mount/unmount lifecycle. There is no server-side rendering, account system, analytics, persistence, or game backend.

## Quick start

Use **Node.js 22.12 or newer** and npm. From this folder:

```sh
npm ci
npm run dev
```

Open the local address printed by Vite, usually <http://127.0.0.1:5173>. Stop the server with Ctrl+C. `npm start` is an alias for the development command. The default server binds only to this computer.

## Build and preview

```sh
npm run build
npm run preview
```

Preview the production build at the printed local address, usually <http://127.0.0.1:4173>. Deploy the contents of `dist/` to any static host. The build uses relative asset URLs so it can live at a domain root or under a subdirectory. No Node.js process is needed on the production host. Opening the HTML directly as a `file://` URL is not supported.

The ZIP contains source and a dependency lockfile. It intentionally excludes installed dependencies and generated build output; the commands above reproduce them.

## Play

Start a session and click the arena to give it keyboard focus.

- **WASD:** move.
- **Tab or click:** select a target.
- **Q — Sorrowbrand:** instant 18-second DoT. Refresh in its final 5.4 seconds to carry remaining duration.
- **E — Nightglass:** stationary 1.5-second cast, 8-second cooldown starting when the cast completes, generates one void shard.
- **R — Gloam Thread:** stationary filler channel, four ticks over three seconds. Moving or casting another spell interrupts the remaining channel.
- **4 — Wraithbolt:** instant proc usable while moving. Two charges maximum, expiring after 12 seconds.
- **5 — Devouring Rift / Umbral Bloom:** three-shard spender; choose the loadout before starting.
- **P:** pause or resume. **Escape:** pause and release arena keyboard focus.
- **? Help:** spellbook, setup, and controls. Opening Help pauses an active session. Closing normally leaves it paused; **Close and resume** resumes explicitly.

The sentinel never dies. Two stationary echoes arrive at 14 seconds and every 30 seconds afterward, up to four live echoes. Each fades after 40 seconds. Circles and lanes telegraph ground impacts; a hit adds 1,000 damage taken without ending the session. This is an endless practice arena with no levels or victory condition.

Touch movement and target controls are included. Desktop keyboard play is the primary experience.

## Verify

```sh
npm run verify
```

This runs Svelte diagnostics, engine/readability tests, compiled Svelte component integration tests, and a production build. Individual commands:

```sh
npm run check
npm run test:core
npm run test:ui
npm test
npm run build
```

The 23 dependency-free engine/readability tests cover combat timing, queueing, cast interruption, DoTs, procs, resource spenders, adds, telegraphs, exact DPS accounting, deterministic seeds, key/icon agreement, readiness thresholds, and starting composition. The Svelte integration suite exercises the actual compiled components in Happy DOM with native Canvas drawing: controls, target cards, settings, Help/summary flows, touch releases, real-time frame handling, optional browser tools, and teardown. The layout suite guards the desktop CSS sizing contracts and checks canvas resizing and letterboxed pointer mapping at multiple aspect ratios. These source and geometry checks do not measure browser layout. No hosted CI workflow is configured.

### Verification limits

Mocked-DOM tests do not replace a real browser or device. Full browser layout, live play feel, touch-device behavior, and WebMCP support have not been validated in a real browser for this port. Before publishing, smoke-test start/cast/move/dodge, pause/resume, Help, Stop/restart, tab switching, and your intended screen sizes in the target browser.

## Project layout

```text
src/
  App.svelte                  Session orchestration, reactive HUD, input
  main.js                     Svelte mount and global stylesheet
  styles.css                  Preserved responsive HUD and visual design
  components/
    SpellIcon.svelte          Shared Canvas spell-icon component
    HelpDialog.svelte         Setup, spellbook, help, pause/resume controls
    SummaryDialog.svelte      Preserved session metrics and breakdown
  lib/
    engine.js                 DOM-free deterministic combat simulation
    renderer.js               Canvas arena and coordinate mapping
    icons.js                  Shared spell sigils and readiness calculations
    hud.js                    Pure simulation-to-HUD projection
    browser-tools.js          Optional WebMCP registration and cleanup
tests/
  engine.test.mjs             Combat regression tests
  readability.test.mjs        Key, icon, clock, and readiness regression tests
  app.test.js                 Compiled Svelte integration tests
  layout.test.js              Viewport CSS contracts and canvas geometry tests
  setup.js                    Test-only DOM/Canvas adapters
docs/PRODUCT.md               Implemented scope and planned direction
```

`RaidSim` stays mutable and framework-independent. The app derives fresh HUD projections rather than proxying the simulation through framework state. The animation loop advances the simulation using elapsed frame time and refreshes both arena and icon visuals. Svelte lifecycle cleanup cancels animation callbacks, pending UI timers, movement input, and browser-tool registrations on unmount.

## Clock and metrics

The simulation uses a 60 Hz integer clock and seeded randomness. Hidden tabs and unfocused windows pause automatically and clear movement keys. Frames stalled longer than 250 ms pause rather than catching up. Resuming never fabricates active time.

- Session DPS = total damage / simulated active seconds.
- Rolling DPS = damage in `(now - 15s, now]` / `min(15, active seconds)`.
- Damage at time zero leaves the rolling window at exactly 15 seconds.
- Overkill is excluded. Display rounding does not change exact stored totals or time.
- Brand coverage pools all live-target time, including the permanent dummy and each echo.
- A stopped summary retains the exact totals, elapsed time, seed, and loadout until the next session. Results are not saved across page reloads.

## Optional browser tools

The app feature-detects WebMCP. Eight optional tools expose session read/start/pause/resume/stop, setup, target selection, and one spell attempt through the same actions as the UI. Unsupported browsers simply skip registration. There is no tool for fast-forwarding, fabricating damage, or automating movement. The test registry is mocked; it does not establish real-browser WebMCP compatibility.

## Product direction

See [docs/PRODUCT.md](docs/PRODUCT.md). Encounter design, moving projectiles, rally zones, configurable AoE, user-created encounter links, and leaderboards are future ideas, not implemented features in this port.

Framework reference: [Svelte documentation](https://svelte.dev/docs/svelte/overview) and [Vite documentation](https://vite.dev/guide/).
