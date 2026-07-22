# Plan: unified voice model + sequencer frontend (rev 2)

Generalize the metronome from a single-track, one-accent-per-beat model into a
multi-voice model, then add a sequencer frontend that uses it (3 drum rows,
simultaneous hits). Classic behavior is **unchanged** from the user's
perspective: strong / weak / off, same sounds. This lands as a single refactor —
no attempt to keep intermediate states green.

> **Rev 2 delta** — rev 1 (fixed universal voices `v1|v2|v3`, classic gains a
> "Third" tier) is already implemented in the working copy. Rev 2 changes:
> voices become pack-local sound names with a `strong`/`weak` contract; classic
> drops the third tier and reverts to strong/weak/off; `default` pack's extra
> mid click is dropped; migrations simplify (`strong → ["strong"]`,
> beatFillMethod values unchanged); sequencer grid keys become
> `kick`/`snare`/`hihat`. Nothing has shipped, so no v1/v2/v3 compat is needed.

## Locked decisions

- **Unify `Beat`** into `{ voices: string[]; duration }` (replaces
  `{ strength, duration }`). `off` is `voices: []`.
- **Voices are pack-local sound names, not universal slots.** A `SoundPack` is
  an arbitrary `Record<string, Sound>`; each pack names its own sounds
  (`kick`, `snare`, `hihat`, …). No fixed arity.
- **Universal contract: every pack provides `strong` and `weak`**, usually as
  aliases of its own sounds (drums: `strong` = the kick `Sound`, `weak` = the
  snare `Sound` — same instances, no duplicate buffers). This is what keeps
  every pack usable in every accent-based frontend. The mapping lives **in the
  pack**, not as per-frontend `(pack, role) → Sound` tables — a per-frontend
  table is an M×N maintenance surface where every new pack edits every accent
  frontend; alias-in-pack is one line per pack and classic just reads
  `pack["strong"]`.
- **Classic stays 3-tier** strong / weak / off. Beats store `["strong"]` /
  `["weak"]` / `[]`. The rev-1 "Third" accent tier is removed, not renamed.
- **Extra pack sounds are invisible to accent frontends.** Adding a sound to a
  pack extends only the frontends that look for it by name; classic / simple /
  skipmeasure read only `strong`/`weak`.
- **Sequencer rows are a sequencer-local track list** (`kick`/`snare`/`hihat`),
  not core metadata. If the sequencer someday supports multiple packs, promote
  the row list to per-pack `tracks` metadata; until then YAGNI.
- **No per-hit gain.** Volume stays a single master `GainNode`; per-hit
  velocity can be added later as a local change to `scheduleBeat`.
- **Drum sounds are synthesized** (no sample assets).

## Core model

```ts
// core/types.ts
export type Voice = string; // a sound name resolved against the current pack
export type Beat = { voices: Voice[]; duration: number };
export type Measure = Beat[];
export type Measures = Measure[];
export type BeatFillMethod = "strong" | "weak" | "off" | "copyEnd";
```

- `BeatStrength` is **removed** — this is the ripple source for every consumer.
- A rhythm that names a sound the current pack lacks plays those hits
  **silently** (`scheduleBeat` skips unknown names — same graceful path as a
  still-loading sample). Deliberate: cross-pack rhythms degrade instead of
  crash, and accent rhythms never hit this because `strong`/`weak` are
  universal.
- Classic is a single-voice UI (`voices.length <= 1`); the sequencer allows
  many voices per beat. Same `Beat` type, different UI constraints.
