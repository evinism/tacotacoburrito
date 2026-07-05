"use client";

import type { ReactNode } from "react";
import { createTheme, CssBaseline, ThemeProvider } from "@mui/material";

import { SnackbarProvider } from "@/metronome/shared/snackbar";
import IosSilentModeHint from "@/metronome/shared/iossilentmodehint";

const darkTheme = createTheme({
  palette: {
    mode: "dark",
  },
});

// Client-side providers for the app shell. Split out from the root layout
// because MUI's theme and the snackbar context need a Client Component, while
// the layout stays a Server Component so it can export metadata.
export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <SnackbarProvider>
        <IosSilentModeHint />
        {children}
      </SnackbarProvider>
    </ThemeProvider>
  );
}
