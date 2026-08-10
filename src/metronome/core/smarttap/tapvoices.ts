// Tap Rhythm records intensity; the core model stores pack-named voices. Both
// inference methods and the synthetic tapper have to agree on how those map, so
// the mapping lives here instead of being restated in each of them.
//
// TapStrength is imported as a type only, which keeps this module clear of the
// index <-> method import cycle at runtime.
import type { Beat } from "@/metronome/core/types";
import type { TapStrength } from ".";

export const tapStrengthToVoices = (strength: TapStrength): Beat["voices"] =>
  strength === "strong" ? ["strong"] : strength === "weak" ? ["weak"] : [];

// The core contract is that a beat carrying the "strong" voice reads as
// accented, and anything else audible reads as weak.
export const voicesToTapStrength = (voices: Beat["voices"]): TapStrength =>
  voices.length === 0 ? "off" : voices.includes("strong") ? "strong" : "weak";
