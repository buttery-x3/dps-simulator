# Product direction

## Core experience

VEILWEAVER stays a browser game: open a link, load quickly, and start practicing ranged DPS while dodging. Keep iteration lightweight and make moment-to-moment combat readable. A standalone repository changes how the source is maintained, not this browser-first goal.

## Implemented today

- A single endless practice arena with a permanent sentinel and timed stationary adds.
- Eight declarative abilities with three talents each, one-to-five ordered spell slots, and five optional talent points.
- Shared casting, channeling, target selection, periodic effects, buffs, resources, stored charges, triggers and non-recursive damage links.
- An orb-based loadout picker and clustered/spread stationary target layouts.
- Telegraphs for circle and lane ground impacts, plus damage-taken feedback.
- Session and rolling DPS, damage totals, target state, cooldowns, stored charges and dynamic resource readiness cues.
- Pooled maintenance-DoT coverage across every live target from its first tick, with no application grace period.
- Seeded deterministic simulation, pause/resume/stop, a session summary, and focus/visibility safety.
- Keyboard and pointer controls, basic touch controls, and in-game Help.
- A Svelte 5 interface with a framework-independent combat simulation, built to static files with no account or persistent storage requirement.

## Planned direction — not implemented

1. **Play/Create direction:** a possible shared app entry for practice and authoring; introductory encounters and tutorial progression remain future discussion.
2. **Encounter designer:** author repeatable mechanic timelines and arena layouts.
3. **Mechanic vocabulary:** add moving projectiles, rally/stack zones, and configurable AoE patterns. The current circle/lane telegraphs are a starting point, not a general authoring system.
4. **User-created encounter links:** serialize, validate, and share encounters so another player can open a link and play the same challenge.
5. **Leaderboards:** compare runs under clearly defined encounter and scoring rules.

These items describe direction rather than delivery commitments. This repository does not yet contain an editor, custom encounter format, share-link system, online leaderboard, or service backend.

## Decisions to make before those features

- Define a versioned encounter format and validation limits before building an editor or accepting user-authored content.
- Separate encounter rules from rendering so the deterministic simulation remains directly testable.
- Decide whether encounter links can be self-contained or need hosted storage.
- Define fair scoring and how to verify results before introducing competitive leaderboards. Current client-side session numbers are practice feedback, not tamper-proof competitive records.
- Add accounts or backend services only if a chosen sharing or ranking design actually needs them. Preserve immediate browser play for the core practice loop.

## Spell authoring contract

The versioned catalogue and compiler are implemented now; see [SPELL_SYSTEM.md](SPELL_SYSTEM.md). They can be reused by a future editor. The earlier Workshop draft is not the canonical runtime schema. No editor, campaign or migration of the Workshop is included in this pass.
