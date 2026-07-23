// Type-only, so this stays erased at runtime and doesn't cycle with
// patterns.tsx (which imports LIBRARY_PATTERNS as a value).
import type { PatternState } from "./patterns";

export interface LibraryPattern extends PatternState {
  // Doubles as the React key, so keep these unique.
  name: string;
}

/*
  Built-in, read-only patterns shipped with the app. To add to this list:
  build patterns in the sequencer, save them to your own "Saved Patterns",
  then run this in the browser devtools console and paste the output below.

    copy(JSON.stringify(
      JSON.parse(localStorage.getItem("persistentState/sequencer/patterns"))
        .map(({ name, bpm, steps, showEighths, grid }) =>
          ({ name, bpm, steps, showEighths, grid })),
      null, 2))

  The id/createdAt/updatedAt fields are personal-store bookkeeping and are
  dropped on purpose — library entries have no identity beyond their name.
*/
export const LIBRARY_PATTERNS: LibraryPattern[] = [];
