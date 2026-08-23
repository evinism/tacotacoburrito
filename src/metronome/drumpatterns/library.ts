// Type-only, so this stays erased at runtime and doesn't cycle with
// patterns.tsx (which imports LIBRARY_PATTERNS as a value).
import type { PatternState } from "./patterns";

import libraryJson from "./library.json";

export interface LibraryPattern extends PatternState {
  // Doubles as the React key, so keep these unique.
  name: string;
  // Freeform annotation — song titles, what this variant does differently.
  // Not pattern state, so it stays off PatternState and never round-trips
  // through load/save; the UI shows it read-only alongside the family's notes.
  notes?: string;
}

// The on-disk shape of library.json. Rows are step strings ("x" = hit, any
// other char = rest) rather than boolean arrays: the file is meant to be read
// and hand-edited in a diff, and a 7x18 boolean matrix per pattern is not.
// Rows with no hits are omitted and filled in as empty below.
interface LibraryJsonPattern {
  name: string;
  notes?: string;
  bpm: number;
  steps: number;
  bars: Record<string, string>[];
}

interface LibraryJson {
  // Keyed by family name — the pattern name with its trailing variant number
  // stripped. Holds what's true of the whole rhythm (its grouping, the songs
  // it's played for) rather than of one variant.
  familyNotes: Record<string, string>;
  patterns: LibraryJsonPattern[];
}

const expandRow = (row: string | undefined, steps: number): boolean[] =>
  Array.from({ length: steps }, (_, index) => row?.[index] === "x");

/*
  Built-in, read-only patterns shipped with the app, loaded from library.json.
  To add to this list: build patterns in the app, save them under your own
  patterns, then run this in the browser devtools console and convert the
  output into library.json's row-string form.

    copy(JSON.stringify(
      JSON.parse(localStorage.getItem("persistentState/drumpatterns/patternGroups"))
        .flatMap(({ name, variants }) =>
          variants.map(({ bpm, steps, bars }, i) => ({
            name: variants.length > 1 ? `${name} ${i + 1}` : name,
            bpm, steps, bars,
          }))),
      null, 2))

  Variants become separate entries with a trailing number, which is how the UI
  regroups them into a family. The id/createdAt/updatedAt fields are
  personal-store bookkeeping and are dropped on purpose — library entries have
  no identity beyond their name.
*/
export const LIBRARY_PATTERNS: LibraryPattern[] = (
  libraryJson as LibraryJson
).patterns.map(({ name, notes, bpm, steps, bars }) => ({
  name,
  notes,
  bpm,
  steps,
  bars: bars.map((bar) =>
    Object.fromEntries(
      Object.keys(bar).map((voice) => [voice, expandRow(bar[voice], steps)])
    )
  ),
}));

export const LIBRARY_FAMILY_NOTES: Record<string, string> = (
  libraryJson as LibraryJson
).familyNotes;
