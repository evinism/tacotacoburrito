type FreqSampleFnOptions = {
  duration: number;
  noise: number;
};

const makeFreqSampleFn =
  (freqSpec: number[], options: Partial<FreqSampleFnOptions> = {}) =>
  (sampleRate: number, audioCtx: AudioContext): AudioBuffer => {
    const { duration = 0.05, noise = 0 } = options;

    // Pitch shifting now happens at playback (source.playbackRate), so the
    // buffer is always synthesized at the pack's base frequencies.
    const freqs = freqSpec;

    // Mono: the gain node feeds the destination directly with no panning, so a
    // second channel would just duplicate the data (double the memory + sine work).
    const myArrayBuffer = audioCtx.createBuffer(
      1,
      sampleRate * duration,
      sampleRate,
    );

    // Fill the buffer with white noise;
    //just random values between -1.0 and 1.0
    for (let channel = 0; channel < myArrayBuffer.numberOfChannels; channel++) {
      // This gives us the actual ArrayBuffer that contains the data
      const nowBuffering = myArrayBuffer.getChannelData(channel);
      for (let i = 0; i < myArrayBuffer.length; i++) {
        // Math.random() is in [0; 1.0]
        // audio needs to be in [-1.0; 1.0]

        let nextValue =
          freqs
            .map((freq) => Math.sin((2 * Math.PI * freq * i) / sampleRate))
            .reduce((a, b) => a + b, 0) / freqs.length;

        if (noise) {
          nextValue += (Math.random() - 0.5) * noise;
        }

        nowBuffering[i] = nextValue;
      }
    }

    return myArrayBuffer;
  };

const cluster = (bottom: number, top: number, count: number) => {
  const range = top - bottom;
  const step = range / count;
  return Array(count)
    .fill(undefined)
    .map((_, index) => bottom + index * step);
};

// Produces the click buffer for a Sound. May be synchronous (synthesized packs)
// or async (sample packs that fetch + decode a file).
type SoundLoader = (
  sampleRate: number,
  audioCtx: AudioContext,
) => AudioBuffer | Promise<AudioBuffer>;

// Where a Sound is in its load lifecycle:
//   unloaded — no buffer yet (initial state, or after unload())
//   loading  — an async loader is in flight
//   loaded   — buffer is ready to play at `loadedSampleRate`
//   error    — the last load attempt failed; load() will retry
export type SoundStatus = "unloaded" | "loading" | "loaded" | "error";

// A single click buffer plus its load lifecycle. The instance is the cache: it
// holds exactly one buffer, (re)built for whatever sample rate it's loaded at.
export class Sound {
  private buffer?: AudioBuffer;
  private loadedSampleRate?: number;
  private _status: SoundStatus = "unloaded";

  constructor(private readonly loader: SoundLoader) {}

  status(): SoundStatus {
    return this._status;
  }

  isLoaded(): boolean {
    return this._status === "loaded";
  }

  // Ensure the buffer is available for `sampleRate`, invoking `cb` once the load
  // settles — whether it succeeds or fails, so callers can react to the new
  // status either way. Already-loaded (at this sample rate) settles
  // synchronously; a synchronous loader also settles in this same tick, so synth
  // packs stay fully sync.
  load(sampleRate: number, audioCtx: AudioContext, cb?: () => void): void {
    if (this._status === "loaded" && this.loadedSampleRate === sampleRate) {
      cb?.();
      return;
    }
    if (this._status === "loading") {
      return;
    }

    const result = this.loader(sampleRate, audioCtx);
    if (result instanceof Promise) {
      this._status = "loading";
      result
        .then((buffer) => {
          this.buffer = buffer;
          this.loadedSampleRate = sampleRate;
          this._status = "loaded";
          cb?.();
        })
        .catch((err) => {
          this._status = "error";
          console.error("Failed to load sound", err);
          cb?.();
        });
    } else {
      this.buffer = result;
      this.loadedSampleRate = sampleRate;
      this._status = "loaded";
      cb?.();
    }
  }

  // Caller must check isLoaded() first — throws if the buffer isn't ready.
  getBuffer(): AudioBuffer {
    if (!this.buffer) {
      throw new Error("Sound.getBuffer() called before the sound was loaded");
    }
    return this.buffer;
  }

  // Release the buffer so its memory can be reclaimed; load() rebuilds on demand.
  unload(): void {
    this.buffer = undefined;
    this.loadedSampleRate = undefined;
    this._status = "unloaded";
  }
}

export type SoundPack = {
  strong: Sound;
  weak: Sound;
};

// Aggregate a whole pack's load lifecycle into one status. A pack is only
// "loaded" once every Sound in it is; a single failure or in-flight load
// dominates so callers can gate playback / show a spinner off one value.
export function soundPackStatus(pack: SoundPack): SoundStatus {
  const statuses = [pack.strong.status(), pack.weak.status()];
  if (statuses.includes("error")) return "error";
  if (statuses.includes("loading")) return "loading";
  if (statuses.every((s) => s === "loaded")) return "loaded";
  return "unloaded";
}

// A loader that fetches an audio file and decodes it into a buffer.
const fileLoader =
  (url: string): SoundLoader =>
  async (_sampleRate: number, audioCtx: AudioContext) => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch sound "${url}": ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return audioCtx.decodeAudioData(arrayBuffer);
  };


export type SoundPackId = keyof typeof soundPacks;

const defaultSoundPack: SoundPack = {
  strong: new Sound(makeFreqSampleFn(cluster(2093, 2113, 6))),
  weak: new Sound(makeFreqSampleFn(cluster(1046, 1066, 6))),
};

// TODO: Make it so we might be able to adjust the base frequency
// within a sound pack, rather than having to make a new sound pack
export const soundPacks = {
  default: defaultSoundPack,
  inverted: {
    strong: defaultSoundPack.weak,
    weak: defaultSoundPack.strong,
  },
  dirac: {
    strong: new Sound((sampleRate: number, audioCtx: AudioContext) => {
      const buffer = audioCtx.createBuffer(1, 1, sampleRate);
      buffer.getChannelData(0)[0] = 1;
      return buffer;
    }),
    weak: new Sound((sampleRate: number, audioCtx: AudioContext) => {
      const buffer = audioCtx.createBuffer(1, 1, sampleRate);
      buffer.getChannelData(0)[0] = 0.5;
      return buffer;
    }),
  },
  doumbek: {
    strong: new Sound(fileLoader("/sounds/doumbek/hi.wav")),
    weak: new Sound(fileLoader("/sounds/doumbek/low.wav")),
  },
};
