// Second method for inferring rhythm from taps.
//
// methodone works cycle-first: group the taps into repeating cycles, then guess
// how many grid cells that cycle subdivides into. This one inverts that order.
//
//   1. Recover the *grid cell* — the shortest unit of time the taps were played
//      against. Every gap between taps should be close to a whole number of
//      cells, which makes this a noisy-gcd problem rather than a search.
//   2. Snap each tap to an integer grid index, letting the cell duration drift
//      slowly so a wandering tempo still lands on whole numbers.
//   3. Read the cycle off as the shortest period of that integer sequence.
//
// Going this way round means the cycle length is *derived* rather than guessed,
// so there's no subdivision search to tune and no ceiling on how long a measure
// can be. It also makes tempo fall out as a measured quantity — the mean cell
// duration across the performance — rather than something reconstructed from a
// cycle count, which is what let methodone report a reduced pattern at the
// unreduced tempo.

import { sum } from "@/metronome/core/util";
import type { RhythmInferenceMethod, TapStrength } from ".";
import type { Beat } from "@/metronome/core/types";
import { tapStrengthToVoices } from "./tapvoices";

// One gap is enough to name a tempo, which is worth reporting even though it
// says nothing about structure — the UI re-infers on every tap, and going quiet
// for the first few would just look broken.
const MIN_TAPS = 2;
// Candidate cells come from dividing observed gaps by small integers. Some gap
// in a performance is almost always a short one, and the true cell divides it.
const MAX_GAP_SUBDIVISION = 6;
// A candidate implying a gap this many cells wide is far too fine to be real.
const MAX_CELLS_PER_GAP = 16;
const FIT_ITERATIONS = 6;
// Half-width, in taps, of the window used to track a drifting tempo. Wide
// enough to average out jitter, short enough to follow the wander.
const DRIFT_WINDOW = 4;
const DRIFT_ITERATIONS = 3;
// Mild pressure toward coarser grids, to settle ties the residuals can't see.
// A fraction of the misfit charged per grid cell per tap — see gridCost.
const COMPLEXITY_WEIGHT = 0.05;
// Misfit nobody can beat, as a fraction of a cell. Keeps the complexity term
// discriminating when the taps sit perfectly on the grid and misfit is zero,
// which would otherwise leave every candidate costing nothing.
const MISFIT_FLOOR = 0.001;
// Share of the onsets a candidate period must actually test against a repeat
// before its agreement is believable. Guards the long end of the search, where
// a period approaching the whole performance has almost nothing to contradict.
const MIN_COMPARISON_SHARE = 0.25;
// Float slop when comparing two agreement scores for equality.
const AGREEMENT_EPSILON = 1e-9;

