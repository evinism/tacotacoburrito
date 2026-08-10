// Third method for inferring rhythm from taps.
//
// methodtwo picks the grid *blind*. It scores each candidate cell purely on how
// tightly the taps sit on it, chooses a winner, and only then reads a cycle off
// the winner. So the question it asks — "do these taps land on whole numbers of
// this cell?" — never mentions the rhythm, and a wrong grid gets to answer it
// almost as well as the right one. Its characteristic failure is an n/(n±1)
// misreading: a tapped `X..xX.x.` comes back as `X...xX.x.` on a cell 8/9 as
// long, with a *lower* residual than the truth.
//
// It has to come out that way. Judging a grid by residuals alone rewards
// whichever grid has more cells to hide error in, and the local regression that
// makes methodtwo drift-tolerant makes this worse: it happily absorbs a wrong
// grid's error as if it were a wandering tempo. Widening the window doesn't
// help — that just breaks the drift tracking it was there for.
//
// The way out is not a better residual but a different question, and the cycle
// is what makes it askable. Once you know the taps repeat every L cells you can
// sort each tap's residual into its *residue class* — which beat of the rhythm
// it belongs to — and split the error in two:
//
//   * the spread *within* a class, which is the tapper's jitter, unstructured
//     and different every repeat;
//   * the offset *between* classes, which is a beat that consistently lands
//     early or late — the signature of a grid that puts that beat in the wrong
//     cell.
//
// Drift can't masquerade as the second one: drift is smooth in time and the
// local lines eat it, while a misplaced beat is periodic in the cycle and
// survives folding. A wrong grid therefore has a residual made of bias where a
// right one has a residual made of jitter, and that ratio separates them where
// the raw size of the residual does not. methodthree scores every candidate on
// it, which means it needs the cycle *before* it chooses the grid rather than
// after.
//
// Two smaller differences come along with it. The ratio subsumes methodtwo's
// complexity penalty, because the degenerate fine grid it was there to block —
// one where every tap gets its own residue and the pattern is memorised rather
// than found — has no within-class spread at all and so scores infinitely bad
// on its own terms. And the candidate cells are drawn from a wider net: the
// differences between distinct gap lengths, not just their divisions. That is
// the other half of the noisy-gcd being solved here, and it reaches the true
// cell of rhythms whose shortest gap is more than MAX_GAP_SUBDIVISION cells
// wide — sparse ones, which methodtwo could not read at any tempo.
//
// The one thing it gives up is the two-repeat case. Splitting a class's error
// into bias and jitter needs several taps in the class to split, and a pattern
// played only twice gives it two — enough to be worse than methodtwo by a point
// or so in the middle of the jitter range. Three repeats is already enough to
// turn that around, and the bench measures four by default because that is
// nearer what someone using the Tap Rhythm button actually does.

import { sum } from "@/metronome/core/util";
import type { RhythmInferenceMethod, TapStrength } from ".";
import type { Beat } from "@/metronome/core/types";
import {
  buildBeats,
  findCycleLength,
  fitUniformGrid,
  fittedPositions,
  meanCellMs,
  settlePositions,
  toOccupancy,
  MAX_CELLS_PER_GAP,
  type GridFit,
} from "./grid";
import { tapStrengthToVoices } from "./tapvoices";

// One gap is enough to name a tempo, which is worth reporting even though it
// says nothing about structure — the UI re-infers on every tap, and going quiet
// for the first few would just look broken.
const MIN_TAPS = 2;
// Candidate cells come from dividing observed gaps by small integers.
const MAX_GAP_SUBDIVISION = 6;
// ...and from the differences between distinct gap lengths, divided by smaller
// ones still. A difference is already one multiple of the cell subtracted from
// another, so it starts within a few cells of the cell itself and needs far
// less dividing to get there.
const MAX_DIFFERENCE_SUBDIVISION = 4;
// How close two gaps must be, in relative terms, to count as the same gap
// length. Deliberately loose: the point is to collapse "the 5-cell gaps" into
// one number *before* differencing, and a tight tolerance would leave jittered
// copies of one gap differencing against each other into noise.
const GAP_CLUSTER_TOLERANCE = 0.18;
// Residual nobody can beat, as a fraction of a cell. Keeps the ratio finite
// when taps sit perfectly on the grid and both halves of the error are zero.
const RESIDUAL_FLOOR = 0.003;
// How hard the bias/jitter ratio is leaned on, as an exponent. Measured flat
// over 0.5..1.25 — this is not a knife-edge, and the effect it is picking up is
// much larger than the tuning of it.
const BIAS_EXPONENT = 0.75;

