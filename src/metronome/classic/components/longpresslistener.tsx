import { ReactNode, useEffect, useRef, useState, CSSProperties } from "react";

// Press handling for the beat cells: a quick press is a click (accent
// rotate), holding for `delay` fires onLongPress (the duration popover), and
// sliding off or scrolling aborts the press entirely. Pointer events cover
// mouse and touch in one path — the old mouse-event version couldn't see real
// touch input at all (emulated mousedown/mouseup arrive together after the
// finger lifts, so the hold timer never ran).
// After a touch long-press opens the popover, lifting the finger can replay
// compatibility mouse events (mousedown/click) at the lift point — which is
// now the popover's backdrop, so the ghost click would instantly dismiss the
// menu that just opened. Arm a one-shot trap: on the next pointerup anywhere,
// swallow any click arriving within a few ms (synthetic clicks fire right
// after the lift; real follow-up taps take far longer).
const guardGhostClick = () => {
  const onLift = () => {
    const swallow = (ev: MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    document.addEventListener("click", swallow, true);
    setTimeout(() => document.removeEventListener("click", swallow, true), 50);
  };
  document.addEventListener("pointerup", onLift, { capture: true, once: true });
  // If no lift ever arrives, don't leave the trap armed forever.
  setTimeout(
    () => document.removeEventListener("pointerup", onLift, { capture: true }),
    10000
  );
};

const LongPressListener = ({
  onLongPress,
  onClick,
  children,
  delay = 500,
}: {
  onLongPress: (target: HTMLElement) => void;
  onClick: (target: HTMLElement) => void;
  children: ReactNode;
  delay?: number;
}) => {
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  // Drives the hold-progress styling (see [data-held] in classic.module.css).
  const [held, setHeld] = useState(false);
  // Android fires a native context menu partway through a touch hold; suppress
  // it for touch/pen without eating desktop right-clicks.
  const suppressContextMenuRef = useRef(false);

  const cancelPress = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setHeld(false);
  };

  // Don't let a pending timer fire into an unmounted component.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Primary pointer, main button only: no hold from right/middle click or a
    // second finger.
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) {
      return;
    }
    suppressContextMenuRef.current = e.pointerType !== "mouse";
    // Touch pointers are implicitly captured to their target, which would stop
    // pointerleave from firing when the finger slides off; release the capture
    // so slide-off-to-abort behaves the same for touch as for mouse.
    const target = e.currentTarget;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    cancelPress();
    setHeld(true);
    const pointerType = e.pointerType;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setHeld(false);
      if (pointerType !== "mouse") {
        guardGhostClick();
      }
      onLongPress(target);
    }, delay);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    // A pending timer means this was a quick press: a click. If the timer
    // already fired, the long-press consumed the gesture — releasing must not
    // also rotate the accent.
    if (timerRef.current) {
      cancelPress();
      onClick(e.currentTarget);
    }
  };

  // pointerleave: slid off the cell (the "never mind" gesture).
  // pointercancel: the browser claimed the gesture (e.g. the touch became a
  // page scroll). Both abort without clicking.
  const handlePointerAbort = () => cancelPress();

  return (
    <div
      data-held={held ? "" : undefined}
      style={{ "--long-press-delay": `${delay}ms` } as CSSProperties}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerAbort}
      onPointerCancel={handlePointerAbort}
      onClick={(e) => {
        // Assistive-tech activation (screen readers, etc.) arrives as a bare
        // click with detail 0 and no pointer events before it. Pointer-driven
        // clicks (detail ≥ 1) were already handled in pointerup — ignore them
        // here so they don't fire twice.
        if (e.detail === 0) {
          onClick(e.currentTarget);
        }
      }}
      onContextMenu={(e) => {
        if (suppressContextMenuRef.current) {
          e.preventDefault();
        }
      }}
    >
      {children}
    </div>
  );
};

export default LongPressListener;
