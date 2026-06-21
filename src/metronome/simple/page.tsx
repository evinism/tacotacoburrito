"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";

import { usePersistentState } from "@/hooks";
import { useMetronome } from "@/metronome/shared/usemetronome";
import { useTapTempo } from "@/metronome/shared/usetaptempo";
import { MetronomeSpec } from "@/metronome/core/engine";
import { scaleBPM, invScaleBPM, TEMPO_SLIDER_MAX } from "@/metronome/core/tempo";
import { Measures } from "@/metronome/core/types";
import GlobalKeydownListener from "@/metronome/shared/globalkeydownlistener";

import styles from "./simple.module.css";

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

// A tempo-only metronome: a single steady click repeating at the chosen BPM.
const beats: Measures = [[{ strength: "strong", duration: 1 }]];

const ttConfig = {
  enterDelay: 500,
};

const SimpleMetronome = () => {
  const [bpm, setBpm] = usePersistentState<number>("simple/bpm", 120);

  const spec: MetronomeSpec = useMemo(() => ({ bpm, beats }), [bpm]);

  const { metronome, playing } = useMetronome(spec);

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

  return (
    <Paper className={styles.Simple} elevation={4}>
      <Typography variant="h5" className={styles.Title}>
        TacoTacoBurrito
      </Typography>
      <Typography variant="body1" className={styles.SubTitle}>
        a simple metronome for simple times
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

export default dynamic(() => Promise.resolve(SimpleMetronome), {
  ssr: false,
});