// A grid, the rhythm it implies, and the two halves of what it fails to explain.
type Reading = {
  beats: Beat[];
  cellMs: number;
  // Rms of the whole residual, as a fraction of a cell.
  residual: number;
  // The part of it that is *not* periodic in the cycle: the tapper's jitter.
  jitter: number;
};

// Lower is better.
//
// The first factor is methodtwo's question — how big is the error. The second
// is methodthree's — how much of it is a beat sitting consistently in the wrong
// cell rather than a hand that isn't perfectly steady. A reading whose error is
// pure jitter pays nothing for the second factor; one whose error is all bias
// pays through the nose.
//
// This also disposes of the pathological fine grid, with no complexity term
// needed. Such a grid puts every tap in a residue of its own, so there is no
// within-class spread to compare against, the ratio runs away, and the reading
// prices itself out — which is the honest verdict: a rhythm seen once has not
// been found, only written down.
const readingCost = (reading: Reading): number => {
  const total = reading.residual ** 2 + RESIDUAL_FLOOR ** 2;
  const unstructured = reading.jitter ** 2 + RESIDUAL_FLOOR ** 2;
  return total * (total / unstructured) ** BIAS_EXPONENT;
};

// The distinct gap lengths in a performance, as cluster means. However many
// taps there are, a rhythm has only a handful — which is what makes
// differencing them cheap enough to be worth doing.
const gapLengths = (gaps: number[]): number[] => {
  const sorted = [...gaps].sort((a, b) => a - b);
  const lengths: number[] = [];
  let start = 0;
  for (let i = 1; i <= sorted.length; i++) {
    if (
      i === sorted.length ||
      sorted[i] > sorted[start] * (1 + GAP_CLUSTER_TOLERANCE)
    ) {
      lengths.push(sum(sorted.slice(start, i)) / (i - start));
      start = i;
    }
  }
  return lengths;
};

const candidateCells = (gaps: number[]): number[] => {
  const seeds = new Set<number>();
  for (const gap of gaps) {
    for (let divisor = 1; divisor <= MAX_GAP_SUBDIVISION; divisor++) {
      seeds.add(gap / divisor);
    }
  }

  // Below this the shortest gap comes out wider than fitUniformGrid accepts, so
  // the candidate would be discarded anyway.
  const floor = Math.min(...gaps) / MAX_CELLS_PER_GAP;
  const lengths = gapLengths(gaps);
  for (let a = 0; a < lengths.length; a++) {
    for (let b = a + 1; b < lengths.length; b++) {
      const difference = lengths[b] - lengths[a];
      for (let divisor = 1; divisor <= MAX_DIFFERENCE_SUBDIVISION; divisor++) {
        if (difference / divisor >= floor) seeds.add(difference / divisor);
      }
    }
  }

  return [...seeds];
};

// A settled grid, with the residual that scoring starts from already measured.
// Held separately from the Reading because finding the cycle is much the most
// expensive step and most candidates never earn it — see the bound below.
type Settled = {
  positions: number[];
  residuals: number[];
  // Rms residual as a fraction of a cell. Also a *lower bound* on this
  // candidate's final cost, since the bias factor can only make it worse.
  residual: number;
};

const settle = (times: number[], seeded: GridFit): Settled | undefined => {
  const positions = settlePositions(times, seeded.positions);
  if (positions[positions.length - 1] < 2) return undefined;
  const fitted = fittedPositions(times, positions);
  const residuals = fitted.map((wanted, i) => wanted - positions[i]);
  return {
    positions,
    residuals,
    residual: Math.sqrt(sum(residuals.map((r) => r * r)) / residuals.length),
  };
};

