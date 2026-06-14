<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Technical overview

**TacoTacoBurrito** (tacotacoburrito.com) is a browser metronome built for complex/odd time signatures — "a simple metronome for not-so-simple times." It supports per-beat accents (strong/weak/off), per-beat durations, and multiple measures of differing lengths.

## Stack
- Next.js 16 (App Router) + React 19, TypeScript, MUI 9 (`@mui/material`, dark theme) with Emotion.
- No backend, no DB, no tests. State lives in React + `localStorage`; rhythms shared via URL hash. Deployed on Vercel; Google Analytics via `@next/third-parties`.
- Scripts: `npm run dev`, `npm run build`, `npm start`, `npm run lint` (ESLint flat config).

## Layout
- `src/app/` — App Router shell. `layout.tsx` (metadata, MUI cache provider, GA), `page.tsx` renders `src/metronome`. `globals.css`.
- `src/metronome/` — the entire app.
  - `metronome.ts` — **core audio engine** (`Metronome` class). Web Audio `AudioContext` look-ahead scheduler: a `setInterval` loop (`handleScheduler`, every `_schedulerInterval` ≈ 5ms) schedules clicks up to `_schedulerHorizon` ≈ 50ms ahead, for precise timing decoupled from JS timer jitter. A single context is reused across play/stop: `play()` resumes it, `stop()` suspends it and cancels in-flight `_scheduledSources` so pending clicks don't sound; the context is only `close()`d in `cleanup()` (unmount). Emits "current beat" via `setTimeout` so the UI can highlight (suppressed at ≥10000 BPM, see `_shouldNotifyBeatHit`).
  - `usemetronome.ts` — `useMetronome(spec)` hook bridging the engine to React (holds a stable instance, calls `updateSpec`, subscribes to beat events, cleans up on unmount).
  - `emitter.ts` — tiny generic pub/sub `Emitter<T>` used for beat (`BeatNotifier`) and playing-state (`PlayingNotifier`) notifications.
  - `soundpacks.ts` — generates click `AudioBuffer`s from sine-frequency clusters (memoized per sampleRate+params). Packs: `default`, `inverted`, `dirac`. `freqMultiplier` shifts pitch.
  - `types.ts` — `BeatStrength` (`strong`/`weak`/`off`), `Beat` (`{strength, duration}`), `Measure`/`Measures` (nested arrays), `BeatFillMethod`.
  - `presetstore.ts` — built-in rhythm library (Greek/Balkan/Turkish/etc. odd meters).
  - `util.ts` — math/stats helpers + **multi-array** helpers (`multiLength`, `multiIndex`, `toSplitIndex`) that treat `Measures` (array-of-arrays) as one flat indexable beat sequence.
  - `smarttap/` — **rhythm inference** from tap timing. `methodone.ts` is a heuristic scorer pipeline: generate candidate cycles → score by timing/strength consistency & subdivision quality → quantize to a beat grid → reduce (halves/thirds) to a minimal pattern, returning a `Result<{beats, tempo}>` (i.e. `{value: {beats, tempo}, confidence}` or `undefined`).
  - `components/` — UI. `metronome.tsx` is the top-level component (owns `beats`/`bpm`/`volume`/etc. state, builds the `MetronomeSpec` memo, share/load via base64 URL hash `#rhythm-...`, play/clear). Others: tempo, measures grid (`measurecomponent`/`measuressection`), measure-spec input (`4+3+2`), `smarttap.tsx` (Tap Rhythm; `,`/`.` keys mark strong/weak), settings, presets/keybinds modals, and global keyboard/long-press listeners. Spacebar toggles play.

## Conventions & gotchas
- Lowercase, no-separator filenames (`measureinputsection.tsx`).
- The metronome component is `dynamic(..., { ssr: false })` — it depends on `AudioContext`/`window`/`localStorage`, so keep browser-only code out of SSR.
- A `MetronomeSpec` (rhythm + bpm + sound) is the single source of truth fed to the engine; mutate via the React state setters in `metronome.tsx`, not the engine directly.
- Persisted settings use `usePersistentState` (`src/hooks.ts`) → `localStorage` under `persistentState/<key>`.
