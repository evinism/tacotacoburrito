// Intentionally vague. Params passed to the generator.
export type GeneratorParameters = {
  [key: string]: any;
};

type FreqSampleFnOptions = {
  duration: number;
  noise: number;
  attack: number;
  decay: number;
  release: number;
  sustain: number;
};

const makeFreqSampleFn =
  (freqSpec: number[], options: Partial<FreqSampleFnOptions> = {}) =>
  (
    sampleRate: number,
    audioCtx: AudioContext,
    generatorsParams: GeneratorParameters,
  ): AudioBuffer => {
    const { duration = 0.05, noise = 0 } = options;
    const { freqMultiplier = 1 } = generatorsParams;

    const freqs = freqSpec.map((freq) => freq * freqMultiplier);

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
  };;

const cluster = (bottom, top, count) => {
  const range = top - bottom;
  const step = range / count;
  return Array(count)
    .fill(undefined)
    .map((_, index) => bottom + index * step);
};

type BufferConstructor = (
  sampleRate: number,
  audioCtx: AudioContext,
  audioGenParams: GeneratorParameters
) => AudioBuffer;

export type SoundPack = {
  strong: BufferConstructor;
  weak: BufferConstructor;
};

export type SoundPackId = keyof typeof soundPacks;

// Memoize buffer constructors to avoid regenerating buffers on every beat.
// Bounded LRU: continuous params (e.g. the freqMultiplier slider) would
// otherwise mint a new buffer per distinct value and grow the cache forever.
function memoizeBufferConstructor(
  constructor: BufferConstructor,
  maxSize = 32,
): BufferConstructor {
  const cache = new Map<string, AudioBuffer>();

  return (
    sampleRate: number,
    audioCtx: AudioContext,
    params: GeneratorParameters,
  ): AudioBuffer => {
    // Key by sample rate and parameters
    const key = `${sampleRate}-${JSON.stringify(params)}`;

    const existing = cache.get(key);
    if (existing) {
      // Refresh recency: re-insert so this key becomes the most recent.
      cache.delete(key);
      cache.set(key, existing);
      return existing;
    }

    const buffer = constructor(sampleRate, audioCtx, params);
    cache.set(key, buffer);
    if (cache.size > maxSize) {
      // Evict the least-recently-used entry (Map iterates in insertion order).
      cache.delete(cache.keys().next().value!);
    }
    return buffer;
  };
}

export const defaultSoundPack: SoundPack = {
  strong: memoizeBufferConstructor(makeFreqSampleFn(cluster(2093, 2113, 6))),
  weak: memoizeBufferConstructor(makeFreqSampleFn(cluster(1046, 1066, 6))),
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
    strong: memoizeBufferConstructor(
      (
        sampleRate: number,
        audioCtx: AudioContext,
        _: GeneratorParameters
      ): AudioBuffer => {
        const buffer = audioCtx.createBuffer(1, 1, sampleRate);
        buffer.getChannelData(0)[0] = 1;
        return buffer;
      }
    ),
    weak: memoizeBufferConstructor(
      (
        sampleRate: number,
        audioCtx: AudioContext,
        _: GeneratorParameters
      ): AudioBuffer => {
        const buffer = audioCtx.createBuffer(1, 1, sampleRate);
        buffer.getChannelData(0)[0] = 0.5;
        return buffer;
      }
    ),
  },
};
