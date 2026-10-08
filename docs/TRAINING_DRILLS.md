# Training drills

The Fight arena runs a selected, versioned drill. Open **Edit** to change the practice setup; entering Edit pauses an active run. A drill describes the player start, permanent boss targets, recurring add waves and movement mechanics. Loadouts, talents and spell keys remain separate preferences. There is no fixed run length: use **Stop** to preserve the current summary.

## Editing and persistence

The editor works on a draft. **Save drill** stores a valid draft for the next Start; **Save as new** stores a separate drill. Returning to Fight or switching drafts asks before discarding unsaved changes. A paused run retains its captured drill: Resume continues it unchanged, while Stop followed by a new Start uses the current saved selection. Select a saved drill, create or duplicate one, rename it, or delete a drill through the editor. The last remaining saved drill cannot be deleted. The selected drill and library are saved in this browser under `veilweaver.drills.v1`. They are separate from `veilweaver.loadout.v1` and `veilweaver.keybindings.v1`; no account or backend is involved.

Drills and libraries can be exported as JSON. Import validates the entire input before changing the library. An imported ID that already exists requires an explicit replacement choice. Invalid, unsupported or oversized input does not partly replace saved drills. Loading corrupt or unavailable browser storage falls back to the default for the current visit without overwriting the original store. A failed save leaves the edited library available in memory and reports that persistence failed. Reload starts a fresh ready session; live combat and previous results are not restored.

Libraries contain 1–64 drills. JSON imports are limited to 1 MiB of UTF-8 text. A library export has this envelope:

```json
{
  "version": 1,
  "selectedId": "single-target",
  "drills": [{
    "version": 1,
    "id": "single-target",
    "name": "Single target practice",
    "seed": 72821,
    "playerStart": {"x": 500, "y": 445},
    "bosses": [{"id": "sentinel", "name": "Eternal sentinel", "x": 500, "y": 160}],
    "addWaves": [],
    "mechanics": []
  }]
}
```

A single complete drill object can also be imported directly.

## Schema, version 1

`src/lib/drills.js` is the canonical schema, defaults, validator and compiler. Definitions are JSON-only data, never executable code. Every field shown by its object type is required. Unknown fields, unknown kinds, missing fields, duplicate IDs, non-finite numbers, numeric strings and unsupported versions are rejected instead of coerced or partly repaired. Validation returns a clean copy; compilation freezes the drill and schedules.

A minimal complete drill is:

```json
{
  "version": 1,
  "id": "single-target",
  "name": "Single target practice",
  "seed": 72821,
  "playerStart": {"x": 500, "y": 445},
  "bosses": [
    {"id": "sentinel", "name": "Eternal sentinel", "x": 500, "y": 160}
  ],
  "addWaves": [],
  "mechanics": []
}
```

- `version` is exactly `1`.
- `id` starts with a letter or digit and contains 1–64 letters, digits, hyphens or underscores. `constructor`, `prototype` and `__proto__` are disallowed. The drill ID and all boss, add-wave and mechanic IDs must be unique within a definition.
- `name` is nonblank text, at most 100 characters, with no control characters. Leading and trailing whitespace is trimmed.
- `seed` is an integer from 1 through 4,294,967,295.
- `playerStart` has `x` and `y` coordinates.
- `bosses` contains 1–8 permanent targets, each with `id`, `name`, `x` and `y`. Each boss is stationary, has an infinite health pool and a 24-unit collision radius. Council members retain their actual names in the arena. Bosses contribute to live-target DoT coverage from the beginning.
- `addWaves` contains 0–16 recurring wave rules.
- `mechanics` contains 0–32 recurring mechanic rules, in their deterministic evaluation order.

### Coordinates, placements and schedules

The simulation arena is 1000 × 560 world units, with positive X to the right and positive Y downward. Configured positions must have X from 30–970 and Y from 30–530. Angles are degrees: 0 travels right, 90 down, 180 left and 270 up. Radii, sizes, widths, spacing and speeds use world units, with speed measured per active second.

Every recurring rule has:

```json
{
  "id": "unique-rule-id",
  "first": 6,
  "frequency": 8,
  "placement": {"mode": "fixed", "x": 500, "y": 280}
}
```

This is a shared-fields fragment; add the fields for an add wave or mechanic before importing.

