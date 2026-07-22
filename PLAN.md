# Plan: unified voice model + sequencer frontend

Generalize the metronome from a single-track, one-accent-per-beat model into a
multi-voice model, then add a sequencer frontend that uses it (3 drum rows,
simultaneous hits). The classic page gains a third voice as part of the same
change. This lands as a single refactor — no attempt to keep intermediate
states green.

## Locked decisions

- **Unify `Beat`** into `{ voices: Voice[]; duration }` (replaces `{ strength, duration }`).
  Classic also gains a third voice.
- **Fixed 3 universal voices** `v1 | v2 | v3`. Every sound pack defines all three,
  so packs stay freely swappable across frontends. Frontends supply display labels.
- **No per-hit gain.** Volume stays a single master `GainNode`; sources connect
  to it directly, exactly like today. Per-hit velocity can be added later as a
  local change to `scheduleBeat` if a UI ever needs it.
- **Classic labels** the voices Strong / Weak / Third (accent tiers). The drum
  framing lives only in the sequencer.
- **Sequencer labels** them Kick / Snare / Hihat.
- **Drum sounds are synthesized** (no sample assets).

## Core model

```ts
// core/types.ts
export type Voice = "v1" | "v2" | "v3";
export const VOICES: Voice[] = ["v1", "v2", "v3"];
export type Beat = { voices: Voice[]; duration: number };
export type Measure = Beat[];
export type Measures = Measure[];
export type BeatFillMethod = Voice | "off" | "copyEnd";
```

- `off` is represented by `voices: []`.
- `BeatStrength` is **removed** — this is the ripple source for every consumer below.
- Classic is a single-voice UI (`voices.length <= 1`); the sequencer allows many
  voices per beat. Same `Beat` type, different UI constraints.
- The flat beat index (engine's existing beat-hit notifier) doubles as the
  sequencer playhead — no new engine plumbing needed for the column highlight.

## Migration

Old persisted data and old shared URLs use `{ strength, duration }` and must
keep working. One shared, **idempotent** conversion in core, used everywhere:

- Export `migrateBeat` / `migrateMeasures` / `migrateRhythm` from core (new
  `core/migrate.ts` or alongside types). `migrateBeat`: if `"voices" in beat`,
  return as-is; else map `off → []`, `strong → ["v1"]`, `weak → ["v2"]`.
  Idempotency matters because migrators run on every read, not once.
- **No changes to `usePersistentState`** — migrate at point of use; idempotent
  migrators make re-running on every read harmless. All four call sites:
  - `classic/beats` — `useMemo(() => migrateMeasures(rawBeats), [rawBeats])`
    over the raw persisted value in `classic/page.tsx`.
  - Old `#rhythm-…` share links — normalize inside `deserializeRhythm`
    (`classic/page.tsx`).
  - **`userPresets`** (`classic/components/presetmodal.tsx`) — persisted user
    presets are full `Rhythm`s in the old shape; migrate on read.
  - **`classic/beatFillMethod`** — stored values `"strong"`/`"weak"` map to
    `"v1"`/`"v2"` at point of use.

## Sound engine (`core/soundpacks.ts`)

- `SoundPack = Record<Voice, Sound>`; `soundPackStatus` iterates `VOICES`.
- **Drum synthesis: three bespoke loaders, not a generalized helper.**
  `makeFreqSampleFn` stays untouched as the click-pack helper — a kick's pitch
  drop is a frequency sweep over time, which its fixed-freq shape can't express
  without phase accumulation, so "extending" it would mean a mini-DSL with three
  consumers. Instead: `makeKick` (low sine, pitch drop via phase accumulation),
  `makeSnare` (noise + ~200 Hz tone), `makeHihat` (short high noise burst) —
  small buffer-fill functions, sharing an exp-decay helper if it falls out
  naturally. This is the only real R&D in the change.
- Add v3 to existing packs: `default` (v1 strong, v2 weak, v3 new mid click),
  `inverted` (aliases `default`'s Sounds — alias `default`'s v3), `dirac`,
  `doumbek` (reuse an existing sample for v3; only hi/low wavs exist).
- Add a new `drums` pack: v1 kick, v2 snare, v3 hihat.

## Engine (`core/engine.ts`)

- `MetronomeSpec.beats` keeps its name, new shape.
- Replace `scheduleClick(strength, time)` with `scheduleBeat(beat: Beat, time)`:
  loop `beat.voices`, each voice → buffer source → master gain → `start(time)`;
  empty voices = silent beat. Source tracking/`onended` cleanup unchanged (just
  more sources per beat).
- `handleScheduler` passes the whole beat; duration read from `nextBeat.duration`.
- `_warmSoundPackCache` loops `VOICES`. Beat-index notifier, look-ahead scheduler,
  and `multiIndex` / `multiLength` are unchanged.

## Update existing consumers (mechanical, driven by the type change)

- `classic/page.tsx`: `toBeat` / `strong` / `weak` / `defaultBeats` / `clear`;
  single-select among v1/v2/v3/off; migrate at point of use (see above).
- `classic/components/`: `measurecomponent` (voice colors + a third, aria label),
  `beatmodmenu` + `beatAccentChangeDirection` (cycle v1→v2→v3→off instead of
  strengths), `measureinputsection`, `measuressection`, `presetmodal` (migrate
  on read, see above).
- `core/smarttap/`: only the final `Beat[]` construction in `methodone.ts`
  changes to voices form (`,`/`.` keys → v1/v2). `BeatClick.strength` is tap
  *intensity* input — a different concept — so it and the scorer internals stay
  as-is.
- `core/presetstore.ts` (strong/weak/off helpers → voices form).
- `metronome/simple/page.tsx` (one-line const update).
- `metronome/skipmeasure/page.tsx` (strong/weak/off consts → voices form).

## New sequencer frontend (net-new, no risk to others)

- `src/metronome/sequencer/{page.tsx, sequencer.module.css, components/}`
  (`dynamic(..., { ssr: false })` like the others).
- `src/app/sequencer/page.tsx` route.
- Register in `src/metronome/frontends.ts`.
- Grid UI: 3 rows (kick/snare/hihat) × steps; toggle multiple cells per column;
  playhead from the beat index; BPM + play/stop; uses the `drums` pack;
  persistent keys prefixed `sequencer/`.
- **State is the grid itself**, not `Measures`: persist `Record<Voice, boolean[]>`
  under `sequencer/grid` and derive `Measures` in the spec memo (a column's true
  rows become that beat's `voices`, duration 1). Toggle = flip one boolean; the
  core model is only a projection at the engine boundary.

## Risk summary

- **Highest effort:** drum synthesis and the classic component rework — accent
  UI is threaded through several components.
- **Highest risk:** the migrations. Old localStorage (beats, user presets,
  beatFillMethod) and old shared URLs must keep working — worth a manual test
  of each.
- **Zero risk:** `simple` (trivial), sequencer (additive).
- **Untouched:** `src/hooks.ts`, `makeFreqSampleFn`, `util.ts`, `emitter.ts`,
  `tempo.ts`, `shared/usemetronome.ts`, `shared/snackbar.tsx`, smarttap scorer
  internals.
