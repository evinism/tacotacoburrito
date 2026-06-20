import { useEffect } from "react";

// Declarative document-level keydown binding. Frontend-agnostic: renders
// nothing, just wires onKeyDown to a document listener for the lifetime of
// the component. Pass keyFilter to fire only for a specific key.
const GlobalKeydownListener = ({
  onKeyDown,
  keyFilter,
}: {
  onKeyDown: (e: KeyboardEvent) => void;
  keyFilter?: string;
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (keyFilter && e.key === keyFilter) {
        e.preventDefault();
        onKeyDown(e);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  });

  return null;
};

export default GlobalKeydownListener;
