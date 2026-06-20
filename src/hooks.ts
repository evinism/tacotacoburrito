import { useState, useMemo, useEffect } from "react";
import { MetronomeSpec, Metronome } from "./metronome/core/engine";

export const usePersistentState = <T = any>(
  key: string,
  initial: T,
  pollInterval: number = 0
): [T, (newState: T) => void] => {
  const getStoredOrInitial = () =>
    JSON.parse(localStorage.getItem(lsKey) || JSON.stringify(initial));
  const lsKey = `persistentState/${key}`;
  const internalInitial = useMemo(getStoredOrInitial, [lsKey, initial]);

  const [state, setInternalState] = useState<T>(internalInitial);
  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    if (pollInterval > 0) {
      intervalId = setInterval(
        () => setInternalState(getStoredOrInitial()),
        pollInterval
      );
    }
    return () => {
      if (pollInterval > 0) {
        clearInterval(intervalId);
      }
    };
  }, [pollInterval]);
  const setState = (newState: T) => {
    setInternalState(newState);
    localStorage.setItem(lsKey, JSON.stringify(newState));
  };

  return [state, setState];
};

export const useMetronome = (spec: MetronomeSpec) => {
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
