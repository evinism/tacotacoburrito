// Synthetic tap generation, for evaluating rhythm inference offline.
//
// A *preimage* is the rhythm we pretend a human is tapping: one cycle of a beat
// grid (where "off" cells are slots nobody hits) plus the tempo of a single
// grid cell. generateTaps() plays that grid out over several cycles through a
// humanization model, producing exactly the BeatClick[] the Tap Rhythm button
// would have collected — so inference can be measured against a known answer.

import type { Rhythm } from "@/metronome/core/engine";
import type { Beat } from "@/metronome/core/types";
import { arrayFlatten } from "@/metronome/core/util";
import type { BeatClick, TapStrength } from ".";

// Beats carry pack-named voices; Tap Rhythm only ever records intensity. The
// core contract is that the "strong" voice reads as accented and anything else
// audible reads as weak — the inverse of tapStrengthToVoices in methodone.
const asTapStrength = (voices: Beat["voices"]): TapStrength =>
  voices.length === 0 ? "off" : voices.includes("strong") ? "strong" : "weak";

// The voices a synthetic tap of the given intensity should sound.
const asVoices = (strength: TapStrength): Beat["voices"] =>
  strength === "off" ? [] : [strength];

export type Preimage = {
  // One full cycle of the grid. Durations are in grid units, as elsewhere.
  beats: Beat[];
  // BPM of one duration-1 grid cell.
  bpm: number;
};

// A stored Rhythm's measures concatenate into a single cycle: the tapper just
// taps the whole thing around, with no audible seam at the measure boundary.
export const toPreimage = (rhythm: Rhythm): Preimage => ({
  beats: arrayFlatten(rhythm.beats),
  bpm: rhythm.bpm,
});

// Everything in the preset store is a real dance rhythm with real structure.
// People tap things that aren't, so a corpus of only presets flatters any
// inference that has learned their shape. These knobs describe the space of
// arbitrary patterns to draw from instead.
export type RandomPatternOptions = {
  minCells: number;
  maxCells: number;
  // Fraction of grid cells carrying a tap, drawn uniformly per pattern. The
  // floor keeps patterns from being mostly rests, which say very little. The
  // ceiling stops short of saturation deliberately: a tap in every cell leaves
  // nothing to infer about where the rests go, and the odd meters that are
  // actually hard sit near 0.45 (Kopanitsa 5/11, Leventikos 7/16).
  minDensity: number;
  maxDensity: number;
  // Grid-cell tempo, drawn log-uniformly. Spans roughly what the presets use.
  minBpm: number;
  maxBpm: number;
  // How often a non-downbeat onset comes out accented.
  strongRate: number;
};

export const DEFAULT_RANDOM_PATTERN: RandomPatternOptions = {
  minCells: 4,
  maxCells: 16,
  minDensity: 0.25,
  maxDensity: 0.9,
  minBpm: 90,
  maxBpm: 450,
  strongRate: 0.25,
};

export type Rng = () => number;