type GridFit = {
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
const fitUniformGrid = (gaps: number[], seed: number): GridFit | undefined => {
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
const evaluateFit = (times: number[], positions: number[]): GridFit => {
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

// Lower is better. The squared misfit does the real work; the complexity term
// only breaks ties, since a fine enough grid can eventually drive the residual
// down by brute force.
//
// The term has to be *multiplicative* to stay a tie-breaker. Charging it as a
// flat addition sounds equivalent and isn't, because misfit² ranges over more
// than two orders of magnitude across the cases that matter: around 0.02 for a
// dense rhythm tapped at 15% jitter, but 0.0001 for a sparse one tapped
// cleanly. Any constant big enough to matter in the first case buries the
// second — a sparse pattern's true grid needs more cells per tap than the
// coarse misreading of it, so a flat penalty hands the win to whichever reading
// is coarser regardless of how much better the true one fits. That is what made
// a tapped `x......x....` come back as `x...x..`. As a fraction of the misfit,
// the charge is the same size relative to the evidence everywhere.
//
// Read it as: each additional grid cell per tap has to buy a COMPLEXITY_WEIGHT
// fraction off the misfit to pay for itself.
const gridCost = (fit: GridFit, tapCount: number): number =>
  (fit.misfit ** 2 + MISFIT_FLOOR ** 2) *
  (1 + COMPLEXITY_WEIGHT * (fit.positions[fit.positions.length - 1] / tapCount));

// Re-place every tap against a locally fitted line through its neighbours,
// rather than against its own predecessor.
//
// This is what keeps timing noise from compounding. The initial fit builds
// positions by rounding each gap and accumulating, so a single misrounded gap —
// near certain once jitter approaches a third of a cell — displaces every tap
// after it and destroys the cycle. Regressing position on time over a window
// re-anchors each tap to the integer consensus around it, so a bad gap costs one
// tap instead of the whole tail. The window doubles as the drift tracker: its
// slope is the local cell duration, so a wandering tempo is followed rather than
// averaged away.
const resnap = (times: number[], positions: number[]): number[] => {
  const snapped: number[] = [];

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
      snapped.push(positions[i]);
      continue;
    }
    const slope = (count * sumTP - sumT * sumP) / denominator;
    snapped.push(Math.round((sumP - slope * sumT) / count));
  }

  // Anchor at zero, and keep positions strictly increasing — two taps can't
  // occupy one grid cell, however close together the regression puts them.
  const anchored = snapped.map((position) => position - snapped[0]);
  for (let i = 1; i < anchored.length; i++) {
    anchored[i] = Math.max(anchored[i], anchored[i - 1] + 1);
  }
  return anchored;
};

// Settle the tap placements, then score them. Tempo comes out as a measurement
// rather than a reconstruction: total elapsed time over total cells traversed,
// which under drift is the performance's mean tempo — the only defensible
// single answer.
const refinePositions = (times: number[], fit: GridFit): GridFit => {
  let positions = fit.positions;
  for (let iteration = 0; iteration < DRIFT_ITERATIONS; iteration++) {
    const next = resnap(times, positions);
    const settled = next.every((position, i) => position === positions[i]);
    positions = next;
    if (settled) break;
  }
  return evaluateFit(times, positions);
};

// Occupancy holds tap intensity, not voices: it is built straight from the
// taps, and only becomes Beats at the very end.
type Occupancy = (TapStrength | undefined)[];

const toOccupancy = (positions: number[], strengths: TapStrength[]): Occupancy => {
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
const findCycleLength = (
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
const buildBeats = (
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

  const seeds = new Set<number>();
  for (const gap of gaps) {
    for (let divisor = 1; divisor <= MAX_GAP_SUBDIVISION; divisor++) {
      seeds.add(gap / divisor);
    }
  }

  // Every candidate is carried all the way through placement before being
  // scored. The seeds are only starting points, and two of them often converge
  // on the same grid; what distinguishes them is how the taps finally sit.
  let tracked: GridFit | undefined;
  let bestCost = Infinity;
  const settled = new Set<number>();
  for (const seed of seeds) {
    const seeded = fitUniformGrid(gaps, seed);
    if (!seeded) continue;
    // Skip candidates that collapsed onto a grid already evaluated.
    const key = Math.round(seeded.cellMs * 1000);
    if (settled.has(key)) continue;
    settled.add(key);

    const fit = refinePositions(times, seeded);
    const cost = gridCost(fit, times.length);
    if (cost < bestCost) {
      tracked = fit;
      bestCost = cost;
    }
  }
  if (!tracked) return undefined;

  const span = tracked.positions[tracked.positions.length - 1];
  if (span < 2) {
    // Too little to find a period in — report the steady pulse implied instead.
    return {
      value: {
        beats: [{ voices: tapStrengthToVoices(strengths[0]), duration: 1 }],
        tempo: 60000 / tracked.cellMs,
      },
      confidence: 0,
    };
  }

  const occupancy = toOccupancy(tracked.positions, strengths);
  const cycleLength = findCycleLength(occupancy, span, times.length);
  if (cycleLength === undefined) return undefined;

  const beats = buildBeats(occupancy, span, cycleLength);
  if (beats.every((beat) => beat.voices.length === 0)) return undefined;

  return {
    value: { beats, tempo: 60000 / tracked.cellMs },
    // Both factors are already 0..1-ish: how cleanly the taps sat on the grid,
    // and how well the cycle explained them.
    confidence: Math.max(0, 1 - 2 * tracked.misfit),
  };
};

export default inferRhythm;
