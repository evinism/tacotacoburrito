import { useEffect } from "react";

// Keystrokes aimed at a text field are typing, not shortcuts — e.g. "." in the
// preset search box must not fire Smart Tap, and space must not toggle play.
const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable);

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
      if (isTypingTarget(e.target)) {
        return;
      }
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
