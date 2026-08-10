// Fitting taps to an integer grid, and reading a rhythm off one.
//
// Both grid-based inference methods share this. What distinguishes them is
// which candidate grids they try and how they score what comes back — not how a
// grid gets fitted, how a cycle gets found, or how beats get voted on. Keeping
// that machinery in one place is what makes the two methods comparable: a
// difference in the bench is a difference in strategy, not in bookkeeping.

import { sum } from "@/metronome/core/util";
import type { TapStrength } from ".";
import type { Beat } from "@/metronome/core/types";
import { tapStrengthToVoices } from "./tapvoices";

// A candidate implying a gap this many cells wide is far too fine to be real.
export const MAX_CELLS_PER_GAP = 16;
const FIT_ITERATIONS = 6;
// Half-width, in taps, of the window used to track a drifting tempo. Wide
// enough to average out jitter, short enough to follow the wander.
const DRIFT_WINDOW = 4;
const DRIFT_ITERATIONS = 3;
// Share of the onsets a candidate period must actually test against a repeat
// before its agreement is believable. Guards the long end of the search, where
// a period approaching the whole performance has almost nothing to contradict.
const MIN_COMPARISON_SHARE = 0.25;
// Float slop when comparing two agreement scores for equality.
const AGREEMENT_EPSILON = 1e-9;

export type GridFit = {
  // Grid index of each tap. Always starts at 0.
  positions: number[];
  // Mean cell duration over the performance, in ms.
  cellMs: number;
  // Residual rms as a fraction of a cell. Scale-free on purpose: a finer grid
  // trivially has a smaller residual in ms, so only the fraction compares
  // fairly across candidates.
  misfit: number;
};

const toPositions = (multiples: number[]): number[] => {
  const positions = [0];
  for (const multiple of multiples) {
    positions.push(positions[positions.length - 1] + multiple);
  }
  return positions;
};

// Fit a single uniform cell duration to the gaps, starting from `seed`.
// Alternates between rounding each gap to a whole number of cells and
// least-squares refitting the cell to those whole numbers.
export const fitUniformGrid = (
  gaps: number[],
  seed: number,
): GridFit | undefined => {
  let cell = seed;
  let multiples: number[] = [];

  for (let iteration = 0; iteration < FIT_ITERATIONS; iteration++) {
    // A gap is at least one cell — two taps can't share a grid position.
    multiples = gaps.map((gap) => Math.max(1, Math.round(gap / cell)));
    const denominator = sum(multiples.map((m) => m * m));
    if (denominator === 0) return undefined;
    const refit = sum(gaps.map((gap, i) => gap * multiples[i])) / denominator;
    if (!(refit > 0)) return undefined;
    const converged = Math.abs(refit - cell) < 1e-9 * cell;
    cell = refit;
    if (converged) break;
  }

  if (multiples.some((multiple) => multiple > MAX_CELLS_PER_GAP)) return undefined;

  return { positions: toPositions(multiples), cellMs: cell, misfit: NaN };
};

// Regress time on grid position over a window around each tap, and report how
// far the taps sit from those local lines.
//
// Judging a candidate grid by its *per-gap* residuals is too weak: a cell a few
// percent short leaves every individual gap looking almost right, while the
// error silently accumulates into an absolute position that is wildly wrong. A
// local line has the lever arm to see that. Keeping it local rather than global
// is what makes the measure survive drift — a wandering tempo bends the line but
// doesn't scatter the taps around it.
export const evaluateFit = (times: number[], positions: number[]): GridFit => {
  const residuals: number[] = [];
  const cells: number[] = [];

  for (let i = 0; i < times.length; i++) {
    const lo = Math.max(0, i - DRIFT_WINDOW);
    const hi = Math.min(times.length - 1, i + DRIFT_WINDOW);

    let count = 0;
    let sumP = 0;
    let sumT = 0;
    let sumPP = 0;
    let sumPT = 0;
    for (let j = lo; j <= hi; j++) {
      const p = positions[j] - positions[i];
      const t = times[j] - times[i];
      count++;
      sumP += p;
      sumT += t;
      sumPP += p * p;
      sumPT += p * t;
    }

    const denominator = count * sumPP - sumP * sumP;
    if (denominator === 0) continue;
    // Slope is ms per grid cell: the local tempo.
    const cell = (count * sumPT - sumP * sumT) / denominator;
    if (!(cell > 0)) continue;
    // Centred on tap i, so its own fitted time is the intercept and its
    // residual is the negative of that.
    residuals.push((sumT - cell * sumP) / count);
    cells.push(cell);
  }

  const span = positions[positions.length - 1];
  const meanCell =
    span > 0
      ? (times[times.length - 1] - times[0]) / span
      : sum(cells) / Math.max(1, cells.length);

  return {
    positions,
    cellMs: meanCell,
    misfit:
      residuals.length === 0
        ? Infinity
        : Math.sqrt(sum(residuals.map((r) => r * r)) / residuals.length) / meanCell,
  };
};

