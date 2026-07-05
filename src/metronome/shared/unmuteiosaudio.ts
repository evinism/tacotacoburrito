// iOS mutes Web Audio when the hardware silent switch is on. The workaround
// (adapted from feross/unmute-ios-audio, MIT) is to play a looping, silent
// HTML5 <audio> element on the first user gesture: HTML5 audio ignores the
// silent switch, and keeping one playing flips the whole page's audio session
// into the "playback" category so subsequent Web Audio is heard too.
//
// The engine already resumes its AudioContext on play(), so this module only
// handles the HTML5-audio half of the trick. Call install() once, early, from
// a client-only effect.

const USER_ACTIVATION_EVENTS = [
  "auxclick",
  "click",
  "contextmenu",
  "dblclick",
  "keydown",
  "keyup",
  "mousedown",
  "mouseup",
  "touchend",
] as const;

// Module-level so the looping element is never garbage collected while it must
// keep the audio session alive, and so install() is idempotent.
let installed = false;
let keepAlive: HTMLAudioElement | null = null;

// A ~7-sample, 8-bit mono WAVE file whose header matches the device sample rate.
// Mirrors feross's construction: the middle bytes encode the sample rate.
function createSilentAudioFile(sampleRate: number): string {
  const arrayBuffer = new ArrayBuffer(10);
  const dataView = new DataView(arrayBuffer);

  dataView.setUint32(0, sampleRate, true);
  dataView.setUint32(4, sampleRate, true);
  dataView.setUint16(8, 1, true);

  const middle = window
    .btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
    .slice(0, 13);

  return `data:audio/wav;base64,UklGRisAAABXQVZFZm10IBAAAAABAAEA${middle}AgAZGF0YQcAAACAgICAgICAAAA=`;
}

export function installIosAudioUnmute(): void {
  if (installed || typeof window === "undefined") return;

  const WebkitAudioContext = (
    window as unknown as { webkitAudioContext?: typeof AudioContext }
  ).webkitAudioContext;

  // Only iOS Safari needs (and honors) this trick: a touch device that still
  // exposes the prefixed webkitAudioContext.
  const isIos = navigator.maxTouchPoints > 0 && WebkitAudioContext != null;
  if (!isIos) return;

  installed = true;

  const sampleRate = new WebkitAudioContext().sampleRate;
  const silentAudioFile = createSilentAudioFile(sampleRate);

  const cleanup = () => {
    USER_ACTIVATION_EVENTS.forEach((eventName) => {
      window.removeEventListener(eventName, handleUserActivation, {
        capture: true,
      });
    });
  };

  const handleUserActivation = () => {
    if (keepAlive) return;

    const audio = document.createElement("audio");
    audio.setAttribute("x-webkit-airplay", "deny");
    audio.preload = "auto";
    audio.loop = true;
    audio.src = silentAudioFile;
    audio.load();

    audio.play().then(
      () => {
        keepAlive = audio;
        cleanup();
      },
      () => {
        // Gesture didn't count (e.g. programmatic); leave listeners in place to
        // retry on the next real interaction.
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
    );
  };

  USER_ACTIVATION_EVENTS.forEach((eventName) => {
    window.addEventListener(eventName, handleUserActivation, {
      capture: true,
      passive: true,
    });
  });
}
