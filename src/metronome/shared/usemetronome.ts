import { useState, useEffect } from "react";
import { MetronomeSpec, Metronome } from "@/metronome/core/engine";
import { SoundStatus } from "@/metronome/core/soundpacks";

// Bridges the (framework-agnostic) engine to React: holds a stable Metronome
// instance, pushes spec updates into it, and surfaces beat/playing state.
export const useMetronome = (spec: MetronomeSpec) => {
  const [metronome] = useState<Metronome>(() => new Metronome(spec));
  metronome.updateSpec(spec);

  const [beat, setBeat] = useState<number>(metronome.getBeat());
  const [playing, setPlaying] = useState<boolean>(metronome.isPlaying());
  const [soundPackStatus, setSoundPackStatus] = useState<SoundStatus>(
    metronome.soundpackStatus()
  );
  useEffect(() => {
    const beatCallback = (beatNumber: number) => {
      setBeat(beatNumber);
    };
    metronome.subscribeToBeat(beatCallback);
    const playingCallback = (playing: boolean) => {
      setPlaying(playing);
    };
    metronome.subscribeToPlaying(playingCallback);
    const soundPackStatusCallback = (status: SoundStatus) => {
      setSoundPackStatus(status);
    };
    metronome.subscribeToSoundPackStatus(soundPackStatusCallback);

    return () => {
      metronome.unsubscribeFromBeat(beatCallback);
      metronome.unsubscribeFromPlaying(playingCallback);
      metronome.unsubscribeFromSoundPackStatus(soundPackStatusCallback);
    };
  }, [metronome]);

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
    soundPackStatus,
  };
};

export default useMetronome;
