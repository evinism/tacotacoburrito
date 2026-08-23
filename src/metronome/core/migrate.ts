// Converts legacy beats — `{ strength, duration }`, and the later
// `{ voices: string[], offsets }` — from old localStorage, old share URLs and
// old saved presets into the current `{ voices: Voice[], duration }` shape.
// These run on every read rather than once at a migration boundary, so they
// must be idempotent — already-migrated data must pass through unchanged.
import { Beat, BeatFillMethod, Measures, Voice, VoiceOffset } from "./types";
import { Rhythm } from "./engine";

const STRENGTH_TO_SOUNDS: Record<string, string[]> = {
  off: [],
  strong: ["strong"],
  weak: ["weak"],
};

// A stored voice is either a bare sound name (with its offset, if any, held in
// the beat's parallel `offsets` array) or an already-current Voice object.
function migrateVoice(stored: unknown, offset: unknown): Voice | undefined {
  if (typeof stored === "string") {
    return offset === undefined
      ? { sound: stored }
      : { sound: stored, offset: offset as VoiceOffset };
  }
  const v = stored as Partial<Voice> | null;
  return typeof v?.sound === "string" ? (v as Voice) : undefined;
}

export function migrateBeat(beat: unknown): Beat {
  const b = beat as {
    voices?: unknown;
    offsets?: unknown;
    strength?: unknown;
    duration?: unknown;
  };
  const duration = typeof b?.duration === "number" ? b.duration : 1;
  if (Array.isArray(b?.voices)) {
    const offsets = Array.isArray(b.offsets) ? b.offsets : [];
    return {
      voices: b.voices
        .map((stored, i) => migrateVoice(stored, offsets[i]))
        .filter((v): v is Voice => v !== undefined),
      duration,
    };
  }
  return {
    voices: (STRENGTH_TO_SOUNDS[String(b?.strength)] ?? []).map((sound) => ({
      sound,
    })),
    duration,
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
