"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";

import { usePersistentState } from "@/hooks";
import { useMetronome } from "@/metronome/shared/usemetronome";
import { useTapTempo } from "@/metronome/shared/usetaptempo";
import { MetronomeSpec } from "@/metronome/core/engine";
import { scaleBPM, invScaleBPM, TEMPO_SLIDER_MAX } from "@/metronome/core/tempo";
import { Beat, Measure, Measures } from "@/metronome/core/types";
import GlobalKeydownListener from "@/metronome/shared/globalkeydownlistener";

import styles from "./skipmeasure.module.css";

import {
  Box,
  Button,
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

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const strong: Beat = { strength: "strong", duration: 1 };
const weak: Beat = { strength: "weak", duration: 1 };
const off: Beat = { strength: "off", duration: 1 };

// One audible measure (accent on beat 1) followed by all-silent measures.
const buildAudibleMeasure = (beatsPerMeasure: number): Measure =>
  Array.from({ length: beatsPerMeasure }, (_, i) => (i === 0 ? strong : weak));
const buildSilentMeasure = (beatsPerMeasure: number): Measure =>
  Array.from({ length: beatsPerMeasure }, () => off);

const SkipMeasureMetronome = () => {
  const [bpm, setBpm] = usePersistentState<number>("skipmeasure/bpm", 120);
  const [beatsPerMeasure, setBeatsPerMeasure] = usePersistentState<number>(
    "skipmeasure/beatsPerMeasure",
    4
  );
  const [playMeasures, setPlayMeasures] = usePersistentState<number>(
    "skipmeasure/playMeasures",
    1
  );
  const [silentMeasures, setSilentMeasures] = usePersistentState<number>(
    "skipmeasure/silentMeasures",
    1
  );

  const beats: Measures = useMemo(() => {
    const audible = buildAudibleMeasure(beatsPerMeasure);
    const silent = buildSilentMeasure(beatsPerMeasure);
    return [
      ...Array.from({ length: playMeasures }, () => audible),
      ...Array.from({ length: silentMeasures }, () => silent),
    ];
  }, [beatsPerMeasure, playMeasures, silentMeasures]);

  const spec: MetronomeSpec = useMemo(() => ({ bpm, beats }), [bpm, beats]);

  const { metronome, beat: currentBeat, playing } = useMetronome(spec);

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

  // currentBeat is a flat index across all measures (all equal length here).
  const activeMeasure = playing
    ? Math.floor(currentBeat / beatsPerMeasure)
    : -1;
  const activeBeatInMeasure = playing ? currentBeat % beatsPerMeasure : -1;
  const totalMeasures = playMeasures + silentMeasures;

  return (
    <Paper className={styles.SkipMeasure} elevation={4}>
      <Typography variant="h5" className={styles.Title}>
        Skip Measure Trainer
      </Typography>
      <Typography variant="body1" className={styles.SubTitle}>
        skip-measure trainer — play, then count the silence
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
          <InputLabel htmlFor="beats-input" sx={{ fontSize: 14 }}>
            Beats / measure
          </InputLabel>
          <Input
            className={styles.ShortNumberInput}
            type="number"
            size="small"
            id="beats-input"
            inputProps={{ min: 1, max: 32 }}
            value={beatsPerMeasure}
            onChange={(event) =>
              setBeatsPerMeasure(clamp(parseInt(event.target.value), 1, 32))
            }
          />
        </div>
        <div>
          <InputLabel htmlFor="play-input" sx={{ fontSize: 14 }}>
            Play measures
          </InputLabel>
          <Input
            className={styles.ShortNumberInput}
            type="number"
            size="small"
            id="play-input"
            inputProps={{ min: 1, max: 16 }}
            value={playMeasures}
            onChange={(event) =>
              setPlayMeasures(clamp(parseInt(event.target.value), 1, 16))
            }
          />
        </div>
        <div>
          <InputLabel htmlFor="silent-input" sx={{ fontSize: 14 }}>
            Silent measures
          </InputLabel>
          <Input
            className={styles.ShortNumberInput}
            type="number"
            size="small"
            id="silent-input"
            inputProps={{ min: 1, max: 16 }}
            value={silentMeasures}
            onChange={(event) =>
              setSilentMeasures(clamp(parseInt(event.target.value), 1, 16))
            }
          />
        </div>
      </Box>

      <div className={styles.MeasureGrid}>
        {Array.from({ length: totalMeasures }, (_, measureIndex) => {
          const isSilent = measureIndex >= playMeasures;
          const isActive = measureIndex === activeMeasure;
          return (
            <div
              key={measureIndex}
              className={[
                styles.Measure,
                isSilent ? styles.silent : "",
                isActive ? styles.activeMeasure : "",
              ].join(" ")}
            >
              {Array.from({ length: beatsPerMeasure }, (_, beatIndex) => (
                <div
                  key={beatIndex}
                  className={[
                    styles.Beat,
                    beatIndex === 0 && !isSilent ? styles.strong : "",
                    isActive && beatIndex === activeBeatInMeasure
                      ? styles.active
                      : "",
                  ].join(" ")}
                />
              ))}
            </div>
          );
        })}
      </div>
      <Typography variant="body2" className={styles.StatusLabel}>
        {playing
          ? activeMeasure >= playMeasures
            ? "Silent — keep counting!"
            : "Playing"
          : " "}
      </Typography>

      <Divider />

      <div className={styles.ButtonGroup}>
        <Button onClick={togglePlaying}>{playing ? "Stop" : "Play"}</Button>
        <GlobalKeydownListener onKeyDown={togglePlaying} keyFilter=" " />
      </div>
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

export default dynamic(() => Promise.resolve(SkipMeasureMetronome), {
  ssr: false,
});
