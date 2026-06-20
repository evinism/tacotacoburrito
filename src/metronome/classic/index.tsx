"use client";

import { createTheme, CssBaseline, ThemeProvider } from "@mui/material";

import styles from "./index.module.css";
import MetronomeComponent from "./components/metronome";
import { SnackbarProvider } from "../snackbar";

const darkTheme = createTheme({
  palette: {
    mode: "dark",
  },
});

const App = () => {
  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <SnackbarProvider>
        <div className={styles.App}>
          <div className={styles.Background} />
          <MetronomeComponent />
        </div>
      </SnackbarProvider>
    </ThemeProvider>
  );
};

export default App;
