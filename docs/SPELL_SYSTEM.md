# Declarative spell system v1

This is the runtime and authoring contract for the playable arena. The approved
ability-workshop-plan (1).json is a design draft with schema 2, prose fields and
editor state. It is **not** a file the engine executes. The canonical runtime
schema below is version 1; the different version numbers identify different
formats, not compatible revisions of the same format.

The catalogue contains eight base abilities and three mutually exclusive talents
per ability: 32 playable forms, not 32 simultaneous action-bar buttons. Select
one to five unique abilities and zero or one talent for each. Selection order
assigns Q, E, R, 4 and 5. Focused Energy occupies an ordinary selected slot; there
is no sixth utility button and no legacy Wraithbolt proc ability.

All numbers introduced to turn prose into playable definitions are provisional
practice tuning, not a balance claim. The current arena remains the practice
encounter. Tutorial encounters, an encounter builder, Workshop import/export and
publishing are future work.

## Architecture and public API

- `src/lib/catalogue.js`: immutable catalogue data, validation and pure compiler.
- `src/lib/effect-handlers.js`: a bounded registry of reusable effect handlers.
- `src/lib/engine.js`: deterministic clock, actions, resource/cooldown state,
  targets, periodic effects and encounter orchestration.
- `src/lib/hud.js` and the UI consume the selected compiled spells, rather than
  maintaining a second list of spell rules.

Exports from `catalogue.js`:

```js
CATALOGUE = {schemaVersion: 1, resource: {id: 'void', max: 3}, abilities: [...]}
ABILITIES = CATALOGUE.abilities
SLOT_KEYS = ['Q', 'E', 'R', '4', '5']
DEFAULT_LOADOUT = {
  abilities: ['veil-bolt', 'lingering-glimmer', 'gloam-thread', 'astral-flare', 'area-pulse'],
  talents: {}
}
validateCatalogue(catalogue)             // {valid, errors}
validateLoadout(loadout, catalogue?)     // {valid, errors, warnings}
compileAbility(id, talentId?, catalogue?)
compileLoadout(loadout, catalogue?)
```

`compileAbility` returns a fresh independent object. It retains the stable base
ability ID and metadata, and adds `detail` (the compiled description), a readable
`type`, `talentId` and `talentName`. Base `talentId` is null and `talentName` is
`Base`. Omission, null or the string `base` selects the base. An empty string or
unknown talent is rejected. `compileLoadout` additionally assigns `key` and
zero-based `index`. Compiling never mutates the catalogue. Invalid definitions or
loadouts throw; validation reports readable paths and does not execute data.

The engine accepts `new RaidSim({catalogue, loadout, seed, mechanics, layout})`.
The UI can prepare a loadout before starting; an active or paused session must be
stopped before its selection changes. Configurations with a spender but no
resource generator, a generator but no spender, or an Astral restoration talent
without Astral Flare produce warnings rather than adding hidden abilities or
blocking otherwise valid selections.

## Canonical definition

Each ability has the following fields. Optional fields are marked `?`.

```text
id, name, short, color, icon, description
activation: {kind, duration, moving, interval?}
targeting: {kind, range, radius?, additional?, jumpRange?, secondaryMultiplier?}
gcd: seconds
cooldown: seconds
charges: integer
cost?: {min, amount, spend, retainedOutcomes?}
effects: [tagged effects]
triggers: [{event, chance, effects: [tagged effects]}]
talents: [{id, name, description, patch}]
```

- `activation.kind` is `instant`, `cast` or `channel`. Instant duration is 0;
  casts and channels have positive durations. Only channels have `interval`,
  which must divide their duration and preserve the same tick count after 60 Hz rounding.
  `moving` explicitly permits movement during a cast/channel.
