"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";

import { usePersistentState } from "@/hooks";
import { useMetronome } from "@/metronome/shared/usemetronome";
import { useTapTempo } from "@/metronome/shared/usetaptempo";
import { MetronomeSpec } from "@/metronome/core/engine";
import { scaleBPM, invScaleBPM, TEMPO_SLIDER_MAX } from "@/metronome/core/tempo";
import { Measure, Measures, VoiceOffset } from "@/metronome/core/types";
import type { SoundPackId } from "@/metronome/core/soundpacks";
import GlobalKeydownListener from "@/metronome/shared/globalkeydownlistener";

import PatternList, {
  LibraryList,
  PatternState,
  usePatterns,
} from "./patterns";
import styles from "./sequencer.module.css";

import {
  Box,
  Button,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  Input,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Slider,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";

const ttConfig = {
  enterDelay: 500,
};

const MIN_STEPS = 1;
// Generous enough that toggling eighth-note mode on can double a full-length
// quarter-note pattern without truncating it.
const MAX_STEPS = 64;
const DEFAULT_STEPS = 8;

// Spacing between the hits of a doublet row (tk/kk), sampled uniformly per
// occurrence so repeats don't sound machine-identical. Below ~10ms the hits
// blend into one thick stroke, above ~40ms they read as separate grace notes.
const DOUBLET_OFFSET_RANGE: [number, number] = [0.01, 0.03];

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

// When showEighths is on, each pair of columns is one quarter note: the first
// gets its quarter-note count, the second is labeled "&".
const stepLabel = (index: number, showEighths: boolean): string =>
  showEighths
    ? index % 2 === 0
      ? String(index / 2 + 1)
      : "&"
    : String(index + 1);

// Sequencer-local track list — not core metadata. These `voice` keys are the
// grid's ROW IDENTITIES, not pack sound names: they key the persisted grid and
// stay fixed no matter which sound pack is selected, so switching packs never
// rewrites a saved pattern. They're named after darbuka strokes because
// darbuka is the default pack; other packs map them to their own sounds via
// SOUND_PACKS below.
// Labels use darbuka shorthand: D = doum, T/K = first tek/ka, t/k = second.
const TRACKS = [
  { voice: "doum", label: "D" },
  { voice: "te1", label: "T" },
  { voice: "ka1", label: "K" },
  { voice: "te2", label: "t" },
  { voice: "ka2", label: "k" },
  { voice: "tk", label: "tk" },
  { voice: "kk", label: "kk" },
] as const;

type TrackVoice = (typeof TRACKS)[number]["voice"];

// The packs offered in the dropdown, each with a voicing that maps the rows
// onto sounds the pack actually defines. `darbuka` and `drums` have a
// distinct sound per row; the others only satisfy the universal strong/weak
// contract, so most rows collapse onto one of two timbres there (documented,
// not a bug). This mapping is why swapping packs can never silence a pattern:
// every row always resolves to a sound the target pack has. A row's voicing
// is a single sound, or an array for a doublet/roll (see DOUBLET_OFFSET).
interface SoundPackOption {
  id: SoundPackId;
  label: string;
  voices: Record<TrackVoice, string | string[]>;
}

const SOUND_PACKS: SoundPackOption[] = [
  {
    id: "darbuka",
    label: "Darbuka",
    voices: {
      doum: "doum",
      te1: "te1",
      te2: "te2",
      ka1: "ka1",
      ka2: "ka2",
      tk: ["te2", "ka2"],
      kk: ["ka1", "ka2"],
    },
  },
  {
    id: "drums",
    label: "Drum kit",
    voices: {
      doum: "kick",
      te1: "snare",
      te2: "snare",
      ka1: "hihat",
      ka2: "hihat",
      tk: ["snare", "hihat"],
      kk: ["hihat", "hihat"],
    },
  },
  {
    id: "default",
    label: "Beeps",
    voices: {
      doum: "weak",
      te1: "strong",
      te2: "strong",
      ka1: "strong",
      ka2: "strong",
      tk: ["strong", "strong"],
      kk: ["strong", "strong"],
    },
  },
  {
    id: "dirac",
    label: "Clicks",
    voices: {
      doum: "weak",
      te1: "strong",
      te2: "strong",
      ka1: "strong",
      ka2: "strong",
      tk: ["strong", "strong"],
      kk: ["strong", "strong"],
    },
  },
  {
    id: "doumbek",
    label: "Doumbek",
    voices: {
      doum: "weak",
      te1: "strong",
      te2: "strong",
      ka1: "strong",
      ka2: "strong",
      tk: ["strong", "strong"],
      kk: ["strong", "strong"],
    },
  },
];

const DEFAULT_PACK =
  SOUND_PACKS.find((pack) => pack.id === "darbuka") ?? SOUND_PACKS[0];

const packById = (id: string): SoundPackOption =>
  SOUND_PACKS.find((pack) => pack.id === id) ?? DEFAULT_PACK;

// The grid is the persisted state; Measures is only a projection derived at
// the engine boundary (see the `beats` memo below).
type Grid = Record<string, boolean[]>;

const emptyGrid = (steps: number): Grid =>
  Object.fromEntries(TRACKS.map(({ voice }) => [voice, Array(steps).fill(false)]));

// Rows the deployed 3-row sequencer (and patterns saved under it) persisted
// under kick/snare/hihat keys — fall back to these when a grid lacks the new key.
const LEGACY_ROW: Record<string, string> = { doum: "kick", te1: "snare", ka1: "hihat" };

// Resize every row to `steps`, preserving existing cells (truncate or pad with
// false). Applied defensively on every render so a `grid`/`steps` mismatch
// (e.g. independently-migrated localStorage values) can't desync the UI. Also
// doubles as the legacy 3-row grid migration via LEGACY_ROW.
const resizeGrid = (grid: Grid, steps: number): Grid => {
  const resizeRow = (row: boolean[]): boolean[] => {
    const next = (row ?? []).slice(0, steps);
    while (next.length < steps) next.push(false);
    return next;
  };
  return Object.fromEntries(
    TRACKS.map(({ voice }) => [
      voice,
      resizeRow(grid[voice] ?? grid[LEGACY_ROW[voice]]),
    ])
  );
};

// Re-grid between quarter- and eighth-note resolution. Doubling interleaves
// empty offbeat columns; halving drops them, so anything written on an "&" is
// lost — the same trade as shortening the pattern.
const changeResolution = (grid: Grid, doubling: boolean): Grid =>
  Object.fromEntries(
    TRACKS.map(({ voice }) => [
      voice,
      doubling
        ? grid[voice].flatMap((on) => [on, false])
        : grid[voice].filter((_, index) => index % 2 === 0),
    ])
  );

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
  const [showEighths, setShowEighths] = usePersistentState<boolean>(
    "sequencer/showEighths",
    false
  );
  const [packId, setPackId] = usePersistentState<string>(
    "sequencer/soundPack",
    DEFAULT_PACK.id
  );

  const pack = packById(packId);

  const effectiveGrid = useMemo(() => resizeGrid(grid, steps), [grid, steps]);

  const beats: Measures = useMemo(() => {
    const measure: Measure = Array.from({ length: steps }, (_, i) => {
      // Translate each on row from its grid identity to the selected pack's
      // sound name(s), so a pattern authored on drums still sounds on any
      // pack. A row can voice more than one sound (a doublet/roll): the first
      // hit lands on the grid, each later one a humanized DOUBLET_OFFSET_RANGE
      // draw after the previous.
      const hits = TRACKS.filter(({ voice }) => effectiveGrid[voice][i]).flatMap(
        ({ voice }) => {
          const sounds = pack.voices[voice];
          return (Array.isArray(sounds) ? sounds : [sounds]).map(
            (sound, j): { sound: string; offset: VoiceOffset } => ({
              sound,
              offset:
                j === 0
                  ? 0
                  : [
                      j * DOUBLET_OFFSET_RANGE[0],
                      j * DOUBLET_OFFSET_RANGE[1],
                    ],
            })
          );
        }
      );
      return {
        voices: hits.map((hit) => hit.sound),
        offsets: hits.map((hit) => hit.offset),
        // BPM always counts quarter notes, so in eighth-note mode each column
        // is half a beat rather than the tempo doubling underneath the user.
        duration: showEighths ? 0.5 : 1,
      };
    });
    return [measure];
  }, [effectiveGrid, steps, showEighths, pack]);

  const spec: MetronomeSpec = useMemo(
    () => ({ bpm, beats, sound: { soundPack: pack.id } }),
    [bpm, beats, pack]
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

  const handleShowEighthsChange = (next: boolean) => {
    const newSteps = clamp(
      next ? steps * 2 : Math.ceil(steps / 2),
      MIN_STEPS,
      MAX_STEPS
    );
    setShowEighths(next);
    setSteps(newSteps);
    setGrid(resizeGrid(changeResolution(effectiveGrid, next), newSteps));
  };

  const toggleCell = (voice: string, index: number) => {
    const row = effectiveGrid[voice].slice();
    row[index] = !row[index];
    setGrid({ ...effectiveGrid, [voice]: row });
  };

  const clearGrid = () => {
    setGrid(emptyGrid(steps));
  };

  const { patterns, saveNew, overwrite, rename, remove } = usePatterns();

  const currentPattern: PatternState = {
    bpm,
    steps,
    showEighths,
    grid: effectiveGrid,
  };

  const loadPattern = (pattern: PatternState) => {
    setBpm(pattern.bpm);
    setSteps(pattern.steps);
    setShowEighths(pattern.showEighths);
    // Resize defensively — a pattern saved before a shape change could carry a
    // grid that disagrees with its own step count.
    setGrid(resizeGrid(pattern.grid, pattern.steps));
  };

  const activeStep = playing ? currentBeat % steps : -1;

  return (
    <Paper className={styles.Sequencer} elevation={4}>
      <Typography variant="h5" className={styles.Title}>
        Sequencer
      </Typography>
      <Typography variant="body1" className={styles.SubTitle}>
        a step sequencer for darbuka strokes
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
        <FormControlLabel
          control={
            <Switch
              checked={showEighths}
              onChange={(event) => handleShowEighthsChange(event.target.checked)}
            />
          }
          label="Show eighth notes"
        />
        <div>
          <InputLabel htmlFor="soundpack-select" sx={{ fontSize: 14 }}>
            Sound
          </InputLabel>
          <Select
            id="soundpack-select"
            size="small"
            variant="standard"
            value={pack.id}
            onChange={(event) => setPackId(event.target.value)}
          >
            {SOUND_PACKS.map(({ id, label }) => (
              <MenuItem key={id} value={id}>
                {label}
              </MenuItem>
            ))}
          </Select>
        </div>
        <div className={styles.Spacer} />
        <Button onClick={clearGrid}>Clear</Button>
      </Box>

      <div className={styles.Grid}>
        <div className={styles.LabelRow}>
          <div className={styles.RowLabel} />
          <div className={styles.Cells}>
            {Array.from({ length: steps }, (_, index) => (
              <Typography
                key={index}
                variant="caption"
                className={[
                  styles.LabelCell,
                  index === activeStep ? styles.active : "",
                ].join(" ")}
              >
                {stepLabel(index, showEighths)}
              </Typography>
            ))}
          </div>
        </div>
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
        <div className={styles.Spacer} />
        <Button onClick={() => saveNew(currentPattern)}>Save as New</Button>
      </div>

      <Divider />

      <PatternList
        patterns={patterns}
        onLoad={loadPattern}
        onOverwrite={(id) => overwrite(id, currentPattern)}
        onRename={rename}
        onRemove={remove}
      />

      <Divider />

      <LibraryList onLoad={loadPattern} />

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
