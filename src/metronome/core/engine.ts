import {
  SoundPackId,
  SoundStatus,
  soundPacks,
  soundPackStatus,
} from "./soundpacks";
import { multiLength, multiIndex } from "./util";
import { Beat, Measures } from "./types";
import {
  Listener,
  Emitter,
  BeatNotifier,
  PlayingNotifier,
  SoundPackStatusNotifier,
} from "./emitter";

export type Rhythm = {
  beats: Measures;
  bpm: number;
};

export type SoundSpec = {
  volume: number;
  soundPack: SoundPackId;
  // Pitch multiplier applied at playback time via the source node's
  // playbackRate, rather than baked into the synthesized buffer.
  freqMultiplier: number;
};

export const DEFAULT_SOUND: SoundSpec = {
  volume: 1,
  soundPack: "default",
  freqMultiplier: 1,
};

export type MetronomeSpec = Rhythm & {
  // Sound is optional; omitted fields fall back to DEFAULT_SOUND. A frontend
  // that just wants the default click can pass only { bpm, beats }.
  sound?: Partial<SoundSpec>;
};

// Resolve a spec's (possibly partial / absent) sound against the defaults.
const resolveSound = (spec: MetronomeSpec): SoundSpec => ({
  ...DEFAULT_SOUND,
  ...spec.sound,
});

export class Metronome {
  // Definitely assigned in the constructor via ensureAudioContext(), which
  // TypeScript can't trace — hence the assertions.
  audioContext!: AudioContext;
  spec: MetronomeSpec;
  _latestScheduledBeatTime: number = 0;
  _startDelay: number = 0.01;
  _latestScheduledBeatIndex: number = -1;
  // Duration of the most recently scheduled beat, captured at schedule time so
  // the next beat's timing survives that beat being edited/deleted afterwards.
  _latestScheduledBeatDuration: number = 1;
  _schedulerInterval: number = 0.005;
  _schedulerHorizon: number = 0.05;
  _schedulerId: NodeJS.Timeout | null = null;
  _gainNode!: GainNode;

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
  // All pending beat-notification timeouts. Several beats can be scheduled in a
  // single look-ahead pass (fast tempos), so we track every timeout — otherwise
  // stop() can only cancel the last one and earlier notifications fire after stop.
  _beatNotifierIds: Set<NodeJS.Timeout> = new Set();
  _latestNotifiedBeat: number = -1;
  _beatNotifier: BeatNotifier = new Emitter();
  _playingNotifier: PlayingNotifier = new Emitter();

  // The current soundpack's aggregate load status, plus subscribers to it.
  // Deduped like beat notifications so we only emit on transitions.
  _soundPackStatusNotifier: SoundPackStatusNotifier = new Emitter();
  _latestSoundPackStatus: SoundStatus = "unloaded";

  constructor(spec: MetronomeSpec) {
    this.spec = spec;
    this.ensureAudioContext();
    this._warmSoundPackCache();
  }

  makeAudioContext(spec: MetronomeSpec) {
    const audioContext = new AudioContext({
      latencyHint: "interactive",
    });
    const gainNode = audioContext.createGain();
    gainNode.gain.value = resolveSound(spec).volume;
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
    this._gainNode.gain.value = resolveSound(spec).volume;
    this._warmSoundPackCache();
  }

  // Load this spec's click buffers up front, so the scheduler loop only ever
  // hits already-loaded Sounds instead of synthesizing/decoding a buffer
  // mid-schedule — which would risk a timing hitch on the audio path.
  _warmSoundPackCache = () => {
    const sound = resolveSound(this.spec);
    const pack = soundPacks[sound.soundPack];
    for (const clickSound of Object.values(pack)) {
      // Each load settles by re-evaluating whole-pack status rather than tracking
      // "both done" here, so the sounds can finish loading in any order and a
      // pack swap mid-load just re-evaluates against whatever pack is now current.
      // Aliased sounds (e.g. drums' strong === kick) get warmed twice — harmless,
      // load() is idempotent.
      clickSound.load(
        this.audioContext.sampleRate,
        this.audioContext,
        this._notifySoundPackStatus,
      );
    }
    // Capture the transition even when nothing settled synchronously — e.g.
    // switching to a not-yet-loaded pack must flip loaded → unloaded/loading now.
    this._notifySoundPackStatus();
  };

