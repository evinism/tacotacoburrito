import type { PatternState } from "./patterns";

/*
  Share links are expected to be the main way drum patterns get kept —
  bookmarked, pasted into a notes app — rather than localStorage, so the wire
  shape is a stable, self-contained snapshot of everything the grid needs and
  nothing else (no ids, no timestamps, no notes, no sound pack: those are
  bookkeeping or per-user preference, not the rhythm).

  Rows are "x"/"." strings, the same hand-readable form library.json uses, and
  all-rest rows are dropped — a URL is a length-sensitive place to put a 7x16
  boolean matrix.
*/
interface SharedPattern {
  // Bumped only on an incompatible shape change; unknown versions are rejected
  // rather than guessed at, so a newer link never loads as a wrong rhythm.
  v: 1;
  bpm: number;
  steps: number;
  bars: Record<string, string>[];
}

export const SHARE_HASH_PREFIX = "pattern-";

const packRow = (row: boolean[]): string =>
  row.map((on) => (on ? "x" : ".")).join("");

const unpackRow = (row: string, steps: number): boolean[] =>
  Array.from({ length: steps }, (_, index) => row[index] === "x");

export const serializePattern = (pattern: PatternState): string => {
  const shared: SharedPattern = {
    v: 1,
    bpm: Math.round(pattern.bpm),
    steps: pattern.steps,
    bars: pattern.bars.map((bar) =>
      Object.fromEntries(
        Object.entries(bar)
          .filter(([, row]) => row.some(Boolean))
          .map(([voice, row]) => [voice, packRow(row)])
      )
    ),
  };
  return btoa(JSON.stringify(shared));
};

// Returns null for anything that isn't a link this build understands — a
// truncated paste, a hand-mangled hash, a future version.
export const deserializePattern = (base64: string): PatternState | null => {
  try {
    const shared = JSON.parse(atob(base64)) as SharedPattern;
    if (shared.v !== 1 || !Array.isArray(shared.bars)) return null;
    const steps = shared.steps;
    if (!Number.isFinite(shared.bpm) || !Number.isFinite(steps) || steps < 1) {
      return null;
    }
    return {
      bpm: shared.bpm,
      steps,
      // Rows the sender omitted are all-rest; the frontend's resizeGrid fills
      // in whatever rows are missing here.
      bars: shared.bars.map((bar) =>
        Object.fromEntries(
          Object.entries(bar).map(([voice, row]) => [
            voice,
            unpackRow(row, steps),
          ])
        )
      ),
    };
  } catch (error) {
    console.error("Failed to deserialize pattern:", error);
    return null;
  }
};
