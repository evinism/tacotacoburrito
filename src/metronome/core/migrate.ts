// Converts legacy `{ strength, duration }` beats (old localStorage, old share
// URLs, old saved presets) into the current `{ voices, duration }` shape.
// These run on every read rather than once at a migration boundary, so they
// must be idempotent — already-migrated data must pass through unchanged.
import { Beat, BeatFillMethod, Measures } from "./types";
import { Rhythm } from "./engine";

const STRENGTH_TO_VOICES: Record<string, string[]> = {
  off: [],
  strong: ["strong"],
  weak: ["weak"],
};

export function migrateBeat(beat: unknown): Beat {
  const b = beat as { voices?: unknown; strength?: unknown; duration?: unknown };
  if (Array.isArray(b?.voices)) {
    return { voices: b.voices as Beat["voices"], duration: b.duration ?? 1 } as Beat;
  }
  const voices = STRENGTH_TO_VOICES[String(b?.strength)] ?? [];
  return {
    voices: voices as Beat["voices"],
    duration: typeof b?.duration === "number" ? b.duration : 1,
  };
}

export function migrateMeasures(measures: unknown): Measures {
  return ((measures as unknown[][]) ?? []).map((measure) =>
    (measure ?? []).map(migrateBeat),
  );
}

export function migrateRhythm(rhythm: { beats: unknown; bpm: number }): Rhythm {
  return { beats: migrateMeasures(rhythm.beats), bpm: rhythm.bpm };
}

// Old persisted "strong"/"weak"/"off"/"copyEnd" are already valid
// BeatFillMethod values — just validate against the enum.
const VALID_FILL_METHODS: BeatFillMethod[] = [
  "strong",
  "weak",
  "off",
  "copyEnd",
];

export function migrateBeatFillMethod(value: unknown): BeatFillMethod {
  if (VALID_FILL_METHODS.includes(value as BeatFillMethod)) {
    return value as BeatFillMethod;
  }
  // Unknown/corrupt value — fall back to the app default rather than throw.
  return "copyEnd";
}
