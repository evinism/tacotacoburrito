// Grading an inferred rhythm against the preimage its taps came from.
//
// "Is the beat array identical?" is the wrong question — methodone deliberately
// returns a *reduced* pattern, so [strong, off, weak, off] can legitimately come
// back as [strong, weak]. The question that matters to a user is whether the
// metronome would now play back what they tapped. So both sides get realized
// into what actually reaches the ear: a cycle period, and the onsets within it.

import type { Beat } from "@/metronome/core/types";
import type { Preimage } from "./synth";

// A beat's voices reduced to one comparable token, order-insensitive because
// ["strong","clap"] and ["clap","strong"] are the same sound. Grading works in
// voices rather than tap intensity so that it stays correct for patterns
// carrying voices the Tap Rhythm input can't express.
const voiceKey = (voices: Beat["voices"]): string =>
  [...voices].sort().join("+");

export type Onset = {
  // Position within the cycle, in [0, 1), with the first onset at 0.
  phase: number;
  // voiceKey of the beat sounding here.
  voices: string;
};

export type Realized = {
  periodMs: number;
  onsets: Onset[];
};

// Phases are computed from exact grids on both sides, so they either line up to
// float noise or they don't line up at all.
const PHASE_TOL = 1e-6;
// Tempo comes from averaging jittered intervals, so it lands *near* the target
// rather than on it. 2% is well inside "sounds right" and well outside the
// factor-of-2 and n/(n±1) errors we care about catching.
const TEMPO_TOL = 0.02;

export const realize = ({ beats, bpm }: Preimage): Realized => {
  const units = beats.reduce((acc, beat) => acc + beat.duration, 0);
  const periodMs = (units * 60000) / bpm;

  const raw: Onset[] = [];
  let unitsIn = 0;
  for (const beat of beats) {
    if (beat.voices.length > 0) {
      raw.push({ phase: unitsIn / units, voices: voiceKey(beat.voices) });
    }
    unitsIn += beat.duration;
  }

  // Anchor on the first onset. Taps carry no absolute phase, so a pattern that
  // leads with rests is the same performance shifted — not a different answer.
  const anchor = raw.length > 0 ? raw[0].phase : 0;
  return {
    periodMs,
    onsets: raw.map((onset) => ({ ...onset, phase: onset.phase - anchor })),
  };
};

// Circular distance between two phases, so 0.999 and 0.001 read as close.
const phaseDelta = (a: number, b: number): number => {
  const d = (((a - b) % 1) + 1) % 1;
  return Math.min(d, 1 - d);
};

// A cycle that contains k copies of itself is the same *sound* as one copy
// looped k times faster: [X,x,x,X,x,x] and [X,x,x] are one rhythm, and methodone
// collapses to the latter deliberately. Reducing both sides to their primitive
// period keeps that legitimate reduction from reading as a miss.
export const primitive = (realized: Realized): Realized => {
  const { onsets, periodMs } = realized;
  const n = onsets.length;
  for (let k = n; k > 1; k--) {
    if (n % k !== 0) continue;
    const perRepeat = n / k;
    const shift = 1 / k;
    const repeats = onsets.every((onset, i) => {
      const next = onsets[(i + perRepeat) % n];
      return (
        next.voices === onset.voices &&
        phaseDelta(next.phase, onset.phase + shift) < PHASE_TOL
      );
    });
    if (repeats) {
      return {
        periodMs: periodMs / k,
        // Phases within the first repeat span [0, 1/k); rescale to fill [0, 1).
        onsets: onsets
          .slice(0, perRepeat)
          .map((onset) => ({ ...onset, phase: onset.phase * k })),
      };
    }
  }
  return realized;
};

// Rotate so that onset k becomes the downbeat, preserving cyclic order.
const rotateTo = (onsets: Onset[], k: number): Onset[] => {
  const shift = onsets[k].phase;
  return onsets
    .map((onset) => ({
      ...onset,
      phase: ((onset.phase - shift) % 1 + 1) % 1,
    }))
    .sort((a, b) => a.phase - b.phase);
};

const phasesMatch = (a: Onset[], b: Onset[]): boolean =>
  a.length === b.length &&
  a.every((onset, i) => Math.abs(onset.phase - b[i].phase) < PHASE_TOL);

const strengthsMatch = (a: Onset[], b: Onset[]): boolean =>
  a.length === b.length && a.every((onset, i) => onset.voices === b[i].voices);

// The smallest rotation of `actual` whose phases match `expected`, or null.
const findRotation = (expected: Onset[], actual: Onset[]): number | null => {
  for (let k = 0; k < actual.length; k++) {
    if (phasesMatch(expected, rotateTo(actual, k))) return k;
  }
  return null;
};

export type Verdict =
  // Same onsets, same accents, same tempo: nothing to complain about.
  | "exact"
  // Right rhythm at the right tempo, but strong/weak landed differently.
  | "accents"
  // Right rhythm, but starting on the wrong onset — the pattern is turned around.
  | "rotated"
  // Right rhythm, wrong tempo. `tempoRatio` says by how much; 0.5 and 2 mean the
  // pattern reduced or doubled without the tempo following it.
  | "tempo"
  // A different rhythm altogether.
  | "wrong"
  // Inference declined to return anything.
  | "none";

export type Grade = {
  verdict: Verdict;
  // Inferred cycle length / intended cycle length. 1 is perfect.
  tempoRatio: number;
  tempoOk: boolean;
  patternOk: boolean;
  accentsOk: boolean;
  // How far the pattern had to be turned to match, when it only matched rotated.
  rotation: number | null;
};

const NO_RESULT: Grade = {
  verdict: "none",
  tempoRatio: NaN,
  tempoOk: false,
  patternOk: false,
  accentsOk: false,
  rotation: null,
};

export const gradeRhythm = (
  expected: Preimage,
  // What inference returned: its beat array plus the BPM it wants them played at.
  actual: { beats: Beat[]; tempo: number } | undefined,
): Grade => {
  if (actual === undefined || actual.beats.length === 0) {
    return NO_RESULT;
  }

  const want = primitive(realize(expected));
  const got = primitive(realize({ beats: actual.beats, bpm: actual.tempo }));

  const tempoRatio = got.periodMs / want.periodMs;
  // Compared in log space so being 2x fast and 2x slow count as equally wrong.
  const tempoOk = Math.abs(Math.log(tempoRatio)) < Math.log(1 + TEMPO_TOL);

  const patternOk = phasesMatch(want.onsets, got.onsets);
  const accentsOk = patternOk && strengthsMatch(want.onsets, got.onsets);
  const rotation = patternOk ? 0 : findRotation(want.onsets, got.onsets);
  const shapeOk = patternOk || rotation !== null;

  const verdict: Verdict = !shapeOk
    ? "wrong"
    : !tempoOk
      ? "tempo"
      : !patternOk
        ? "rotated"
        : accentsOk
          ? "exact"
          : "accents";

  return { verdict, tempoRatio, tempoOk, patternOk, accentsOk, rotation };
};
