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
//
// The steps themselves live in grid.ts, shared with methodthree. What's here is
// the part that is this method's own: which candidate grids to try, and how to
// choose between them.

import type { RhythmInferenceMethod } from ".";
import {
  buildBeats,
  findCycleLength,
  fitUniformGrid,
  refinePositions,
  toOccupancy,
  type GridFit,
} from "./grid";
import { tapStrengthToVoices } from "./tapvoices";

// One gap is enough to name a tempo, which is worth reporting even though it
// says nothing about structure — the UI re-infers on every tap, and going quiet
// for the first few would just look broken.
const MIN_TAPS = 2;
// Candidate cells come from dividing observed gaps by small integers. Some gap
// in a performance is almost always a short one, and the true cell divides it.
const MAX_GAP_SUBDIVISION = 6;
// Mild pressure toward coarser grids, to settle ties the residuals can't see.
// A fraction of the misfit charged per grid cell per tap — see gridCost.
const COMPLEXITY_WEIGHT = 0.05;
// Misfit nobody can beat, as a fraction of a cell. Keeps the complexity term
// discriminating when the taps sit perfectly on the grid and misfit is zero,
// which would otherwise leave every candidate costing nothing.
const MISFIT_FLOOR = 0.001;

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