// Where each tap *wants* to sit, as a real number, judged by a line fitted
// through its neighbours rather than by its own predecessor.
//
// This is what keeps timing noise from compounding. The initial fit builds
// positions by rounding each gap and accumulating, so a single misrounded gap —
// near certain once jitter approaches a third of a cell — displaces every tap
// after it and destroys the cycle. Regressing position on time over a window
// re-anchors each tap to the integer consensus around it, so a bad gap costs one
// tap instead of the whole tail. The window doubles as the drift tracker: its
// slope is the local cell duration, so a wandering tempo is followed rather than
// averaged away.
//
// Left unrounded so callers can decide what counts as a legal landing spot:
// any integer (resnap) or only the onsets of a hypothesised rhythm (methodthree).
export const fittedPositions = (
  times: number[],
  positions: number[],
): number[] => {
  const fitted: number[] = [];

  for (let i = 0; i < times.length; i++) {
    const lo = Math.max(0, i - DRIFT_WINDOW);
    const hi = Math.min(times.length - 1, i + DRIFT_WINDOW);

    // Times are absolute epoch milliseconds (~1.7e12). Regressing on them raw
    // squares to ~1e24, and the normal equations then subtract two such numbers
    // to recover a variance around 1e6 — which double precision cannot do.
    // Centering on this tap keeps every term small, and has the happy side
    // effect that the fitted position at t_i is just the intercept.
    let count = 0;
    let sumT = 0;
    let sumP = 0;
    let sumTT = 0;
    let sumTP = 0;
    for (let j = lo; j <= hi; j++) {
      const t = times[j] - times[i];
      count++;
      sumT += t;
      sumP += positions[j];
      sumTT += t * t;
      sumTP += t * positions[j];
    }

    const denominator = count * sumTT - sumT * sumT;
    if (denominator === 0) {
      fitted.push(positions[i]);
      continue;
    }
    const slope = (count * sumTP - sumT * sumP) / denominator;
    fitted.push((sumP - slope * sumT) / count);
  }

  return fitted;
};

// Anchor at zero, and keep positions strictly increasing — two taps can't
// occupy one grid cell, however close together the fit put them.
export const anchor = (placed: number[]): number[] => {
  const anchored = placed.map((position) => position - placed[0]);
  for (let i = 1; i < anchored.length; i++) {
    anchored[i] = Math.max(anchored[i], anchored[i - 1] + 1);
  }
  return anchored;
};

// Re-place every tap on the nearest grid cell, wherever the local fit puts it.
export const resnap = (times: number[], positions: number[]): number[] =>
  anchor(fittedPositions(times, positions).map((x) => Math.round(x)));

// Re-place the taps until they stop moving.
export const settlePositions = (
  times: number[],
  positions: number[],
): number[] => {
  let settledPositions = positions;
  for (let iteration = 0; iteration < DRIFT_ITERATIONS; iteration++) {
    const next = resnap(times, settledPositions);
    const settled = next.every((position, i) => position === settledPositions[i]);
    settledPositions = next;
    if (settled) break;
  }
  return settledPositions;
};

