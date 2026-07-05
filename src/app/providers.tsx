"use client";

import { useEffect, type ReactNode } from "react";
import { createTheme, CssBaseline, ThemeProvider } from "@mui/material";

import { SnackbarProvider } from "@/metronome/shared/snackbar";
import unmuteIosAudio from "unmute-ios-audio";

const darkTheme = createTheme({
  palette: {
    mode: "dark",
  },
});

// Called once (guarded against React's dev double-invoke). unmuteIosAudio is a
// no-op off iOS; on iOS it registers global listeners itself, so calling it
// twice would double-register.
let iosAudioUnmuted = false;

// Client-side providers for the app shell. Split out from the root layout
// because MUI's theme and the snackbar context need a Client Component, while
// the layout stays a Server Component so it can export metadata.
export default function Providers({ children }: { children: ReactNode }) {
  // Let iOS Safari play the metronome through the hardware silent switch.
  useEffect(() => {
    if (iosAudioUnmuted) return;
    iosAudioUnmuted = true;
    unmuteIosAudio();
  }, []);

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <SnackbarProvider>{children}</SnackbarProvider>
    </ThemeProvider>
  );
}