- `first`: first occurrence time, 0–3600 seconds. A value of 0 fires when the session starts.
- `frequency`: time between occurrences, 0.25–3600 seconds. Rules recur until the user stops.
- `placement.mode`: `fixed`, `player` or `random`. Fixed uses the configured point; player samples the player's point at spawn; random samples a seeded point within the position bounds. `x` and `y` remain required and validated for these three modes. ADD waves also accept the point-list shape below. Ground mechanics do not. Projectile walls use an arena-edge spawn plane instead of this point.

Timing rounds to the nearest integer tick of a 60 Hz simulation. Frequencies are at least one tick after compilation. Delays range from 0–120 seconds. Positive durations and lifetimes range from 1/60–120 seconds. A zero-delay event resolves at its occurrence; it has no advance warning. Paused, ready, hidden-tab and unfocused time does not advance the encounter. Resuming never manufactures missed wall-clock time.

Each rule maintains its own occurrence counter. `direction: "fixed"` uses `angle`; `random` chooses a seeded angle each occurrence; `sequence` uses `angle + occurrence × angleStep`, starting with occurrence zero and wrapping to a full turn. `angle` and `angleStep` each accept −3600 through 3600 degrees. Sequence counters reset for a new run. Encounter randomness is separate from spell-proc randomness; spell random rolls do not shift an encounter's random sequence. Player-relative placement and aimed shots still depend on the player's actions.

### Add waves

A complete rule, with the factory defaults:

```json
{
  "id": "echo-wave",
  "first": 14,
  "frequency": 30,
  "count": 2,
  "placement": {"mode": "fixed", "x": 255, "y": 180},
  "health": 6200,
  "lifetime": 40
}
```

`count` is an integer from 1–32; `health` is 1–10,000,000. Adds remain stationary, with 20-unit collision radii. Damage can defeat an add; otherwise it fades when its lifetime expires. Newly arrived adds immediately contribute to all selected maintenance-DoT denominators, including time before the first application.

#### Authored spawn points

An ADD wave can replace its legacy placement with this additive version-1 shape:

```json
{
  "mode": "points",
  "selection": "ordered",
  "points": [{"x": 430, "y": 180}, {"x": 570, "y": 180}]
}
```

Lists require 1–32 points within the ordinary coordinate bounds. `selection` is required and is one of:

- `random`: draw a seeded point separately for **each add**, including multiple adds in the same wave. Repeated choices are allowed; occupancy resolves them without stacking.
- `ordered`: use point 1, then 2, and so on, wrapping to 1. Each rule has its own cursor. It advances after every successfully spawned add, continues across wave occurrences and Resume, and resets on a fresh Start. Skipped spawns do not consume ordered points.
- `priority`: choose the first currently free point in authored order for each add. A death or expiry frees the point immediately. If all listed points are occupied, request point 1 and apply the same nearest-free resolver.

Choose **Spawn-point list** in the ADD wave's Placement selector. Add, remove or reorder numbered points; at least one must remain. Select a numbered **Point** button or its arena marker to make it the active point. Edit its X/Y, click or drag in the world preview, or use arrow keys (Shift for 10-unit steps). The selected point has a gold ring. Ordered lists connect their numbered markers in order. These markers show requested origins; live occupancy can move a spawn. Switching back to a legacy placement keeps the selected point's coordinates. Point lists are deliberately unavailable to ground, projectile and safe-zone mechanics.

#### Collision-free ADD placement

Every ADD placement, including existing fixed/player/random rules, resolves separately per add. If the requested point is free, it stays exact. Otherwise the resolver picks the closest legal center with two units of clearance beyond the sum of radii, checking all live ADDs **and permanent bosses**, including targets spawned earlier in the same wave or by another rule. Dead/expired adds do not block points. The player is not an obstacle. There is no enemy movement or player-following AI.

Equal-distance choices prefer up, left, down, then right (counterclockwise from up); a closer diagonal boundary wins over a farther cardinal candidate. The whole ADD circle stays within the arena and its center within the 30-unit margins. Instead of a coarse grid or unbounded retry loop, the resolver searches the finite circle-boundary intersections, arena-edge intersections and radial projections that can be the nearest free point. At the 64-ADD / 8-boss limits there are at most 72 obstacles. If no legal position exists, it skips the remainder of that occurrence, without overlap or a growing queue; later scheduled occurrences try again. Wave events report the actual created count.

Legacy version-1 JSON remains accepted and exports with its original placement fields. The former centered grid is replaced by this general anti-overlap rule; random world placement now samples per add. Ground mechanics retain their existing placement behavior.

### Ground circles

