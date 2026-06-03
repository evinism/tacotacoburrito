"use client";

import { createTheme, CssBaseline, ThemeProvider } from "@mui/material";

import styles from "./index.module.css";
import MetronomeComponent from "./components/metronome";

const darkTheme = createTheme({
  palette: {
    mode: "dark",
  },
});

const App = () => {
  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <div className={styles.App}>
        <div className={styles.Background} />
        <MetronomeComponent />
      </div>
    </ThemeProvider>
  );
};

export default App;
