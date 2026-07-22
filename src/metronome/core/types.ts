export type Voice = "v1" | "v2" | "v3";
export const VOICES: Voice[] = ["v1", "v2", "v3"];

export type Beat = {
  voices: Voice[];
  duration: number; // Normally 1.0
};

export type Measure = Beat[];
export type Measures = Measure[];
export type BeatFillMethod = Voice | "off" | "copyEnd";