- `targeting.kind` is `single`, `area`, `chain` or `self`. `range` is measured from
  player to primary target. `radius` exists only on area targeting and is centred
  on the primary. `additional` and `jumpRange` exist only on chain targeting.
  Chains choose the nearest unvisited target within each jump range, using a
  stable target-ID tiebreaker. `secondaryMultiplier` optionally scales all
  non-primary hits for area/chain targeting. Self-targeting needs no enemy.
- `gcd` is positive. `cooldown` may be zero. `charges: 1` means a normal cooldown,
  not a separately stored resource; values greater than 1 mean stored charges
  and require a positive recharge cooldown.
- `cost.spend: fixed` requires `min === amount`. `all` requires `amount` equal to
  the resource maximum and spends the current amount after its `min` gate.
  Optional `retainedOutcomes` is a list of distinct integers for fixed costs;
  successful resolution makes one equal-probability choice from the list.
- `icon` is a semantic icon ID, normally the same ID as the built-in ability.
  An extension may reuse an existing sigil; the renderer supplies its ordinary
  fallback for an unfamiliar icon. `color` is a six-digit hex colour.

### Talent composition

A patch recursively merges plain objects and **replaces arrays in full**. It
cannot change `id` or `talents`. It may change metadata such as description,
activation, targeting, cooldown, cost, effects and triggers. Both the base and
every separately composed talent must validate, whether selected or not.

For example, `{targeting: {radius: 140}}` retains the base area kind and range.
`{effects: [{type: 'damage', amount: 650}]}` replaces the entire old DoT array.
Switching kinds must supply a complete compatible result: changing a cast to
instant requires `duration: 0`. There is no deletion sentinel or arbitrary
patch language. In particular, a patch cannot delete an inherited channel
interval to convert a channel base into a cast; author a compatible base or
extend the schema deliberately rather than relying on implicit field removal.

### Tagged effects

| Effect | Fields | Meaning |
| --- | --- | --- |
| `damage` | `amount`, `perResource?`, `rampPerTick?` | Direct damage to each selected victim. Resource scaling uses this action's spent amount; channel ramp is `base × (1 + rampPerTick × (tickIndex - 1))`. |
| `dot` | `id`, `name`, `duration`, `interval`, `amount`, `carry`, `maintenance`, `perResource?` | An independent target DoT; no application hit unless a separate damage effect exists. |
| `buff` | `id`, `duration`, `modifiers` | Self-buff. Recognised multipliers are `castTime`, `gcd`, `resourceGain`. Reapplying the same buff ID replaces it. |
| `link` | `duration`, `fraction` | Links a chain's primary to its bounced victims. Copies that fraction of later primary damage without recursive link copies or resource triggers. |
| `refreshDots` | `ids?` | With IDs, refreshes only matching existing DoTs on hit targets. With no IDs, refreshes every existing DoT on all living targets. Never creates a missing DoT. |
| `resetCooldowns` | none | Resets all selected cooldowns and fully restores every stored-charge pool. |
| `restoreCooldown` | `abilityId` | Resets a normal cooldown, or restores **one** stored charge. Unselected referenced abilities are a harmless no-op with a loadout warning. |
| `resource` | positive integer `amount` | Generates shared resource once per effect context, multiplied by current gain buffs and capped at maximum. |

Arrays retain their authored execution order. Damage/DoT effects apply per
victim. Buff, cooldown, refresh and resource operations are executed once per
context rather than once per AoE target. Channel main effects resolve at each
scheduled tick; put a one-time channel-end effect in a `complete` trigger.

Trigger events are `cast`, `complete`, `periodicTick` and `hit`. `chance` is
between 0 and 1. `cast` occurs once on accepted activation, `complete` once on a
successful full completion, `periodicTick` for the ability's independent DoT
ticks, and `hit` once per selected target per resolved action/tick. A hybrid hit
is not two hit events just because it has damage and DoT components. Trigger
effects do not recursively dispatch trigger events. There are no executable
scripts, callbacks, formulas, imports or user-defined trigger names.

