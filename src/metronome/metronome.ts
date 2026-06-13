import { SoundPackId, soundPacks, GeneratorParameters } from "./soundpacks";
import { multiLength, multiIndex } from "./util";
import { BeatStrength, Measures } from "./types";
import { Listener, Emitter, BeatNotifier, PlayingNotifier } from "./emitter";

export type Rhythm = {
  beats: Measures;
  bpm: number;
};

export type MetronomeSpec = Rhythm & {
  sound: {
    volume: number;
    soundPack: SoundPackId;
    playbackRate: number;
    // Intentionally vague. Params passed to the generator.
    generatorParameters: GeneratorParameters;
  };
};

export class Metronome {
  audioContext: AudioContext;
  spec: MetronomeSpec;
  _latestScheduledBeatTime: number;
  _startDelay: number = 0.01;
  _latestScheduledBeatIndex: number = -1;
  _schedulerInterval: number = 0.005;
  _schedulerHorizon: number = 0.05;
  _schedulerId: NodeJS.Timeout | null = null;
  _gainNode: GainNode;

  // Whether the user has asked the metronome to play. Our own source of truth,
  // set synchronously in play()/stop(), rather than the async
  // audioContext.state which lags behind suspend()/resume().
  _isPlaying: boolean = false;

  // Beats scheduled within the look-ahead horizon that haven't finished yet.
  // Keeping references lets stop() cancel in-flight clicks without tearing down
  // the whole audio context.
  _scheduledSources: Set<AudioBufferSourceNode> = new Set();

  // Source of truth for what beats have played is the audioContext,
  // which is outside of the scheduler loop (and we probably shouldn't
  // poll it) so we need to keep track of what beats have played ourselves
  _beatNotifierId: NodeJS.Timeout | null = null;
  _latestNotifiedBeat: number = -1;
  _beatNotifier: BeatNotifier = new Emitter();
  _playingNotifier: PlayingNotifier = new Emitter();

  constructor(spec: MetronomeSpec) {
    this.spec = spec;
    this.ensureAudioContext();
  }

  makeAudioContext(spec: MetronomeSpec) {
    const audioContext = new AudioContext({
      latencyHint: "interactive",
    });
    const gainNode = audioContext.createGain();
    gainNode.gain.value = spec.sound.volume;
    gainNode.connect(audioContext.destination);
    audioContext.suspend();
    return { audioContext, gainNode };
  }

  ensureAudioContext() {
    // Ensure we have a valid audio context, ready to resume. Rebuild it when
    // missing (first construction) or closed — the latter happens when a prior
    // cleanup() ran but this instance was reused (React StrictMode's
    // mount→unmount→remount in dev, or Fast Refresh).
    if (!this.audioContext || this.audioContext.state === "closed") {
      const { audioContext, gainNode } = this.makeAudioContext(this.spec);
      this.audioContext = audioContext;
      this._gainNode = gainNode;
    }
  }

  updateSpec(spec: MetronomeSpec) {
    if (spec == this.spec) {
      return;
    }
    if (isNaN(spec.bpm) || spec.bpm <= 0) {
      console.error("Invalid BPM", spec.bpm);
      return;
    }
    if (multiLength(spec.beats) < 1) {
      console.error("Invalid beats", spec.beats);
      return;
    }

    if (!this._shouldNotifyBeatHit() && this._latestNotifiedBeat !== -1) {
      // Clear the beat notifier, because beat notification is kind of useless
      // at insane tempos.
      this._notifyBeatHit(-1);
    }
    this.spec = spec;
    this._gainNode.gain.value = spec.sound.volume;
  }

  getBeat() {
    return this._latestNotifiedBeat;
  }

  reset() {
    this.stop();
    this.play();
  }

  isPlaying() {
    return this._isPlaying;
  }

  play() {
    if (this._isPlaying) {
      return;
    }
    this._isPlaying = true;
    this.ensureAudioContext();

    // The context sits suspended while idle, so resume it. resume() must run
    // inside a user gesture, which play() always is (button click / spacebar).
    this.audioContext.resume();

    this._latestScheduledBeatTime =
      this.audioContext.currentTime + this._startDelay - 60 / this.spec.bpm;
    this._latestScheduledBeatIndex = -1;
    this.handleScheduler();
    if (this._schedulerId) {
      clearInterval(this._schedulerId);
    }
    this._schedulerId = setInterval(
      () => this.handleScheduler(),
      this._schedulerInterval * 1000,
    );
    this._playingNotifier.emit(true);
    // Notify the first beat immediately. At fast tempos the scheduled
    // notification can get swallowed by the render cycle, so emit it up front;
    // the dedup in _notifyBeatHit keeps the scheduler from emitting it again.
    if (this._shouldNotifyBeatHit()) {
      this._notifyBeatHit(0);
    }
  }

