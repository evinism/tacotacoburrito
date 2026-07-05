"use client";

import { useEffect } from "react";
import { useSnackbar } from "./snackbar";

// iOS mutes Web Audio when the hardware silent switch is on, and there's no
// browser API to detect that switch. So the best we can do is a one-time
// heads-up the first time someone opens the app on an iOS device.
const STORAGE_KEY = "iosSilentModeHintShown";
const HINT_DURATION_MS = 10000;

const isIOS = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // Older iOS reports iPhone/iPad/iPod in the UA; iPadOS masquerades as a Mac
  // but is the only "Mac" with a touchscreen.
  return (
    /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
};

// Renders nothing; fires a one-time snackbar on first iOS load. localStorage is
// only touched inside the effect so this stays SSR-safe (it mounts in the
// server-rendered app shell).
export default function IosSilentModeHint() {
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    if (!isIOS()) return;
    if (localStorage.getItem(STORAGE_KEY)) return;
    localStorage.setItem(STORAGE_KEY, "true");
    showSnackbar(
      "On iPhone? Make sure to turn off silent mode to hear the metronome!",
      HINT_DURATION_MS
    );
  }, [showSnackbar]);

  return null;
}