## Timing, resources and refreshes

- The simulation advances on integer 60 Hz ticks. Authored seconds round to
  ticks; no positive timer may be shorter than one tick. Cast/GCD modifiers are
  locked at activation. Buff expiry does not retime work already started.
- Instants resolve immediately; cast effects wait until successful completion.
  Channels first tick after one interval and stop producing damage immediately
  when clipped or interrupted. Thread's fourth tick coincides with full
  completion; its guaranteed builder trigger fires exactly once at that point, even if the final
  tick kills the primary target.
- Shared resource costs are reserved on accepted activation. Ordinary interrupted
  casts or cast target loss refund the reservation to the cap; overflow is reported.
  Channels commit their cost at activation and do not refund it on interruption.
  Chaos retention is rolled only on successful resolution, never on an
  interrupted cast. Refunds and retained resources are not builder gains.
- Normal cast cooldowns start on successful resolution. Instant and channel
  cooldowns start at activation; interrupting a channel does not undo its committed
  cooldown because it may already have delivered damage. Stored charges are spent at activation and recharge serially,
  one full cooldown per missing charge. They never expire like the removed
  proc charges. Single-charge restoration leaves any running serial recharge
  in place unless it fills the pool; full restoration ends the recharge timer.
- Focused Energy's 0.9 or 0.8 multipliers apply only to casts and GCDs. They do
  not alter channel duration, channel tick intervals, independent DoT intervals
  or recharge rates. Resource-gain buffs are evaluated when a gain occurs.
- Normal Glimmer/Touch reapplication preserves the next tick time and carries
  at most 30% of the new base duration. Linger Longer therefore has a 10.8s
  carry ceiling. There is no immediate damage or periodic trigger on refresh.
- A `refreshDots` effect sets expiration to now plus the stored base duration,
  preserves damage/resource scaling and the next scheduled tick, and adds no
  carry. Dead/expired targets and missing/expired DoTs are not resurrected.
- A stored link copies actual damage dealt after overkill is removed. Copied
  damage cannot recurse through links or trigger resource rolls. Links expire
  after 10s in the shipped talent and are removed with their targets.
- Seeded randomness and identical inputs produce identical outcomes. No timing,
  success rolls or metrics depend on wall-clock frame size.

## Shipped catalogue and provisional tuning

All abilities have a base 1.2s GCD and 700 target range except the self-buff's
unused range of zero. The resource maximum is three; sessions start at zero.
Every ability has `v1`, `v2`, `v3`, with the unchanged base selected by default.
Numbers in this table are deliberately explicit so future balancing is a data
change rather than an engine branch.

| Ability | Base | v1 | v2 | v3 |
| --- | --- | --- | --- | --- |
| Veil Bolt | Stationary 1.5s cast, 640 damage, no cooldown | Heavy Veil: 1,150 damage, 6s cooldown | Lingering Touch: base hit plus 180/3s for 18s, maintenance DoT with 30% carry | Charged Veil: 20% resource chance on completed hit |
| Lingering Glimmer | Instant DoT, 240/3s for 18s, 30% carry, maintenance | Lingering Resource: same instant DoT, 2% resource chance per periodic tick | Astral Refresh: same instant DoT, 50% **on cast** to reset Flare or restore one charge | Linger Longer: 36s duration, same tick damage/rate |
| Gloam Thread | Stationary 3s channel, four 180 ticks at 0.75s | Gathering Gloam: 180/225/270/315 ticks | Full Conduit: guaranteed one resource only on full completion | Twin Threads: primary plus nearest one within 260, secondary takes 50% |
| Astral Flare | Instant 900 hit, 8s cooldown | Astral Builder: 50% resource chance per hit | Drifting Flare: moving 1s cast, 520 damage, no cooldown | Stored Starlight: three stored hits, 10s serial recharge |
| Destructive Rift | Stationary 1.5s cast, 2,400 damage, spends three | Devouring Rift: instant **DoT only**, consumes current one–three; 150/resource/s for 6s | Chaos Rift: one roll retains 0/1/2/3, each 25% | Refreshing Rift: base hit, reset all cooldowns/full charges, refresh all existing DoTs on living targets |
| Area Pulse | Instant area DoT, radius 220, 180/2s for 12s, 30s cooldown | Falling Night: stationary 2s cast, 700 direct plus normal DoT | Gloam Storm: stationary 4s area channel, eight 450 ticks at 0.5s, no lingering field, 30s cooldown | Compressed Pulses: instant 650 direct, radius 140, three charges, 10s serial recharge |
| Chain Strike | Stationary 1.5s cast, 520 to primary plus up to three, 260 jump range | Binding Chains: links bounced victims for 10s, copies 10% primary damage | Lingering Chains: 240 per target, 10s cooldown, refreshes only existing Glimmer/Touch on hit targets | Charged Chains: independent 10% resource chance per hit target |
| Focused Energy | Instant self-buff, 15s, 10% shorter cast/GCD, 120s cooldown | Deeper Focus: 20% shorter cast/GCD | Frequent Focus: 60s cooldown | Abundant Focus: normal timing buff plus double resource gains |