  stop() {
    if (!this._isPlaying) {
      return;
    }
    this._isPlaying = false;
    if (this._schedulerId) {
      clearInterval(this._schedulerId);
      this._schedulerId = null;
    }
    if (this._beatNotifierId) {
      clearTimeout(this._beatNotifierId);
      this._beatNotifierId = null;
    }
    // Cancel beats already scheduled within the look-ahead horizon so they
    // don't sound after stop. Closing the context used to do this for us, but
    // we now keep the context around to reuse it.
    this._clearScheduledSources();
    // Suspend rather than close so the same context can be resumed on replay.
    this.audioContext.suspend();
    // unset which beat is hit
    this._notifyBeatHit(-1);
    this._playingNotifier.emit(false);
  }

  cleanup() {
    // Stop if playing (clears intervals/timeouts, cancels scheduled clicks).
    if (this._isPlaying) {
      this.stop();
    }
    // Make sure nothing is left scheduled, then permanently close the context —
    // this instance is being thrown away (component unmount).
    this._clearScheduledSources();
    if (this.audioContext.state !== "closed") {
      this.audioContext.close();
    }
  }

  nextBeatToScheduleTime = () => {
    // Duration is based on the most recently scheduled beat
    let duration = 1;
    const numBeats = multiLength(this.spec.beats);
    const index = this._latestScheduledBeatIndex;
    // BUG: If the last beat is deleted while we're on it,
    // then its (now-deleted) duration won't be respected.
    // you could fix it by like... making member _latestScheduledBeatDuration.
    // I do not care enough to fix this.
    if (index >= 0 && index < numBeats) {
      const latest = multiIndex(this.spec.beats, index);
      if (latest && latest.duration !== undefined) {
        duration = latest.duration;
      }
    }
    return this._latestScheduledBeatTime + (duration * 60) / this.spec.bpm;
  };

  nextBeatToScheduleIndex = () => {
    const length = multiLength(this.spec.beats);
    // If the beat pattern was shortened while playing (e.g., from 8 beats to 4 beats),
    // reset to the start rather than jumping to an arbitrary position via modulo
    if (this._latestScheduledBeatIndex >= length) {
      return 0;
    }
    return (this._latestScheduledBeatIndex + 1) % length;
  };

  handleScheduler() {
    const currentTime = this.audioContext.currentTime;
    const horizon = currentTime + this._schedulerHorizon;
    while (this.nextBeatToScheduleTime() < horizon) {
      const nextBeatTime = this.nextBeatToScheduleTime();
      const nextBeatIndex = this.nextBeatToScheduleIndex();
      this.scheduleClick(
        multiIndex(this.spec.beats, nextBeatIndex).strength,
        nextBeatTime,
      );
      if (this._shouldNotifyBeatHit()) {
        this._beatNotifierId = setTimeout(
          () => this._notifyBeatHit(nextBeatIndex),
          (nextBeatTime - currentTime) * 1000,
        );
      }
      this._latestScheduledBeatTime = nextBeatTime;
      this._latestScheduledBeatIndex = nextBeatIndex;
    }
  }

  scheduleClick = (strength: BeatStrength, time: number) => {
    if (strength === "off") {
      return;
    }
    // Get buffer from soundpack (automatically cached via memoization)
    const buffer = soundPacks[this.spec.sound.soundPack][strength](
      this.audioContext.sampleRate,
      this.audioContext,
      this.spec.sound.generatorParameters,
    );

    // Create source from cached buffer
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this._gainNode);
    source.start(time);

    // Track the source so stop() can cancel it if it's still pending, and
    // release it once it finishes playing on its own.
    this._scheduledSources.add(source);
    source.onended = () => {
      this._scheduledSources.delete(source);
      source.disconnect();
    };
  };

  _clearScheduledSources = () => {
    // Snapshot then clear: stopping a source fires onended, which would mutate
    // the set while we iterate it.
    const sources = [...this._scheduledSources];
    this._scheduledSources.clear();
    for (const source of sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Source may have already finished; nothing to cancel.
      }
      source.disconnect();
    }
  };

  _notifyBeatHit = (beatNumber: number) => {
    // Don't notify the same beat twice in a row. This lets play() emit the
    // first beat up front (so it's highlighted immediately, even at fast
    // tempos) without the scheduler re-emitting that same beat a few
    // milliseconds later.
    if (beatNumber === this._latestNotifiedBeat) {
      return;
    }
    this._beatNotifier.emit(beatNumber);
    this._latestNotifiedBeat = beatNumber;
  };

  _shouldNotifyBeatHit() {
    return this.spec.bpm < 10000;
  }

  subscribeToBeat(callback: Listener<number>) {
    this._beatNotifier.subscribe(callback);
  }

  unsubscribeFromBeat(callback: Listener<number>) {
    this._beatNotifier.unsubscribe(callback);
  }

  subscribeToPlaying(callback: Listener<boolean>) {
    this._playingNotifier.subscribe(callback);
  }

  unsubscribeFromPlaying(callback: Listener<boolean>) {
    this._playingNotifier.unsubscribe(callback);
  }
}
