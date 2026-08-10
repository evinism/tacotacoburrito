import type { Beat } from "@/metronome/core/types";
import methodOne from "./methodone";
import methodThree from "./methodthree";
import methodTwo from "./methodtwo";

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

// Every method, so the bench can run them against each other.
export const methods = {
  methodOne,
  methodTwo,
  methodThree,
};

export type MethodName = keyof typeof methods;

// The method the app ships. Frontends import this rather than naming a version,
// so swapping the shipped method is a one-line change here.
export default methodThree;
