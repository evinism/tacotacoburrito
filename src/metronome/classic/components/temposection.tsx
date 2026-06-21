import { memo } from "react";
import GlobalKeydownListener from "@/metronome/shared/globalkeydownlistener";
import { useTapTempo } from "@/metronome/shared/usetaptempo";
import {
  scaleBPM,
  invScaleBPM,
  TEMPO_SLIDER_MAX,
} from "@/metronome/core/tempo";

import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";

import styles from "@/metronome/classic/classic.module.css";

import {
  Button,
  Input,
  InputLabel,
  Slider,
  IconButton,
  Box,
  Tooltip,
} from "@mui/material";

const ttConfig = {
  enterDelay: 500,
};

interface TempoSectionProps {
  bpm: number;
  setBpm: (bpm: number) => void;
}

const TempoSection = ({ bpm, setBpm }: TempoSectionProps) => {
  const handleSliderChange = (_: Event, newValue: number | number[]) => {
    setBpm(scaleBPM(newValue as number));
  };
  const handleTapTempoClick = useTapTempo(setBpm);

  const modTempo = (fraction: number) => () => {
    setBpm(bpm * fraction);
  };
  return (
    <>
      <Box className={styles.HorizontalGroup}>
        <div>
          <InputLabel
            htmlFor="bpm-input"
            sx={{
              fontSize: 14,
            }}
          >
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
          <IconButton
            onClick={modTempo(1.03)}
            aria-label="Increase Tempo by 3%"
          >
            <AddIcon />
          </IconButton>
        </Tooltip>
        <GlobalKeydownListener
          onKeyDown={modTempo(1.03)}
          keyFilter="ArrowRight"
        />
        <div className={styles.Spacer} />
        <div>
          <Button onClick={handleTapTempoClick}>Tap Tempo</Button>
          <GlobalKeydownListener
            onKeyDown={handleTapTempoClick}
            keyFilter="/"
          />
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
    </>
  );
};

export const MemoizedTempoSection = memo(TempoSection);
