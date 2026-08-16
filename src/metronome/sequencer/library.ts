// Type-only, so this stays erased at runtime and doesn't cycle with
// patterns.tsx (which imports LIBRARY_PATTERNS as a value).
import type { PatternState } from "./patterns";

import libraryJson from "./library.json";

export interface LibraryPattern extends PatternState {
  // Doubles as the React key, so keep these unique.
  name: string;
}

// The on-disk shape of library.json. Rows are step strings ("x" = hit, any
// other char = rest) rather than boolean arrays: the file is meant to be read
// and hand-edited in a diff, and a 7x18 boolean matrix per pattern is not.
// Rows with no hits are omitted and filled in as empty below.
interface LibraryJsonPattern {
  name: string;
  bpm: number;
  steps: number;
  showEighths: boolean;
  bars: Record<string, string>[];
}

const expandRow = (row: string | undefined, steps: number): boolean[] =>
  Array.from({ length: steps }, (_, index) => row?.[index] === "x");

/*
  Built-in, read-only patterns shipped with the app, loaded from library.json.
  To add to this list: build patterns in the sequencer, save them to your own
  "Saved Patterns", then run this in the browser devtools console and convert
  the output into library.json's row-string form.

    copy(JSON.stringify(
      JSON.parse(localStorage.getItem("persistentState/sequencer/patterns"))
        .map(({ name, bpm, steps, showEighths, bars, grid }) =>
          ({ name, bpm, steps, showEighths, bars: bars ?? [grid] })),
      null, 2))

  The id/createdAt/updatedAt fields are personal-store bookkeeping and are
  dropped on purpose — library entries have no identity beyond their name.
  `grid` is the pre-bars single-bar shape; keep it in the dump so older saves
  don't come out empty.
*/
export const LIBRARY_PATTERNS: LibraryPattern[] = (
  libraryJson as LibraryJsonPattern[]
).map(({ name, bpm, steps, showEighths, bars }) => ({
  name,
  bpm,
  steps,
  showEighths,
  bars: bars.map((bar) =>
    Object.fromEntries(
      Object.keys(bar).map((voice) => [voice, expandRow(bar[voice], steps)])
    )
  ),
}));
