// Registry of every frontend in the app. This is the single source of truth
// the /metronomes list page renders from.
//
// When you add a new frontend, add an entry here.
export type FrontendInfo = {
  // Display name shown in the list.
  name: string;
  // Route path the frontend is mounted at (see src/app/<path>/page.tsx).
  path: string;
  // One-line description of what makes this frontend distinct.
  description: string;
};

export const frontends: FrontendInfo[] = [
  {
    name: "Classic",
    path: "/",
    description:
      "The full metronome: odd meters, per-beat accents and durations, multiple measures, presets, and rhythm sharing.",
  },
  {
    name: "Simple",
    path: "/simple",
    description:
      "A bare tempo-only metronome — a steady click with just BPM controls and tap tempo.",
  },
  {
    name: "Skip Measure Trainer",
    path: "/skipmeasure",
    description:
      "Plays a few measures then goes silent for a few, for practicing internal timekeeping.",
  },
];
