import { memo, useState } from "react";
import { Typography } from "@mui/material";
import { setAtIndex, toSplitIndex } from "@/metronome/core/util";

import ScheduleIcon from "@mui/icons-material/Schedule";

import LongPressListener from "./longpresslistener";
import styles from "@/metronome/classic/classic.module.css";

import type { Beat as BeatT } from "@/metronome/core/types";
import { BeatFillMethod, Measure, Measures } from "@/metronome/core/types";
import BeatContextMenu from "./beatmodmenu";

// Classic is single-voice: a beat's accent is its sole voice, or "off" for
// none. Accent hierarchy is strong > weak > off.
type Accent = "strong" | "weak" | "off";

const beatLookupOrder: Record<"up" | "down", Record<Accent, Accent>> = {
  up: {
    off: "weak",
    weak: "strong",
    strong: "off",
  },
  down: {
    strong: "weak",
    weak: "off",
    off: "strong",
  },
};

const accentLabels: Record<Accent, string> = {
  strong: "Strong",
  weak: "Weak",
  off: "off",
};

const accentOf = (beat: BeatT): Accent =>
  (beat.voices[0] as Accent | undefined) ?? "off";

interface MeasureComponentProps {
  beats: Measures;
  setBeats: (beats: Measures) => void;
  measureIndex: number;
  beatFill: BeatFillMethod;
  currentBeat: number;
  beatAccentChangeDirection: "up" | "down";
  setBpm: (bpm: number) => void;
  onBeatAccentChange?: () => void;
  showLabel?: boolean;
}

const MeasureComponent = ({
  beats,
  measureIndex,
  setBeats,
  currentBeat,
  beatAccentChangeDirection,
  onBeatAccentChange,
  showLabel = false,
}: MeasureComponentProps) => {
  // Calculate current beat within the measure.
  const [measureNum, beatNum] = toSplitIndex(beats, currentBeat);
  let innerCurrentBeat = -1;
  const isMeasureActive = currentBeat >= 0 && measureNum === measureIndex;
  if (isMeasureActive) {
    innerCurrentBeat = beatNum;
  }

  const measure = beats[measureIndex];

  const changeBeatAccent = (index: number, accent: Accent) => {
    const newMeasure: Measure = measure.map((beat, i) =>
      i === index
        ? {
            voices: accent === "off" ? [] : [accent],
            duration: beat.duration,
          }
        : beat
    );
    setBeats(setAtIndex(beats, measureIndex, newMeasure));
  };
  const rotateBeatStrength = (index: number, direction: "up" | "down") => {
    onBeatAccentChange?.();
    changeBeatAccent(
      index,
      beatLookupOrder[direction][accentOf(measure[index])]
    );
  };

  const changeBeatDuration = (index: number, duration: number) => {
    const newMeasure: Measure = measure.map((beat, i) =>
      i === index
        ? {
            voices: beat.voices,
            duration,
          }
        : beat
    );
    setBeats(setAtIndex(beats, measureIndex, newMeasure));
  };

  return (
    <>
      {showLabel && (
        <Typography
          variant="subtitle2"
          className={
            styles.MeasureLabel + " " + (isMeasureActive ? styles.active : "")
          }
        >
          Measure {measureIndex + 1}
        </Typography>
      )}
      <div
        className={styles.BeatArray}
        role="group"
        aria-label={`Measure ${measureIndex + 1}`}
      >
        {measure.map((beat, index) => (
          <Beat
            key={index}
            index={index}
            beat={beat}
            active={index === innerCurrentBeat}
            rotateBeatStrength={() =>
              rotateBeatStrength(index, beatAccentChangeDirection)
            }
            changeBeatDuration={(duration: number) =>
              changeBeatDuration(index, duration)
            }
          />
        ))}
      </div>
    </>
  );
};

const Beat = ({
  active,
  index,
  rotateBeatStrength,
  changeBeatDuration,
  beat,
}: {
  active: boolean;
  beat: BeatT;
  rotateBeatStrength: () => void;
  changeBeatDuration: (duration: number) => void;
  index: number;
}) => {
  // anchorEl also indicates whether the context menu is open
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const handleLongClick = (target: HTMLElement) => {
    setAnchorEl(target);
  };

  const accent = accentOf(beat);
  const hasCustomDuration = Boolean(beat.duration) && beat.duration !== 1;
  const beatLabel =
    `Beat ${index + 1}: ${accentLabels[accent]}` +
    (hasCustomDuration ? `, duration ${beat.duration}×` : "");

  return (
    <>
      {
        <BeatContextMenu
          onClose={() => setAnchorEl(null)}
          beat={beat}
          open={anchorEl !== null}
          changeBeatDuration={changeBeatDuration}
          anchorEl={anchorEl}
        />
      }
      <LongPressListener
        onLongPress={handleLongClick}
        delay={500}
        onClick={rotateBeatStrength}
      >
        <div
          role="button"
          tabIndex={0}
          aria-label={beatLabel}
          aria-haspopup="dialog"
          onKeyDown={(e) => {
            if (e.key !== "Enter") {
              return;
            }
            // Enter rotates the accent; Shift+Enter opens the duration menu
            // (the keyboard equivalent of long-press). Space is deliberately
            // NOT an activator, unlike a standard ARIA button: it's the
            // app-wide play/stop key, and clicking a cell focuses it — space
            // must still toggle playback afterwards. Screen readers activate
            // via synthesized clicks, which LongPressListener handles.
            e.preventDefault();
            if (e.shiftKey) {
              setAnchorEl(e.currentTarget);
            } else {
              rotateBeatStrength();
            }
          }}
          className={
            styles.BeatIcon +
            " " +
            (active ? styles.active : styles.inactive) +
            " " +
            {
              strong: styles.strong,
              weak: styles.weak,
              off: styles.off,
            }[accent]
          }
        >
          {index + 1}
          {hasCustomDuration && (
            <ScheduleIcon className={styles.BeatTimeModIndicator} />
          )}
        </div>
      </LongPressListener>
    </>
  );
};

export const MemoizedMeasureComponent = memo(MeasureComponent);