// Mean cell duration over the performance: total elapsed time over total cells
// traversed. Tempo comes out as a measurement rather than a reconstruction,
// which under drift is the performance's mean tempo — the only defensible
// single answer.
export const meanCellMs = (times: number[], positions: number[]): number =>
  (times[times.length - 1] - times[0]) / positions[positions.length - 1];

// Settle the tap placements, then score them.
export const refinePositions = (times: number[], fit: GridFit): GridFit =>
  evaluateFit(times, settlePositions(times, fit.positions));

// Occupancy holds tap intensity, not voices: it is built straight from the
// taps, and only becomes Beats at the very end.
export type Occupancy = (TapStrength | undefined)[];

export const toOccupancy = (
  positions: number[],
  strengths: TapStrength[],
): Occupancy => {
  const occupancy: Occupancy = Array(positions[positions.length - 1] + 1).fill(
    undefined,
  );
  positions.forEach((position, i) => {
    occupancy[position] = strengths[i];
  });
  return occupancy;
};

// The shortest period that explains the occupied grid positions. Comparing only
// positions where something happens is the important part: most cells in a
// sparse rhythm are empty, and counting rest-against-rest as agreement would
// make every candidate period look equally good.
//
// Periods are searched all the way out to the full span rather than to half of
// it. Half looks like the safe bound — you need two repeats to see a period —
// but the span ends at the last *onset*, not at the end of the last cycle. Play
// a pattern exactly twice and the span is one cycle plus a bit, so the true
// period sits just past span/2 and never gets considered. That's what used to
// force a stray extra tap to start the third repeat.
//
// Reaching further needs a guard, because a period near the full span is
// trivially self-consistent: it has almost nothing to check. Hence the evidence
// floor — a candidate has to actually put a decent share of the onsets to the
// test before its agreement counts for anything.
export const findCycleLength = (
  occupancy: Occupancy,
  span: number,
  onsetCount: number,
): number | undefined => {
  const minComparisons = Math.max(
    2,
    Math.ceil(MIN_COMPARISON_SHARE * onsetCount),
  );
  const agreements: (number | undefined)[] = [];
  let bestAgreement = -1;

  for (let length = 1; length <= span; length++) {
    let matched = 0;
    let compared = 0;
    for (let p = 0; p + length <= span; p++) {
      const here = occupancy[p];
      const there = occupancy[p + length];
      if (here === undefined && there === undefined) continue;
      compared++;
      if (here !== undefined && there !== undefined) {
        // An onset lining up with an onset is the structural claim; whether the
        // accents agree is softer, since people are inconsistent about them.
        matched += here === there ? 1 : 0.5;
      }
    }
    if (compared < minComparisons) {
      agreements.push(undefined);
      continue;
    }
    const agreement = matched / compared;
    agreements.push(agreement);
    bestAgreement = Math.max(bestAgreement, agreement);
  }

  if (bestAgreement < 0) return undefined;
  // Shortest period that explains the taps as well as any longer one does. A
  // longer period always fits at least as well — it has fewer repeats to be
  // consistent with — so without this the search would just run to the end.
  const winner = agreements.findIndex(
    (agreement) =>
      agreement !== undefined && agreement >= bestAgreement - AGREEMENT_EPSILON,
  );
  return winner === -1 ? undefined : winner + 1;
};

// Majority vote each residue across the repeats that were actually observed, so
// a single missed tap doesn't punch a hole in the pattern and a single stray one
// doesn't add a beat.
export const buildBeats = (
  occupancy: Occupancy,
  span: number,
  cycleLength: number,
): Beat[] => {
  const beats: Beat[] = [];
  for (let residue = 0; residue < cycleLength; residue++) {
    let strong = 0;
    let weak = 0;
    let rest = 0;
    for (let p = residue; p <= span; p += cycleLength) {
      const strength = occupancy[p];
      if (strength === "strong") strong++;
      else if (strength === "weak") weak++;
      else rest++;
    }
    const onsets = strong + weak;
    beats.push({
      voices: tapStrengthToVoices(
        onsets > rest ? (strong > weak ? "strong" : "weak") : "off",
      ),
      duration: 1,
    });
  }
  return beats;
};
