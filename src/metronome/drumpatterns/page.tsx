"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

import { usePersistentState } from "@/hooks";
import { useMetronome } from "@/metronome/shared/usemetronome";
import { useTapTempo } from "@/metronome/shared/usetaptempo";
import { MetronomeSpec } from "@/metronome/core/engine";
import { Measure, Measures, VoiceOffset } from "@/metronome/core/types";
import type { SoundPackId } from "@/metronome/core/soundpacks";
import GlobalKeydownListener from "@/metronome/shared/globalkeydownlistener";
import { useSnackbar } from "@/metronome/shared/snackbar";

import PatternLibrary, {
  familyKey,
  PatternNotes,
  PatternState,
  randomLibraryPattern,
  usePatterns,
  type NoteTarget,
} from "./patterns";
import {
  SHARE_HASH_PREFIX,
  deserializePattern,
  serializePattern,
} from "./share";
import styles from "./drumpatterns.module.css";

import {
  Box,
  Button,
  CircularProgress,
  Divider,
  Grid,
  IconButton,
  Input,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Slider,
  Tooltip,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import ShareIcon from "@mui/icons-material/Share";
import SettingsIcon from "@mui/icons-material/Settings";

const ttConfig = {
  enterDelay: 500,
};

// Steps are eighth-note columns; the UI asks for the *count* (quarter notes)
// and doubles it, so a step total is always even and at least one beat long.
const MIN_STEPS = 2;
const MAX_STEPS = 64;
const DEFAULT_STEPS = 8;

// Sanity cap on phrase length, not an engine limit — Measures has no bound.
const MAX_BARS = 8;

// Spacing between the hits of a doublet row (tk/kk), sampled uniformly per
// occurrence so repeats don't sound machine-identical. Below ~10ms the hits
// blend into one thick stroke, above ~40ms they read as separate grace notes.
const DOUBLET_OFFSET_RANGE: [number, number] = [0.01, 0.03];

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

// The grid is always eighth-note resolution, so each pair of columns is one
// quarter note: the first gets its quarter-note count, the second is "&".
const stepLabel = (index: number): string =>
  index % 2 === 0 ? String(index / 2 + 1) : "&";

// Frontend-local track list — not core metadata. These `voice` keys are the
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

// Resize every row to `steps`, preserving existing cells (truncate or pad with
// false). Rows a pattern omits entirely (the library and share links drop
// all-rest rows) come back empty and get filled in here.
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

const DrumPatternLibrary = () => {
  const [bpm, setBpm] = usePersistentState<number>("drumpatterns/bpm", 120);
  const [steps, setSteps] = usePersistentState<number>(
    "drumpatterns/steps",
    DEFAULT_STEPS
  );
  const [bars, setBars] = usePersistentState<Grid[]>("drumpatterns/bars", [
    emptyGrid(DEFAULT_STEPS),
  ]);
  const [packId, setPackId] = usePersistentState<string>(
    "drumpatterns/soundPack",
    DEFAULT_PACK.id
  );
  const [volume, setVolume] = usePersistentState<number>(
    "drumpatterns/volume",
    1
  );
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);

  const pack = packById(packId);

  const effectiveBars = useMemo(
    () => bars.map((bar) => resizeGrid(bar, steps)),
    [bars, steps]
  );

  const beats: Measures = useMemo(() => {
    return effectiveBars.map((bar) => {
      const measure: Measure = Array.from({ length: steps }, (_, i) => {
        // Translate each on row from its grid identity to the selected pack's
        // sound name(s), so a pattern authored on drums still sounds on any
        // pack. A row can voice more than one sound (a doublet/roll): the first
        // hit lands on the grid, each later one a humanized DOUBLET_OFFSET_RANGE
        // draw after the previous.
        const hits = TRACKS.filter(({ voice }) => bar[voice][i]).flatMap(
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
          // BPM always counts quarter notes, so each column is half a beat
          // rather than the tempo doubling underneath the user.
          duration: 0.5,
        };
      });
      return measure;
    });
  }, [effectiveBars, steps, pack]);

  const spec: MetronomeSpec = useMemo(
    () => ({ bpm, beats, sound: { soundPack: pack.id, volume } }),
    [bpm, beats, pack, volume]
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

  const handleTapTempoClick = useTapTempo(setBpm);

  // The input is in quarter notes; the grid underneath is in eighths.
  const handleCountChange = (count: number) => {
    // The input reports NaN while it's empty mid-edit; leave the grid alone.
    if (!Number.isFinite(count)) return;
    const clamped = clamp(count * 2, MIN_STEPS, MAX_STEPS);
    setSteps(clamped);
    setBars(effectiveBars.map((bar) => resizeGrid(bar, clamped)));
  };

  const toggleCell = (barIndex: number, voice: string, index: number) => {
    const row = effectiveBars[barIndex][voice].slice();
    row[index] = !row[index];
    setBars(
      effectiveBars.map((bar, i) =>
        i === barIndex ? { ...bar, [voice]: row } : bar
      )
    );
  };

  const clearGrid = () => {
    setBars(effectiveBars.map(() => emptyGrid(steps)));
  };

  const addBar = () => {
    if (effectiveBars.length >= MAX_BARS) return;
    setBars([...effectiveBars, emptyGrid(steps)]);
  };

  const duplicateBar = (barIndex: number) => {
    if (effectiveBars.length >= MAX_BARS) return;
    const copy: Grid = Object.fromEntries(
      Object.entries(effectiveBars[barIndex]).map(([voice, row]) => [
        voice,
        row.slice(),
      ])
    );
    setBars([
      ...effectiveBars.slice(0, barIndex + 1),
      copy,
      ...effectiveBars.slice(barIndex + 1),
    ]);
  };

  const removeBar = (barIndex: number) => {
    if (effectiveBars.length <= 1) return;
    setBars(effectiveBars.filter((_, i) => i !== barIndex));
  };

  const {
    groups,
    saveNew,
    addVariant,
    overwrite,
    renameGroup,
    setNotes,
    removeVariant,
  } = usePatterns();

  const currentPattern: PatternState = {
    bpm,
    steps,
    bars: effectiveBars,
  };

  // Which variant the notes box is showing. Owned here rather than in either
  // list so selecting in one clears the other — only one pattern is loaded.
  const [noteTarget, setNoteTarget] = useState<NoteTarget>(null);

  const loadPattern = (pattern: PatternState, keepBpm = false) => {
    const newSteps = clamp(pattern.steps, MIN_STEPS, MAX_STEPS);
    if (!keepBpm) setBpm(pattern.bpm);
    setSteps(newSteps);
    // resizeGrid fills in the all-rest rows a stored pattern leaves out.
    setBars(pattern.bars.map((bar) => resizeGrid(bar, newSteps)));
  };

  const loadAndSelect = (pattern: PatternState, target: NoteTarget) => {
    // Variants of one family are the same rhythm, so flipping between them
    // holds whatever tempo you've dialed in; only crossing into another family
    // adopts that family's stored BPM.
    const sameFamily =
      noteTarget !== null && familyKey(target) === familyKey(noteTarget);
    loadPattern(pattern, sameFamily);
    setNoteTarget(target);
  };

  const { showSnackbar } = useSnackbar();

  // A shared pattern seeds the grid on arrival. It isn't a library or saved
  // entry, so it selects nothing — "Save as New" is how you keep it.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash.startsWith(SHARE_HASH_PREFIX)) {
      // Nothing shared and nothing on the grid — a first visit, or one whose
      // last action was Clear. Open on a random rhythm rather than an empty
      // grid, so there's always something to play.
      const silent = effectiveBars.every((bar) =>
        TRACKS.every(({ voice }) => bar[voice].every((on) => !on))
      );
      if (silent) {
        const { pattern, target } = randomLibraryPattern();
        // A deliberate one-time seed on mount, like the share import below.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        loadAndSelect(pattern, target);
      }
      return;
    }
    const pattern = deserializePattern(hash.slice(SHARE_HASH_PREFIX.length));
    if (!pattern) {
      showSnackbar("That share link could not be read");
      return;
    }
    loadPattern(pattern);
    showSnackbar("Pattern loaded from URL");
    // Drop the hash once imported — otherwise a reload after editing silently
    // reverts to the shared pattern.
    history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search
    );
    // Run once on mount: this reads the initial URL hash to seed state, and
    // must not re-run when the (unmemoized) setters change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sharePattern = async () => {
    const url = `${window.location.origin}${window.location.pathname}#${SHARE_HASH_PREFIX}${serializePattern(currentPattern)}`;
    try {
      await navigator.clipboard.writeText(url);
      showSnackbar("Pattern URL copied to clipboard");
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
      showSnackbar("Could not copy the pattern URL");
    }
  };

  const activeFlat = playing ? currentBeat : -1;

  return (
    <Paper className={styles.DrumPatterns} elevation={4}>
      {/* Title on the left, icon actions on the right — the same title line
          the classic frontend uses, so the two read as one app. */}
      <div className={styles.TitleLine}>
        <div>
          <Typography variant="h5" className={styles.Title}>
            Drum Pattern Library
          </Typography>
          <Typography variant="body1" className={styles.SubTitle}>
            a step sequencer and pattern library for darbuka strokes
          </Typography>
        </div>
        <div className={styles.TitleAction}>
          <Tooltip title="Copy a link to this pattern" {...ttConfig}>
            <IconButton aria-label="Share" onClick={sharePattern}>
              <ShareIcon />
            </IconButton>
          </Tooltip>
        </div>
        <div className={styles.TitleAction}>
          <IconButton
            aria-label="Settings"
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            <SettingsIcon />
          </IconButton>
        </div>
      </div>
      {/* Set-and-forget controls live behind the gear, keeping the rows below
          to what you touch while practicing. */}
      <div
        className={`${styles.SettingsGridWrapper} ${settingsOpen ? styles.Open : ""}`}
      >
        <div className={styles.Settings}>
          <div className={styles.SettingsInner}>
            {/* Two columns, each a label next to the control it names, so a
                setting and its widget never split across the fold. */}
            <Grid container spacing={4} sx={{ alignItems: "center" }}>
              <Grid size={6} className={styles.SettingsField}>
                <InputLabel htmlFor="volume-slider">Volume</InputLabel>
                <Slider
                  id="volume-slider"
                  sx={{ width: 140 }}
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={(_, newValue) => setVolume(newValue as number)}
                  aria-label="Volume"
                />
              </Grid>
              <Grid size={6} className={styles.SettingsField}>
                <InputLabel htmlFor="soundpack-select">Sound Pack</InputLabel>
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
              </Grid>
            </Grid>
          </div>
        </div>
      </div>
      <Divider className={settingsOpen ? styles.Invisible : ""} />
      {/* Tempo sits alone up here; transport lives with the other actions in
          the bottom row, the way the classic frontend arranges them. */}
      <Box className={`${styles.HorizontalGroup} ${styles.TempoRow}`}>
        <GlobalKeydownListener
          onKeyDown={modTempo(1 / 1.03)}
          keyFilter="ArrowLeft"
        />
        <GlobalKeydownListener onKeyDown={modTempo(1.03)} keyFilter="ArrowRight" />
        <div className={styles.ControlCluster}>
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
          <div>
            <Button onClick={handleTapTempoClick}>Tap Tempo</Button>
            <GlobalKeydownListener onKeyDown={handleTapTempoClick} keyFilter="/" />
          </div>
        </div>
      </Box>

      <Divider />

      {/* The library sits directly above the grid it loads into, so picking a
          rhythm and reading it back are one glance apart. */}
      <PatternLibrary
        groups={groups}
        target={noteTarget}
        onLoad={loadAndSelect}
        onAddVariant={(groupId) => addVariant(groupId, currentPattern)}
        onOverwrite={(groupId, variantId) =>
          overwrite(groupId, variantId, currentPattern)
        }
        onRenameGroup={renameGroup}
        onRemoveVariant={removeVariant}
      />
      <PatternNotes target={noteTarget} groups={groups} onSetNotes={setNotes} />

      <Divider />

      <Box className={styles.HorizontalGroup}>
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
        <div>
          <InputLabel htmlFor="count-input" sx={{ fontSize: 14 }}>
            Count
          </InputLabel>
          <Input
            className={styles.ShortNumberInput}
            type="number"
            size="small"
            id="count-input"
            inputProps={{ min: MIN_STEPS / 2, max: MAX_STEPS / 2 }}
            value={steps / 2}
            onChange={(event) =>
              handleCountChange(parseInt(event.target.value))
            }
          />
        </div>
        <div className={styles.Spacer} />
        <Button onClick={() => setNoteTarget(saveNew(currentPattern))}>
          Save as New
        </Button>
        <Button onClick={addBar} disabled={effectiveBars.length >= MAX_BARS}>
          Add Bar
        </Button>
        <Button onClick={clearGrid}>Clear</Button>
      </Box>

      {effectiveBars.map((bar, barIndex) => {
        const activeStep =
          activeFlat >= barIndex * steps && activeFlat < (barIndex + 1) * steps
            ? activeFlat - barIndex * steps
            : -1;
        return (
          <div key={barIndex}>
            <Box className={styles.BarHeader}>
              <Typography variant="caption" className={styles.BarTitle}>
                Bar {barIndex + 1}
              </Typography>
              <div className={styles.Spacer} />
              <Tooltip title="Duplicate bar" {...ttConfig}>
                <span>
                  <IconButton
                    size="small"
                    aria-label="Duplicate bar"
                    disabled={effectiveBars.length >= MAX_BARS}
                    onClick={() => duplicateBar(barIndex)}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Remove bar" {...ttConfig}>
                <span>
                  <IconButton
                    size="small"
                    aria-label="Remove bar"
                    disabled={effectiveBars.length === 1}
                    onClick={() => removeBar(barIndex)}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
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
                      {stepLabel(index)}
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
                    {bar[voice].map((on, index) => (
                      <button
                        key={index}
                        type="button"
                        aria-label={`Bar ${barIndex + 1} ${label} step ${index + 1}`}
                        aria-pressed={on}
                        onClick={() => toggleCell(barIndex, voice, index)}
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
          </div>
        );
      })}

      <Divider />

      <Typography variant="body2" className={styles.LibraryCredit}>
        Pattern library thanks to{" "}
        <a href="https://www.instagram.com/seantergis/">@seantergis</a>
        <br />
        Darbuka samples thanks to{" "}
        <a href="https://www.youtube.com/channel/UCcaZVRa_usGwiQaASFZSyOg">
          @ArtemUzunov
        </a>
      </Typography>

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

export default dynamic(() => Promise.resolve(DrumPatternLibrary), {
  ssr: false,
});
