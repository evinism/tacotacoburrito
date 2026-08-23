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
  // Callbacks waiting on the in-flight load to settle. A single Sound is a
  // shared singleton, so multiple callers (e.g. a dead + a live Metronome
  // across StrictMode's remount) can each be waiting on the same load.
  private _pending: Array<() => void> = [];

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
      // A load is already in flight — possibly kicked off by a now-dead
      // Metronome (StrictMode's mount→unmount→remount, Fast Refresh). Queue
      // this caller so it's still notified when that load settles; dropping it
      // would leave the live instance stuck showing "loading" forever.
      if (cb) this._pending.push(cb);
      return;
    }

    const result = this.loader(sampleRate, audioCtx);
    if (result instanceof Promise) {
      this._status = "loading";
      if (cb) this._pending.push(cb);
      result
        .then((buffer) => {
          this.buffer = buffer;
          this.loadedSampleRate = sampleRate;
          this._status = "loaded";
          this._settle();
        })
        .catch((err) => {
          this._status = "error";
          console.error("Failed to load sound", err);
          this._settle();
        });
    } else {
      this.buffer = result;
      this.loadedSampleRate = sampleRate;
      this._status = "loaded";
      cb?.();
    }
  }

  // Fire and clear every callback waiting on the just-settled load.
  private _settle(): void {
    const pending = this._pending;
    this._pending = [];
    for (const cb of pending) cb();
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

// Every pack must provide `strong`/`weak` (possibly aliasing its own sounds)
// so any pack works in accent-based frontends; other keys are pack-specific
// sound names (e.g. drums' `kick`/`snare`/`hihat`).
export type SoundPack = { strong: Sound; weak: Sound } & Record<string, Sound>;

// Aggregate a whole pack's load lifecycle into one status. A pack is only
// "loaded" once every Sound in it is; a single failure or in-flight load
// dominates so callers can gate playback / show a spinner off one value.
// Aliased sounds (e.g. drums' strong === kick) get visited twice here — that's
// harmless since `status()` is a cheap read and `load()` is idempotent.
export function soundPackStatus(pack: SoundPack): SoundStatus {
  const statuses = Object.values(pack).map((sound) => sound.status());
  if (statuses.includes("error")) return "error";
  if (statuses.includes("loading")) return "loading";
  if (statuses.every((s) => s === "loaded")) return "loaded";
  return "unloaded";
}

// Cheap exponential-decay envelope shared by the drum loaders below.
const expDecay = (i: number, sampleRate: number, timeConstant: number) =>
  Math.exp(-i / (sampleRate * timeConstant));

// Kick: a sine sweeping from `startFreq` down to `endFreq`, phase-accumulated
// sample-by-sample so the sweep stays click-free (a fixed-freq buffer can't
// express this, hence a bespoke loader instead of extending makeFreqSampleFn).
const makeKick =
  (
    duration = 0.2,
    startFreq = 150,
    endFreq = 50,
    decayTimeConstant = 0.05,
  ): SoundLoader =>
  (sampleRate: number, audioCtx: AudioContext): AudioBuffer => {
    const buffer = audioCtx.createBuffer(1, sampleRate * duration, sampleRate);
    const data = buffer.getChannelData(0);
    const freqRatio = endFreq / startFreq;
    let phase = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      // Exponential sweep: frequency at time t is startFreq * ratio^t.
      const freq = startFreq * Math.pow(freqRatio, t);
      phase += (2 * Math.PI * freq) / sampleRate;
      data[i] = Math.sin(phase) * expDecay(i, sampleRate, decayTimeConstant);
    }
    return buffer;
  };

// Snare: white noise plus a ~200 Hz tone, each with its own decay, mixed down
// so the combined peak stays at/under 1.
const makeSnare =
  (
    duration = 0.15,
    toneFreq = 200,
    noiseDecay = 0.06,
    toneDecay = 0.03,
  ): SoundLoader =>
  (sampleRate: number, audioCtx: AudioContext): AudioBuffer => {
    const buffer = audioCtx.createBuffer(1, sampleRate * duration, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const noise = (Math.random() * 2 - 1) * expDecay(i, sampleRate, noiseDecay);
      const tone =
        Math.sin((2 * Math.PI * toneFreq * i) / sampleRate) *
        expDecay(i, sampleRate, toneDecay);
      data[i] = noise * 0.7 + tone * 0.3;
    }
    return buffer;
  };

// Hihat: very short, very fast-decaying noise burst. A real bandpass/highpass
// filter is overkill for a one-shot buffer, so a cheap first-difference
// (x[i] - x[i-1]) biases the noise's energy upward instead.
const makeHihat =
  (duration = 0.05, decayTimeConstant = 0.012): SoundLoader =>
  (sampleRate: number, audioCtx: AudioContext): AudioBuffer => {
    const buffer = audioCtx.createBuffer(1, sampleRate * duration, sampleRate);
    const data = buffer.getChannelData(0);
    let prev = 0;
    for (let i = 0; i < data.length; i++) {
      const noise = Math.random() * 2 - 1;
      const highPassed = (noise - prev) * 0.5;
      prev = noise;
      data[i] = highPassed * expDecay(i, sampleRate, decayTimeConstant);
    }
    return buffer;
  };

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
export const soundPacks: Record<string, SoundPack> = {
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
  darbuka: (() => {
    const doum = new Sound(fileLoader("/sounds/darbuka/doum.wav"));
    const te1 = new Sound(fileLoader("/sounds/darbuka/te1.wav"));
    const te2 = new Sound(fileLoader("/sounds/darbuka/te2.wav"));
    const ka1 = new Sound(fileLoader("/sounds/darbuka/ka1.wav"));
    const ka2 = new Sound(fileLoader("/sounds/darbuka/ka2.wav"));
    // strong/weak alias the accented bass stroke and the soft off-hand stroke.
    return { doum, te1, te2, ka1, ka2, strong: doum, weak: ka1 };
  })(),
  drums: (() => {
    const kick = new Sound(makeKick());
    const snare = new Sound(makeSnare());
    const hihat = new Sound(makeHihat());
    return { kick, snare, hihat, strong: kick, weak: snare };
  })(),
};

// Packs that used to ship, mapped to what replaced them: a persisted or shared
// setting naming one must still resolve to a real pack, since every lookup
// below feeds straight into `Object.values(pack)` / `pack[voice]`.
const RETIRED_PACKS: Record<string, SoundPackId> = { doumbek: "darbuka" };

// The only supported way to go from a pack id to a pack. Never returns
// undefined: an id from an older build (or a hand-edited localStorage value)
// falls back rather than crashing the audio path.
export const getSoundPack = (id: string): SoundPack =>
  soundPacks[id] ?? soundPacks[RETIRED_PACKS[id] ?? "default"];