// The part of a grid's error that isn't periodic in the cycle.
//
// Each residual is already measured against a line fitted through the tap's
// neighbours, so a wandering tempo is gone by this point; what's left is jitter
// plus whatever the grid gets systematically wrong. Averaging the residuals of
// every tap that lands on the same beat of the cycle isolates the second, since
// jitter is independent across repeats and averages away while a misplaced beat
// is the same error every time and doesn't. Subtract it back off and what
// remains is the tapper's own unsteadiness.
const unstructuredResidual = (
  { positions, residuals }: Settled,
  cycleLength: number,
): number => {
  const classTotal = new Float64Array(cycleLength);
  const classCount = new Float64Array(cycleLength);
  for (let i = 0; i < positions.length; i++) {
    const residue = positions[i] % cycleLength;
    classTotal[residue] += residuals[i];
    classCount[residue]++;
  }

  let unstructured = 0;
  for (let i = 0; i < positions.length; i++) {
    const residue = positions[i] % cycleLength;
    unstructured += (residuals[i] - classTotal[residue] / classCount[residue]) ** 2;
  }
  return Math.sqrt(unstructured / positions.length);
};

// Everything a candidate grid has to say: the rhythm it reads the taps as, and
// how well that rhythm accounts for where they actually fell.
const readGrid = (
  times: number[],
  strengths: TapStrength[],
  settled: Settled,
): Reading | undefined => {
  const { positions } = settled;
  const span = positions[positions.length - 1];

  const occupancy = toOccupancy(positions, strengths);
  const cycleLength = findCycleLength(occupancy, span, times.length);
  if (cycleLength === undefined) return undefined;

  const beats = buildBeats(occupancy, span, cycleLength);
  if (beats.every((beat) => beat.voices.length === 0)) return undefined;

  return {
    beats,
    cellMs: meanCellMs(times, positions),
    residual: settled.residual,
    jitter: unstructuredResidual(settled, cycleLength),
  };
};

const inferRhythm: RhythmInferenceMethod = (clicks) => {
  if (clicks.length < MIN_TAPS) return undefined;

  // Copy before sorting: callers hand us their own tap history.
  const sorted = [...clicks].sort((a, b) => a.time - b.time);
  const times = sorted.map((click) => click.time);
  const strengths = sorted.map((click) => click.strength);

  const gaps: number[] = [];
  for (let i = 0; i < times.length - 1; i++) {
    gaps.push(times[i + 1] - times[i]);
  }
  if (gaps.some((gap) => !(gap > 0))) return undefined;

  // Every candidate is settled on the taps before it is judged. The seeds are
  // only starting points, and two of them often converge on the same grid; what
  // distinguishes them is how the taps finally sit.
  const candidates: Settled[] = [];
  const alreadyTried = new Set<number>();
  for (const seed of candidateCells(gaps)) {
    const seeded = fitUniformGrid(gaps, seed);
    if (!seeded) continue;
    const key = Math.round(seeded.cellMs * 1000);
    if (alreadyTried.has(key)) continue;
    alreadyTried.add(key);
    const settled = settle(times, seeded);
    if (settled) candidates.push(settled);
  }
  if (candidates.length === 0) return undefined;

  // Finding the cycle costs more than everything else here put together, and
  // most candidates don't deserve it. Because the bias factor is never less
  // than one, a candidate's plain residual is a floor on what it can possibly
  // cost — so once the residual alone exceeds the best complete cost so far, no
  // candidate further down the sorted list can win and the search is done. The
  // answer is exactly what scoring all of them would have given.
  candidates.sort((a, b) => a.residual - b.residual);

  let best: Reading | undefined;
  let bestCost = Infinity;
  for (const candidate of candidates) {
    if (candidate.residual ** 2 >= bestCost) break;
    const reading = readGrid(times, strengths, candidate);
    if (!reading) continue;
    const cost = readingCost(reading);
    if (cost < bestCost) {
      best = reading;
      bestCost = cost;
    }
  }

  if (!best) {
    // Nothing had a period in it — report the steady pulse the tightest grid
    // implies rather than going silent.
    return {
      value: {
        beats: [{ voices: tapStrengthToVoices(strengths[0]), duration: 1 }],
        tempo: 60000 / meanCellMs(times, candidates[0].positions),
      },
      confidence: 0,
    };
  }

  return {
    value: { beats: best.beats, tempo: 60000 / best.cellMs },
    // How cleanly the taps sat on the rhythm — the jitter half only, since the
    // bias half is a statement about the reading rather than about the tapper.
    confidence: Math.max(0, 1 - 2 * best.residual),
  };
};

export default inferRhythm;