- The flat beat index (engine's existing beat-hit notifier) doubles as the
  sequencer playhead — no new engine plumbing for the column highlight.

## Migration

Old persisted data and old shared URLs use `{ strength, duration }` and must
keep working. One shared, **idempotent** conversion in core (`core/migrate.ts`):

- `migrateBeat`: if `"voices" in beat`, return as-is; else map `off → []`,
  `strong → ["strong"]`, `weak → ["weak"]`. Idempotency matters because
  migrators run on every read, not once.
- **`beatFillMethod` needs no value mapping** — old persisted `"strong"` /
  `"weak"` / `"off"` / `"copyEnd"` are already valid `BeatFillMethod` values;
  just validate against the enum.
- **No changes to `usePersistentState`** — migrate at point of use. Call sites:
  - `classic/beats` — `useMemo(() => migrateMeasures(rawBeats), [rawBeats])`.
  - Old `#rhythm-…` share links — normalize inside `deserializeRhythm`.
  - **`userPresets`** (`classic/components/presetmodal.tsx`) — full `Rhythm`s
    in the old shape; migrate on read.

## Sound engine (`core/soundpacks.ts`)

- `type SoundPack = { strong: Sound; weak: Sound } & Record<string, Sound>`.
- `soundPackStatus(pack)` aggregates over `Object.values(pack)` (aliases share
  `Sound` instances; visiting one twice is harmless — `load` is idempotent).
- **Drum synthesis: three bespoke loaders, not a generalized helper**
  (`makeKick` with phase-accumulated pitch drop, `makeSnare` noise + ~200 Hz
  tone, `makeHihat` short high noise burst; shared exp-decay helper).
  `makeFreqSampleFn` stays untouched as the click-pack helper.
- Packs:
  - `default`: `{ strong, weak }` — the two existing clicks. The rev-1 mid
    "third" click is dropped (nothing uses it; warming it builds dead buffers).
  - `inverted`: `{ strong: default.weak, weak: default.strong }`.
  - `dirac`: `{ strong, weak }` impulse pair.
  - `doumbek`: `{ strong: hi.wav, weak: low.wav }`.
  - `drums` (new): `{ kick, snare, hihat, strong: kick, weak: snare }`.

## Engine (`core/engine.ts`)

- `MetronomeSpec.beats` keeps its name, new shape.
- `scheduleBeat(beat, time)`: loop `beat.voices`; `pack[name]` missing or not
  loaded → skip; else buffer source → master gain → `start(time)`. Source
  tracking / `onended` cleanup unchanged (just more sources per beat).
- `_warmSoundPackCache` warms every `Sound` in the current pack
  (`Object.values`; packs are small, aliases dedupe via instance identity).
- Beat-index notifier, look-ahead scheduler, `multiIndex`/`multiLength`
  unchanged.

## Update existing consumers (mechanical, driven by the type change)

- `classic/page.tsx`: `toBeat("strong")` / `toBeat("weak")`; behavior identical
  to main — cycle strong→weak→off, no third tier.
- `classic/components/`: `measurecomponent` (strong/weak colors + aria labels
  as on main), `beatmodmenu` / `beatAccentChangeDirection` (strong→weak→off
  cycle), `measureinputsection`, `measuressection`, `presetmodal` (migrate on
  read), `settings.tsx` fill-method menu: Strong / Weak / Off / Copy End — no
  Third item.
- `core/smarttap/`: only the final `Beat[]` construction in `methodone.ts`
  changes (`,`/`.` keys → `["strong"]`/`["weak"]`). `BeatClick.strength` is tap
  *intensity* input — a different concept — so scorer internals stay as-is.
- `core/presetstore.ts` (strong/weak/off helpers → voices form).
- `metronome/simple/page.tsx`, `metronome/skipmeasure/page.tsx` (const updates).

## New sequencer frontend (net-new, no risk to others)

- `src/metronome/sequencer/{page.tsx, sequencer.module.css}`
  (`dynamic(..., { ssr: false })`), `src/app/sequencer/page.tsx` route,
  registered in `src/metronome/frontends.ts`.
- Local track list: `TRACKS = [{voice: "kick", label: "Kick"}, …]` — rows come
  from here, so adding a row = one entry here + one sound in the `drums` pack.
- Grid UI: 3 rows × steps; toggle multiple cells per column; playhead from the
  beat index; BPM + play/stop; pinned to the `drums` pack; persistent keys
  prefixed `sequencer/`.
- **State is the grid itself**, not `Measures`: persist
  `Record<string, boolean[]>` keyed by track voice names under
  `sequencer/grid`; derive `Measures` in the spec memo (a column's true rows
  become that beat's `voices`, duration 1).

## Risk summary

- **Highest risk:** the migrations. Old localStorage (beats, user presets,
  beatFillMethod) and old shared URLs must keep working — worth a manual test
  of each.
- **Rev 2 rework:** mostly renames from rev 1 (`v1/v2` → `strong/weak`), plus
  removing classic's third tier and `default`'s mid click.
- **Zero risk:** `simple` (trivial), sequencer (additive).
- **Untouched:** `src/hooks.ts`, `makeFreqSampleFn`, `util.ts`, `emitter.ts`,
  `tempo.ts`, `shared/usemetronome.ts`, `shared/snackbar.tsx`, smarttap scorer
  internals.