The design draft's old IDs map as follows: `basic-cast` → `veil-bolt`,
`lingering-mark` → `lingering-glimmer`, `sustained-beam` → `gloam-thread`,
`quick-hit` → `astral-flare`, `heavy-spender` → `destructive-rift`, and
`focused-burst` → `focused-energy`. `area-pulse` and `chain-strike` keep their
IDs. These are documented migration correspondences, not live alias support.

Authoritative clarifications take precedence over contradictory draft patches:
Glimmer v1 is not direct damage and v2 is not a channel; its reset is on cast.
Focused Energy shortens cast/GCD time rather than making casting slower.
Devouring Rift has no direct application hit. Chaos percentages describe a
single equal-probability retention roll, not three independent cumulative rolls.
Pulse's channel uses channel-owned periodic damage, not a freshly reapplied DoT
every tick. Workshop prose and UI state have not been edited or imported.

## Coverage is a maintenance drill metric

Each selected maintenance DoT contributes its own denominator for **every live
target tick**, from target appearance. The initial delay before the first
application counts as uncovered time. So does neglecting an add or maintaining
only one of two selected maintenance DoTs. There is no application grace window,
no exclusion for short-lived targets, and no retrospective removal of missed
time when a target dies or disappears.

- Numerator: covered live-target ticks, summed across selected maintenance DoTs.
- Denominator: all live-target ticks, summed across those same DoTs.
- Overall coverage is numerator divided by denominator, not an unweighted mean
  of per-target percentages. Per-DoT figures use their own numerator/denominator.
- Only Glimmer and the Lingering Touch talent are maintenance DoTs in the shipped
  catalogue. Rift and Pulse DoTs are damage effects, not coverage obligations.
- With no selected maintenance DoT, coverage is `null`/not applicable, rather
  than a fabricated 100%. A target is covered during the interval leading into
  its final expiration tick if the DoT is still active across that interval.

## Validation and technical limits

The canonical format is intentionally bounded. These are safety and scheduling
limits, not claims about a balanced character build:

- Root version must be 1. One resource definition, 1–128 abilities, 0–16 talents
  per ability, 1–32 effects per effect array, 0–16 triggers per ability.
- Ability/talent/effect/resource IDs are lowercase slugs up to 64 characters.
  Reserved pollution identifiers are rejected as values as well as object keys.
  Names and short labels are limited to 100 characters; descriptions to 2,000.
- Durations/GCD/intervals are at least 1/60s and at most 3,600s; zero is allowed
  for instant duration and no cooldown. Channels have at most 4,096 ticks.
  Range/radius/jump range are bounded at 10,000 world units; chains have at most
  32 additional targets. Stored charges are integers from 1 to 10. Resource max
  is an integer from 1 to 100. Damage amount is bounded at 1,000,000 per effect;
  channel ramp coefficients at 100. Fractions and probabilities are 0–1.
