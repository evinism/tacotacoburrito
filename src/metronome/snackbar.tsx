"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Snackbar } from "@mui/material";

type SnackbarContextValue = {
  showSnackbar: (message: string) => void;
};

const SnackbarContext = createContext<SnackbarContextValue | null>(null);

// Owns the single app-wide <Snackbar>. Mount this once in the base layout
// (inside the MUI ThemeProvider) so every frontend can fire messages through
// useSnackbar() without rendering its own snackbar.
export const SnackbarProvider = ({ children }: { children: ReactNode }) => {
  const [message, setMessage] = useState("");

  const showSnackbar = useCallback((message: string) => {
    setMessage(message);
  }, []);

  const value = useMemo(() => ({ showSnackbar }), [showSnackbar]);

  return (
    <SnackbarContext.Provider value={value}>
      {children}
      <Snackbar
        open={message !== ""}
        autoHideDuration={2000}
        onClose={() => setMessage("")}
        message={message}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </SnackbarContext.Provider>
  );
};

export const useSnackbar = (): SnackbarContextValue => {
  const context = useContext(SnackbarContext);
  if (!context) {
    throw new Error("useSnackbar must be used within a SnackbarProvider");
  }
  return context;
};
