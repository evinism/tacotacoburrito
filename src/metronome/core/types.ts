// A sound name resolved against the current pack (see soundpacks.ts) — not a
// fixed universal slot.
export type Voice = string;

// Seconds after the beat, or a [min, max] range the engine samples uniformly
// each time the beat is scheduled — so repeated flams don't land
// machine-identically.
export type VoiceOffset = number | [number, number];

export type Beat = {
  voices: Voice[];
  // Per-voice start offsets, index-aligned with `voices`; a missing entry
  // means 0 (on the beat). Enables flam-style doublets (e.g. darbuka tk)
  // without complicating the Voice type, which many modules treat as a string.
  offsets?: VoiceOffset[];
  duration: number; // Normally 1.0
};

export type Measure = Beat[];
export type Measures = Measure[];
export type BeatFillMethod = "strong" | "weak" | "off" | "copyEnd";
