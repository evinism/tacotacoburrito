import { useEffect, useState } from "react";
import { MetronomeSpec, Metronome } from "./core/engine";

const useMetronome = (spec: MetronomeSpec) => {
  const [metronome] = useState<Metronome>(() => new Metronome(spec));
  metronome.updateSpec(spec);

  const [beat, setBeat] = useState<number>(metronome.getBeat());
  const [playing, setPlaying] = useState<boolean>(metronome.isPlaying());
  useEffect(() => {
    const beatCallback = (beatNumber: number) => {
      setBeat(beatNumber);
    };
    metronome.subscribeToBeat(beatCallback);
    const playingCallback = (playing: boolean) => {
      setPlaying(playing);
    };
    metronome.subscribeToPlaying(playingCallback);

    return () => {
      metronome.unsubscribeFromBeat(beatCallback);
      metronome.unsubscribeFromPlaying(playingCallback);
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      metronome.cleanup();
    };
  }, [metronome]);

  return {
    metronome,
    beat,
    playing,
  };
};

export default useMetronome;