// mulberry32 — small, fast, and plenty for jitter. Seeded, so any interesting
// failure the bench turns up can be replayed exactly.
export const makeRng = (seed: number): Rng => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Box-Muller. Human timing error around an intended onset is close enough to
// normal for this purpose; the interesting question is the spread, not the tail.
export const gaussian = (rng: Rng): number => {
  const u = 1 - rng(); // in (0, 1], so log() is safe
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

// Draw an arbitrary rhythm: a grid of the given size, taps scattered through it
// at the drawn density, at a drawn tempo. Deterministic in `rng`, so a corpus
// of these is as reproducible as the preset one.
export const randomPreimage = (
  rng: Rng,
  options: RandomPatternOptions = DEFAULT_RANDOM_PATTERN,
): Preimage => {
  const { minCells, maxCells, minDensity, maxDensity } = options;
  const cells = minCells + Math.floor(rng() * (maxCells - minCells + 1));
  const density = minDensity + rng() * (maxDensity - minDensity);

  const beats: Beat[] = [];
  for (let i = 0; i < cells; i++) {
    // Cell 0 always carries a tap. A pattern that opens with rests is just a
    // rotation of one that doesn't — taps have no absolute phase to rest against.
    const onset = i === 0 || rng() < density;
    const strong = i === 0 || rng() < options.strongRate;
    beats.push({
      voices: asVoices(onset ? (strong ? "strong" : "weak") : "off"),
      duration: 1,
    });
  }

  // Two taps is the floor for inferring anything at all; a one-tap draw would
  // test nothing. Promote a rest rather than redrawing the whole pattern, which
  // keeps the draw finite and the result a fixed function of the seed.
  if (beats.filter((beat) => beat.voices.length > 0).length < 2) {
    const rests = beats
      .map((beat, i) => (beat.voices.length === 0 ? i : -1))
      .filter((i) => i >= 0);
    beats[rests[Math.floor(rng() * rests.length)]].voices = asVoices("weak");
  }

  return {
    beats,
    bpm: Math.round(
      options.minBpm * (options.maxBpm / options.minBpm) ** rng(),
    ),
  };
};

// The ways a real performance departs from the grid. All independent, all
// zero-able, so a run can isolate one axis at a time.
export type Humanization = {
  // Standard deviation of per-tap timing error, in ms. Absolute rather than
  // tempo-relative: a person's motor jitter doesn't shrink when the tempo does.
  jitterMs: number;
  // Standard deviation of the tempo random walk, as a fraction, applied once
  // per grid cell — not per tap. A tapper's internal clock keeps running
  // through rests, so keying the walk to taps would make a sparse pattern drift
  // more slowly in wall-clock time than a dense one.
  //
  // The walk compounds, so this is drift (the tempo wanders off) rather than
  // noise (which would scatter around the target). Because it accumulates as
  // sd*sqrt(cells), useful values are small: 0.002 over a 16-cell cycle wanders
  // by under 1% per repeat.
  driftPerBeat: number;
  // Probability that an intended tap simply doesn't land.
  missRate: number;
  // Probability that a tap is followed by a stray extra one before the next.
  ghostRate: number;
  // Probability that strong/weak comes out as the other one.
  strengthErrorRate: number;
};

// A metronomically perfect performance — the floor case. Anything inference
// gets wrong here is a flaw in the algorithm, not in the tapper.
export const PRECISE: Humanization = {
  jitterMs: 0,
  driftPerBeat: 0,
  missRate: 0,
  ghostRate: 0,
  strengthErrorRate: 0,
};

const flipStrength = (strength: TapStrength): TapStrength =>
  strength === "strong" ? "weak" : "strong";

export type Performance = {
  clicks: BeatClick[];
  // The tempo the performance was *actually* played at, in the same units as
  // Preimage.bpm: grid cells per minute, averaged over the span from first tap
  // to last. Without drift this is just the nominal bpm. With drift there is no
  // single true tempo, and this — not the bpm the tapper started from — is the
  // honest thing to grade an inferred tempo against.
  realizedBpm: number;
};

export const generateTaps = (
  preimage: Preimage,
  cycles: number,
  humanization: Humanization,
  rng: Rng,
): Performance => {
  const { beats, bpm } = preimage;
  const msPerUnit = 60000 / bpm;
  const clicks: BeatClick[] = [];

  // A single running clock rather than a per-cycle origin, so tempo can wander
  // continuously through the performance instead of stepping at cycle seams.
  // Inference only ever sees differences, but starting at a big nonzero epoch
  // (the UI hands it Date.now()) keeps us honest about any code that assumes
  // the first tap sits at t=0.
  let now = 1_700_000_000_000;
  // Compounding multiplier on the grid interval — the tapper's drifting tempo.
  let tempoScale = 1;

  // Position and intended time of the first and last taps, used to recover the
  // realized tempo. Tracked pre-jitter: the goal is the tempo the performance
  // was played at, not a noisy estimate of it.
  let unitsElapsed = 0;
  let firstTap: { time: number; units: number } | undefined;
  let lastTap: { time: number; units: number } | undefined;

  for (let cycle = 0; cycle < cycles; cycle++) {
    for (const beat of beats) {
      const intended = now;
      const intendedUnits = unitsElapsed;
      const cellMs = beat.duration * msPerUnit * tempoScale;
      now += cellMs;
      unitsElapsed += beat.duration;
      // Advance the walk every cell, rests included, and before the `off` check
      // so that the draw sequence doesn't depend on how dense the pattern is.
      tempoScale *= 1 + gaussian(rng) * humanization.driftPerBeat;

      const accent = asTapStrength(beat.voices);
      if (accent === "off") continue;
      if (rng() < humanization.missRate) continue;

      const strength =
        rng() < humanization.strengthErrorRate ? flipStrength(accent) : accent;
      clicks.push({
        strength,
        time: intended + gaussian(rng) * humanization.jitterMs,
      });
      firstTap ??= { time: intended, units: intendedUnits };
      lastTap = { time: intended, units: intendedUnits };

      if (rng() < humanization.ghostRate) {
        // A stray extra hit somewhere in the gap before the next grid cell.
        clicks.push({ strength: "weak", time: intended + rng() * cellMs });
      }
    }
  }

  const spanUnits = firstTap && lastTap ? lastTap.units - firstTap.units : 0;
  return {
    // Ghost taps and jitter can both reorder neighbours; the UI collects taps
    // in clock order, so hand them over that way.
    clicks: clicks.sort((a, b) => a.time - b.time),
    realizedBpm:
      firstTap && lastTap && spanUnits > 0
        ? (60000 * spanUnits) / (lastTap.time - firstTap.time)
        : bpm,
  };
};
