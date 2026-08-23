// A sound name resolved against the current pack (see soundpacks.ts) — not a
// fixed universal slot.
export type SoundName = string;

// Seconds after the beat, or a [min, max] range the engine samples uniformly
// each time the beat is scheduled — so repeated flams don't land
// machine-identically.
export type VoiceOffset = number | [number, number];

/*
  One sounded hit within a beat: which sound to play, plus how this hit
  differs from a plain one. Everything past `sound` is optional and defaulted
  by the engine, so `{ sound }` stays the ordinary case — and the next per-hit
  knob (gain, playback rate) is one optional field here plus its use in
  Metronome.scheduleBeat, with no existing call site to revisit. That's the
  reason offsets live here rather than in an index-aligned array on Beat.
*/
export interface Voice {
  sound: SoundName;
  // Seconds after the beat this hit starts; 0 (on the beat) when absent.
  // Drives flam-style doublets, e.g. the darbuka tk roll.
  offset?: VoiceOffset;
}

// The overwhelmingly common case: a hit that just plays a sound.
export const voice = (sound: SoundName, rest: Omit<Voice, "sound"> = {}): Voice => ({
  sound,
  ...rest,
});

export type Beat = {
  voices: Voice[];
  duration: number; // Normally 1.0
};

export type Measure = Beat[];
export type Measures = Measure[];
export type BeatFillMethod = "strong" | "weak" | "off" | "copyEnd";
