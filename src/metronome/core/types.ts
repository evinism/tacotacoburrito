// A sound name resolved against the current pack (see soundpacks.ts) — not a
// fixed universal slot.
export type Voice = string;

export type Beat = {
  voices: Voice[];
  // Per-voice start offsets in seconds, index-aligned with `voices`; a missing
  // entry means 0 (on the beat). Enables flam-style doublets (e.g. darbuka tk)
  // without complicating the Voice type, which many modules treat as a string.
  offsets?: number[];
  duration: number; // Normally 1.0
};

export type Measure = Beat[];
export type Measures = Measure[];
export type BeatFillMethod = "strong" | "weak" | "off" | "copyEnd";
