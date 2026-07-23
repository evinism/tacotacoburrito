// A sound name resolved against the current pack (see soundpacks.ts) — not a
// fixed universal slot.
export type Voice = string;

export type Beat = {
  voices: Voice[];
  duration: number; // Normally 1.0
};

export type Measure = Beat[];
export type Measures = Measure[];
export type BeatFillMethod = "strong" | "weak" | "off" | "copyEnd";
