"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";

import { usePersistentState } from "@/hooks";
import { useMetronome } from "@/metronome/shared/usemetronome";
import { useTapTempo } from "@/metronome/shared/usetaptempo";
import { MetronomeSpec } from "@/metronome/core/engine";
import { scaleBPM, invScaleBPM, TEMPO_SLIDER_MAX } from "@/metronome/core/tempo";
import { Measure, Measures } from "@/metronome/core/types";
import GlobalKeydownListener from "@/metronome/shared/globalkeydownlistener";

import styles from "./sequencer.module.css";

import {
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  Input,
  InputLabel,
  Paper,
  Slider,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";

const ttConfig = {
  enterDelay: 500,
};

const MIN_STEPS = 1;
const MAX_STEPS = 32;
const DEFAULT_STEPS = 8;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

// Sequencer-local track list — not core metadata. Adding a row is one entry
// here plus one sound in the `drums` pack (see core/soundpacks.ts).
const TRACKS = [
  { voice: "kick", label: "Kick" },
  { voice: "snare", label: "Snare" },
  { voice: "hihat", label: "Hihat" },
] as const;

// The grid is the persisted state; Measures is only a projection derived at
// the engine boundary (see the `beats` memo below).
type Grid = Record<string, boolean[]>;

const emptyGrid = (steps: number): Grid =>
  Object.fromEntries(TRACKS.map(({ voice }) => [voice, Array(steps).fill(false)]));

// Resize every row to `steps`, preserving existing cells (truncate or pad with
// false). Applied defensively on every render so a `grid`/`steps` mismatch
// (e.g. independently-migrated localStorage values) can't desync the UI.
const resizeGrid = (grid: Grid, steps: number): Grid => {
  const resizeRow = (row: boolean[]): boolean[] => {
    const next = (row ?? []).slice(0, steps);
    while (next.length < steps) next.push(false);
    return next;
  };
  return Object.fromEntries(
    TRACKS.map(({ voice }) => [voice, resizeRow(grid[voice])])
  );
};

const SequencerMetronome = () => {
  const [bpm, setBpm] = usePersistentState<number>("sequencer/bpm", 120);
  const [steps, setSteps] = usePersistentState<number>(
    "sequencer/steps",
    DEFAULT_STEPS
  );
  const [grid, setGrid] = usePersistentState<Grid>(
    "sequencer/grid",
    emptyGrid(DEFAULT_STEPS)
  );

  const effectiveGrid = useMemo(() => resizeGrid(grid, steps), [grid, steps]);

  const beats: Measures = useMemo(() => {
    const measure: Measure = Array.from({ length: steps }, (_, i) => ({
      voices: TRACKS.filter(({ voice }) => effectiveGrid[voice][i]).map(
        ({ voice }) => voice
      ),
      duration: 1,
    }));
    return [measure];
  }, [effectiveGrid, steps]);

  const spec: MetronomeSpec = useMemo(
    () => ({ bpm, beats, sound: { soundPack: "drums" } }),
    [bpm, beats]
  );

  const {
    metronome,
    beat: currentBeat,
    playing,
    soundPackStatus,
  } = useMetronome(spec);

  const togglePlaying = () => {
    if (metronome.isPlaying()) {
      metronome.stop();
    } else {
      metronome.play();
    }
  };

  const modTempo = (fraction: number) => () => {
    setBpm(bpm * fraction);
  };

  const handleSliderChange = (_: Event, newValue: number | number[]) => {
    setBpm(scaleBPM(newValue as number));
  };

  const handleTapTempoClick = useTapTempo(setBpm);

  const handleStepsChange = (newSteps: number) => {
    const clamped = clamp(newSteps, MIN_STEPS, MAX_STEPS);
    setSteps(clamped);
    setGrid(resizeGrid(effectiveGrid, clamped));
  };

  const toggleCell = (voice: string, index: number) => {
    const row = effectiveGrid[voice].slice();
    row[index] = !row[index];
    setGrid({ ...effectiveGrid, [voice]: row });
  };

  const clearGrid = () => {
    setGrid(emptyGrid(steps));
  };

  const activeStep = playing ? currentBeat % steps : -1;

  return (
    <Paper className={styles.Sequencer} elevation={4}>
      <Typography variant="h5" className={styles.Title}>
        Sequencer
      </Typography>
      <Typography variant="body1" className={styles.SubTitle}>
        a 3-row step sequencer for kick, snare, and hihat
      </Typography>
      <Divider />
      <Box className={styles.HorizontalGroup}>
        <div>
          <InputLabel htmlFor="bpm-input" sx={{ fontSize: 14 }}>
            BPM
          </InputLabel>
          <Input
            className={styles.BPMNumberInput}
            type="number"
            size="small"
            id="bpm-input"
            inputProps={{ min: 1 }}
            value={Math.round(bpm)}
            onChange={(event) => setBpm(parseInt(event.target.value))}
          />
        </div>

        <Tooltip title="Decrease Tempo by 3%" {...ttConfig}>
          <IconButton
            onClick={modTempo(1 / 1.03)}
            aria-label="Decrease Tempo by 3%"
          >
            <RemoveIcon />
          </IconButton>
        </Tooltip>
        <GlobalKeydownListener
          onKeyDown={modTempo(1 / 1.03)}
          keyFilter="ArrowLeft"
        />
        <Tooltip title="Increase Tempo by 3%" {...ttConfig}>
          <IconButton onClick={modTempo(1.03)} aria-label="Increase Tempo by 3%">
            <AddIcon />
          </IconButton>
        </Tooltip>
        <GlobalKeydownListener onKeyDown={modTempo(1.03)} keyFilter="ArrowRight" />
        <div className={styles.Spacer} />
        <div>
          <Button onClick={handleTapTempoClick}>Tap Tempo</Button>
          <GlobalKeydownListener onKeyDown={handleTapTempoClick} keyFilter="/" />
        </div>
      </Box>
      <Box className={styles.HorizontalGroup}>
        <Slider
          min={0}
          max={TEMPO_SLIDER_MAX}
          value={invScaleBPM(bpm)}
          onChange={handleSliderChange}
          aria-labelledby="input-slider"
        />
      </Box>

      <Divider />

      <Box className={styles.HorizontalGroup}>
        <div>
          <InputLabel htmlFor="steps-input" sx={{ fontSize: 14 }}>
            Steps
          </InputLabel>
          <Input
            className={styles.ShortNumberInput}
            type="number"
            size="small"
            id="steps-input"
            inputProps={{ min: MIN_STEPS, max: MAX_STEPS }}
            value={steps}
            onChange={(event) =>
              handleStepsChange(parseInt(event.target.value))
            }
          />
        </div>
        <div className={styles.Spacer} />
        <Button onClick={clearGrid}>Clear</Button>
      </Box>

      <div className={styles.Grid}>
        {TRACKS.map(({ voice, label }) => (
          <div key={voice} className={styles.Row}>
            <Typography variant="body2" className={styles.RowLabel}>
              {label}
            </Typography>
            <div className={styles.Cells}>
              {effectiveGrid[voice].map((on, index) => (
                <button
                  key={index}
                  type="button"
                  aria-label={`${label} step ${index + 1}`}
                  aria-pressed={on}
                  onClick={() => toggleCell(voice, index)}
                  className={[
                    styles.Cell,
                    on ? styles.on : "",
                    index === activeStep ? styles.active : "",
                  ].join(" ")}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <Divider />

      <div className={styles.ButtonGroup}>
        <Tooltip
          title={
            soundPackStatus === "error"
              ? "Sound pack failed to load"
              : soundPackStatus === "loading"
                ? "Loading sound pack…"
                : ""
          }
          {...ttConfig}
        >
          {/* span wrapper so the Tooltip still works while the Button is disabled */}
          <span>
            <Button
              onClick={togglePlaying}
              color={soundPackStatus === "error" ? "error" : "primary"}
              disabled={soundPackStatus === "loading"}
              startIcon={
                soundPackStatus === "loading" ? (
                  <CircularProgress size={16} color="inherit" />
                ) : undefined
              }
            >
              {soundPackStatus === "loading"
                ? "Loading"
                : soundPackStatus === "error"
                  ? "Error"
                  : playing
                    ? "Stop"
                    : "Play"}
            </Button>
          </span>
        </Tooltip>
        <GlobalKeydownListener onKeyDown={togglePlaying} keyFilter=" " />
      </div>
      <Typography variant="body2" className={styles.BackLink}>
        <a href="/metronomes">Other metronomes</a>
      </Typography>
      <footer className={styles.Footer}>
        <Typography variant="body2" color="textSecondary" align="center">
          <a href="https://github.com/evinism/tacotacoburrito">GitHub</a>
        </Typography>
        <Typography variant="body2" color="textSecondary" align="center">
          <a href="https://github.com/evinism/tacotacoburrito/issues">
            Report a bug
          </a>
        </Typography>
      </footer>
    </Paper>
  );
};

export default dynamic(() => Promise.resolve(SequencerMetronome), {
  ssr: false,
});
