"use client";

import { useEffect, type ReactNode } from "react";
import { createTheme, CssBaseline, ThemeProvider } from "@mui/material";

import { SnackbarProvider } from "@/metronome/shared/snackbar";
import { installIosAudioUnmute } from "@/metronome/shared/unmuteiosaudio";

const darkTheme = createTheme({
  palette: {
    mode: "dark",
  },
});

// Client-side providers for the app shell. Split out from the root layout
// because MUI's theme and the snackbar context need a Client Component, while
// the layout stays a Server Component so it can export metadata.
export default function Providers({ children }: { children: ReactNode }) {
  // Let iOS Safari play the metronome through the hardware silent switch.
  useEffect(() => {
    installIosAudioUnmute();
  }, []);

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <SnackbarProvider>{children}</SnackbarProvider>
    </ThemeProvider>
  );
}