```json
{
  "id": "circle-rule",
  "kind": "circle",
  "first": 6,
  "frequency": 8,
  "placement": {"mode": "fixed", "x": 500, "y": 280},
  "delay": 2,
  "radius": 76,
  "damage": 1000
}
```

`radius` is 12–450. A red hatched circle counts down to one impact. Touching it with any part of the player disk at impact deals the configured damage once. Its visual fades for another 0.55 seconds without dealing additional hits.

### Ground lines

```json
{
  "id": "line-rule",
  "kind": "line",
  "first": 6,
  "frequency": 8,
  "placement": {"mode": "fixed", "x": 500, "y": 280},
  "delay": 2.6,
  "width": 72,
  "angle": 0,
  "direction": "fixed",
  "angleStep": 30,
  "damage": 1000
}
```

`width` is 12–1000. The lane passes through its sampled placement and extends across the arena. It counts down and hits once, using the same any-part-of-player contact rule and 0.55-second aftermath as circles. The angle defines the lane's axis. Direction mode and step permit fixed, seeded-random or rotating sequences.

### Hostile projectiles

```json
{
  "id": "projectile-rule",
  "kind": "projectiles",
  "first": 6,
  "frequency": 8,
  "placement": {"mode": "fixed", "x": 500, "y": 280},
  "pattern": "fan",
  "count": 5,
  "spread": 60,
  "speed": 180,
  "spacing": 64,
  "size": 8,
  "angle": 90,
  "direction": "fixed",
  "angleStep": 20,
  "damage": 750,
  "lifetime": 12
}
```

- `pattern`: `aimed`, `fan`, `radial` or `wall`.
- `count`: integer 1–32.
- `spread`: 0–360 degrees, used by fans. A one-projectile fan uses its centerline.
- `speed`: 10–1200 world units per active second.
- `spacing`: 30–1000, used for parallel aimed shots and walls.
- `size`: projectile collision radius, 2–40.
- `lifetime`: 1/60–120 seconds. It bounds projectile lifetime even while offscreen.
- `angle`, `direction` and `angleStep` use the orientation rules above for fan, radial and wall patterns. Aimed shots ignore these three fields. All fields stay required and validated even when a pattern does not use them.

Aimed shots travel directly along the player's bearing sampled at spawn, ignoring the stored angle and direction fields. They travel straight afterward, without homing. Multiple aimed shots are parallel and separated along the axis perpendicular to travel. Fans spread evenly around their centerline. Radial shots are evenly spaced through 360 degrees, with `angle` as the first spoke.

Walls originate beyond the upstream support plane of the arena and travel inward, even for diagonal directions. Their placement point does not move that spawn plane. Projectiles are spaced perpendicular to their travel. Wall spacing must be at least `2 × size + 26`, leaving a gap for the 24-unit-wide player plus two units of clearance. High counts or spacing can put some wall projectiles beyond the visible arena; the configured lifetime still removes them.

Hostile projectiles have orange-red heads, a forward chevron and a trailing red wake. They are separate from friendly spell-effect projectiles. Swept relative-motion collision checks use the full motion of both player and projectile each tick, preventing fast shots from tunneling through a moving player. A colliding projectile deals damage once, increments projectile hits, and disappears.

### Safe-zone deadlines

```json
{
  "id": "deadline-rule",
  "kind": "safe-deadline",
  "first": 6,
  "frequency": 8,
  "placement": {"mode": "fixed", "x": 500, "y": 280},
  "delay": 3,
  "radius": 80,
  "damage": 1000
}
```

A cyan destination says **ENTER BY** and counts down. At the deadline, the entire 12-radius player disk must fit within the zone: center distance plus player radius must be no greater than zone radius, allowing only a tiny floating-point tolerance. Reaching the circle earlier is insufficient if the player leaves before expiry. Each expired zone records exactly one reached or missed opportunity. A miss adds the configured damage once; the zone then disappears. Multiple deadlines are independent opportunities even when they overlap. Pending countdowns do not affect the success denominator.

### Safe-zone holds

```json
{
  "id": "hold-rule",
  "kind": "safe-hold",
  "first": 6,
  "frequency": 8,
  "placement": {"mode": "fixed", "x": 500, "y": 280},
  "delay": 3,
  "duration": 5,
  "radius": 110,
  "damage": 500
}
```

The cyan warm-up says **HOLD IN**. At activation it becomes a green **HOLD** destination, counting down its active duration. `duration` is 1/60–120 seconds. The player must fit fully inside any currently active hold zone; warm-up zones do not provide safety. A check mark identifies a zone that fully contains the player.

