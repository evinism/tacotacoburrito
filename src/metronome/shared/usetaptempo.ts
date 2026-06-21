import { useState } from "react";

// How long a tap stays "recent", and how many recent taps to average over.
const TAP_WINDOW_MS = 5000;
const MAX_TAPS = 6;

// Tap-tempo: returns a `tap` callback to fire on each user tap. Once two taps
// land within the window, it infers BPM from the average inter-tap gap and
// pushes it through `setBpm`. Stale taps (older than the window) are dropped so
// a fresh burst isn't skewed by an earlier session.
export const useTapTempo = (setBpm: (bpm: number) => void) => {
  const [tapTimeHistory, setTapTimeHistory] = useState<number[]>([]);

  return () => {
    const now = Date.now();
    let recentTaps = tapTimeHistory.filter((t) => now - t < TAP_WINDOW_MS);
    recentTaps.push(now);
    recentTaps = recentTaps.slice(-MAX_TAPS);

    const gaps: number[] = [];
    for (let i = 1; i < recentTaps.length; i++) {
      gaps.push(recentTaps[i] - recentTaps[i - 1]);
    }
    if (gaps.length > 0) {
      const averageGap = gaps.reduce((x, y) => x + y, 0) / gaps.length;
      setBpm(Math.round(60000 / averageGap));
    }
    setTapTimeHistory(recentTaps);
  };
};

export default useTapTempo;
