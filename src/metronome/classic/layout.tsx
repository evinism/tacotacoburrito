"use client";

import type { ReactNode } from "react";
import { createTheme, CssBaseline, ThemeProvider } from "@mui/material";

import { SnackbarProvider } from "../snackbar";
import styles from "./layout.module.css";

const darkTheme = createTheme({
  palette: {
    mode: "dark",
  },
});

// The classic frontend's own shell: theme, snackbar, and backdrop. Each
export default function ClassicLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <SnackbarProvider>
        <div className={styles.App}>
          <div className={styles.Background} />
          {children}
        </div>
      </SnackbarProvider>
    </ThemeProvider>
  );
}