Hold time is sampled at 60 Hz over `(activation tick, ending tick]`. Active time is the union of all active hold windows, so overlapping holds never double-count the denominator. Inside time counts once when any active zone fully contains the player; outside time counts once otherwise. Thus inside plus outside equals active hold time. Warm-up, ready and paused time are excluded.

Every 60 accumulated outside ticks adds one damage hit, using the largest damage value among the hold zones active on that tick. This outside-tick accumulator persists across safe periods and gaps between hold windows. Overlap never multiplies the penalty. Less than a full accumulated outside second still contributes to coverage and outside time but has not yet triggered another damage hit.

## Damage and bounds

Every mechanic's `damage` accepts 0–100,000. Damage taken does not kill the player or end the session. Every collision or penalty increments the total hit counter, including zero-damage practice hits. The configured amount is added to damage taken; applicable projectile or deadline metrics and mechanic events are also recorded.

The runtime has no growing queue of future recurring events. It tracks one next-occurrence tick per rule. Simultaneous object caps are:

- 64 live adds, separate from the 1–8 permanent bosses
- 96 live circle/line hazards
- 256 live hostile projectiles
- 64 live safe zones, combining deadlines and holds

An occurrence advances on schedule even if a cap leaves no room. Only objects that fit are created; skipped objects are not deferred into a backlog. Lifetime and expiry cleanup reclaim capacity. These are safety ceilings, not suggested encounter density.

## Default drill

The saved fallback is `training-default`, **Sentinel practice**, seed 72821. The player starts at (500, 445), with one **Eternal sentinel** at (500, 160). A default add wave creates two 6200-health echoes at ordered points (430, 180) and (570, 180), flanking the boss, at 14 seconds and every 30 seconds; each lasts 40 seconds. If earlier echoes are still alive when the next wave arrives, new echoes use the closest clear positions. A player-placed 76-radius circle first appears at 6 seconds and repeats every 6.4 seconds, with a 2-second warning and 1000 damage on impact. No projectile or safe-zone rule is enabled by default.

On browser load, only the exact untouched historical `training-default` definition (including its old fixed (255, 180) placement and every other original setting) upgrades to the new Sentinel layout in memory. Loading does not write storage. Customized drills, including customized drills with that same ID, keep their authored settings. Direct imports do not migrate: an imported exact historical default is indistinguishable from the old built-in once saved and reloaded, and then also upgrades. **New from default** creates a separate draft using the current Sentinel layout, so it is always accessible without deleting existing drills or clearing storage. Save it when ready.

New rule factories use the complete examples above. The **New** button starts an **Untitled drill** with the default player and permanent boss but no add waves or mechanics. The lower-level `createDrill()` factory copies the complete default layout and rules unless overridden, using the name **New training drill** and a fresh ID. The engine uses a compiled, immutable drill snapshot for each run; edits for future practice cannot mutate a stopped summary.

## Metrics and summaries

The stopped summary preserves `drillId`, `drillName`, the full `drill` definition and seed alongside the existing frozen loadout, spell keys and damage results.

- `projectileHits`: number of hostile projectile collisions, including zero-damage shots.
- `safeDeadlineOpportunities`: completed deadline checks only.
- `safeDeadlineReached` / `safeDeadlineMisses`: completed checks where the full player disk was inside / not inside.
- `safeDeadlineRatio`: reached ÷ opportunities; `null` before any completed opportunity.
- `safeHoldActiveSeconds`: ticks with at least one active hold ÷ 60.
- `safeHoldInsideSeconds`: those ticks spent fully inside any active hold ÷ 60.
- `safeHoldOutsideSeconds`: those ticks spent outside all active holds ÷ 60.
- `safeHoldRatio`: inside active-hold ticks ÷ active-hold ticks; `null` before any active hold time.

Ratios with no denominator display **Not applicable**. Display rounding does not change stored totals. Ordinary session DPS still uses exact total damage divided by simulated active seconds; rolling DPS and maintenance-DoT coverage retain their existing definitions. Safe-zone coverage is independent of DoT coverage.

`src/lib/drill-runtime.js` executes these rules. `src/lib/renderer.js` renders their floor fills below actors and spell effects, then redraws crisp mechanic boundaries and countdowns above them. `tests/drill-renderer.test.mjs` exercises real native Canvas pixels, safe/hostile color separation, timer states, full-disk confirmation, layering, permanent target names and letterboxed pointer coordinates.