  // The aggregate load status of every Sound in the current pack.
  soundpackStatus(): SoundStatus {
    return soundPackStatus(soundPacks[resolveSound(this.spec).soundPack]);
  }

  _notifySoundPackStatus = () => {
    const status = this.soundpackStatus();
    if (status === this._latestSoundPackStatus) {
      return;
    }
    this._latestSoundPackStatus = status;
    this._soundPackStatusNotifier.emit(status);
  };

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
    this._latestScheduledBeatDuration = 1;
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
    for (const id of this._beatNotifierIds) {
      clearTimeout(id);
    }
    this._beatNotifierIds.clear();
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
    // Spacing to the next beat is the duration of the most recently scheduled
    // beat, captured when it was scheduled (in handleScheduler) rather than
    // re-read here — so it stays correct even if that beat is since deleted.
    return (
      this._latestScheduledBeatTime +
      (this._latestScheduledBeatDuration * 60) / this.spec.bpm
    );
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
      const nextBeat = multiIndex(this.spec.beats, nextBeatIndex);
      this.scheduleBeat(nextBeat, nextBeatTime);
      if (this._shouldNotifyBeatHit()) {
        const id = setTimeout(
          () => {
            this._beatNotifierIds.delete(id);
            this._notifyBeatHit(nextBeatIndex);
          },
          (nextBeatTime - currentTime) * 1000,
        );
        this._beatNotifierIds.add(id);
      }
      this._latestScheduledBeatTime = nextBeatTime;
      this._latestScheduledBeatIndex = nextBeatIndex;
      this._latestScheduledBeatDuration = nextBeat.duration ?? 1;
    }
  }

  scheduleBeat = (beat: Beat, time: number) => {
    // Empty voices = a silent beat; nothing to schedule.
    const sound = resolveSound(this.spec);
    const pack = soundPacks[sound.soundPack];
    for (const [i, voice] of beat.voices.entries()) {
      const clickSound = pack[voice];
      // Missing (a rhythm naming a sound this pack doesn't have) or not ready
      // yet (a sample pack still decoding) — skip this click rather than
      // crash. Both are deliberately silent: cross-pack rhythms degrade
      // instead of erroring, and accent rhythms never hit the missing case
      // since strong/weak are universal. Warming in _warmSoundPackCache means
      // synth packs are always loaded.
      if (!clickSound || !clickSound.isLoaded()) {
        continue;
      }
      const buffer = clickSound.getBuffer();

      // Create source from the loaded buffer. Pitch shifting happens here — playing
      // the buffer faster/slower scales all its frequencies by freqMultiplier —
      // so the buffer itself stays pack-neutral and shared across pitches.
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = sound.freqMultiplier;
      source.connect(this._gainNode);
      // Range offsets are sampled here, per schedule, rather than upstream in
      // the spec — the spec is static, so sampling any earlier would freeze
      // one draw and every repeat of the beat would land identically.
      const offsetSpec = beat.offsets?.[i] ?? 0;
      const offset = Array.isArray(offsetSpec)
        ? offsetSpec[0] + Math.random() * (offsetSpec[1] - offsetSpec[0])
        : offsetSpec;
      source.start(time + offset);

      // Track the source so stop() can cancel it if it's still pending, and
      // release it once it finishes playing on its own.
      this._scheduledSources.add(source);
      source.onended = () => {
        this._scheduledSources.delete(source);
        source.disconnect();
      };
    }
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

  subscribeToSoundPackStatus(callback: Listener<SoundStatus>) {
    this._soundPackStatusNotifier.subscribe(callback);
    // Replay the current status: a cached sample pack can finish loading in
    // the gap between construction (render) and the subscriber's effect, and
    // the transition-deduped notifier would otherwise never re-emit it —
    // leaving the subscriber stuck on the status it read at render time.
    callback(this.soundpackStatus());
  }

  unsubscribeFromSoundPackStatus(callback: Listener<SoundStatus>) {
    this._soundPackStatusNotifier.unsubscribe(callback);
  }
}
