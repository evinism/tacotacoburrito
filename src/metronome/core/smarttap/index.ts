import { Beat } from "@/metronome/core/types";
import methodOne from "./methodone";

// Tap intensity, as recorded during Tap Rhythm input — a separate concept
// from the core Voice model, so it's defined locally rather than reusing
// (removed) BeatStrength.
export type TapStrength = "strong" | "weak" | "off";

export type BeatClick = {
  strength: TapStrength;
  time: number;
};

type Result<T> =
  | {
      value: T;
      confidence: number;
    }
  | undefined;

export type RhythmInferenceMethod = (taps: BeatClick[]) => Result<{
  beats: Beat[];
  tempo: number;
}>;

export const methods = {
  methodOne,
};

export default methodOne;