- Buff modifiers are finite and strictly positive, without an arbitrary balance
  cap. The validator conservatively combines the strongest timing reductions
  from distinct buff IDs and rejects effective cast/GCD durations below one
  tick, plus combinations that overflow to non-finite timing. Alternative
  definitions of the same buff ID do not stack. Runtime also refuses an invalid
  effective timing rather than silently making a zero-GCD action. Combined
  resource-gain modifiers and resource-effect gains must also remain finite.
- A DoT interval cannot exceed duration. Costs must be feasible within the cap.
  Stored charges require a nonzero recharge. Cooldown and DoT references must
  resolve somewhere in the catalogue, including talent-defined DoTs.
- Unknown keys/types, missing fields, NaN/Infinity, functions, accessors, hidden
  or symbolic fields, custom prototypes, inherited data, pollution keys
  (`__proto__`, `constructor`, `prototype`), cycles and sparse arrays are
  rejected before merging. Input inspection has depth/node/array/key budgets.
  JSON definitions cannot smuggle scripts into a supported effect.
- Loadouts reject zero or more than five slots, duplicate/unknown abilities,
  multiple or unknown talent selections, and talents on unselected abilities.

## Data-only extension example

`docs/examples/new-spell.json` is a complete extra definition with one talent.
It adds a 1.25s Dusk Lance cast and a lower-damage talent that allows movement.
It reuses Veil Bolt's icon. No engine case or handler is needed.

```js
import {readFile} from 'node:fs/promises';
import {CATALOGUE, validateCatalogue} from './src/lib/catalogue.js';
import {RaidSim} from './src/lib/engine.js';

const definition = JSON.parse(await readFile('docs/examples/new-spell.json', 'utf8'));
const catalogue = structuredClone(CATALOGUE);
catalogue.abilities.push(definition);
const validation = validateCatalogue(catalogue);
if (!validation.valid) throw new Error(validation.errors.join('\n'));
const sim = new RaidSim({
  catalogue,
  loadout: {abilities: ['dusk-lance'], talents: {'dusk-lance': 'drifting-lance'}},
  mechanics: false,
});
sim.start();
sim.setMovement(1, 0);
sim.use('dusk-lance');
sim.advance(1.25);
// The target has taken 500 damage. Engine and handlers were not changed.
```

An extension combining existing activation, targeting, cost, effect and trigger
primitives belongs in data. A truly new mechanic needs a deliberately designed
and tested handler/schema extension, not a script embedded in the definition.
Unknown future schema versions are rejected rather than partially interpreted.

### Future Play/Create boundary

The same validated catalogue and loadout compiler can serve Play and a future
Create interface in one app. An editor should produce canonical definitions,
show validation errors, and pass only validated data into the simulation. A
future Workshop adapter can translate its draft IDs/prose to this contract
without making the simulation depend on editor view state.

Encounter content is a separate prospective data boundary: for example,
`validateEncounterData` / `compileEncounterData` could translate tutorial or
custom spawn/layout/hazard data into a deterministic schedule consumed by an
encounter runner. Those are proposed adapter hooks, not implemented APIs.
They should not add encounter scripts to ability definitions or force the user
into separate apps. Five tutorials and a full custom builder remain future
product direction; this implementation establishes the reusable spell contract.

## Verification

`node --test tests/catalogue.test.mjs` covers all eight bases plus all 24 talent
compositions, immutable source data, merge semantics, loadouts, cross-references,
invalid numbers/timers, modifier combinations, malformed/prototype-polluted
input and the JSON extension example. Combat and UI suites separately exercise
effect timing, interaction and presentation; structural validation alone does
not demonstrate combat correctness or real-browser layout.
