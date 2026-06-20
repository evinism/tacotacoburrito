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

## Architecture

The app is built to host **multiple swappable frontends** over one shared engine. Three layers under `src/metronome/`:
- **`core/`** — the React-free kernel (audio engine, rhythm types, sound synthesis, inference). No DOM beyond Web Audio.
- **`shared/`** — the React "kit" reused across frontends (engine↔React bridge, snackbar).
- **`<frontend>/`** — one folder per frontend UI. Currently just `classic/`; a new frontend is a sibling folder + its own App Router route.

Routing and the global shell live in `src/app/`; truly app-generic hooks live at `src/`.

## Layout
- `src/app/` — App Router routing + global shell.
  - `layout.tsx` — root **Server Component**: metadata (title `default`+`template`, `metadataBase`, OpenGraph), MUI cache provider (`AppRouterCacheProvider`), GA, and the backdrop wrapper (`.App`/`.Background` divs) around `{children}`.
  - `providers.tsx` — `"use client"` shell: MUI dark `ThemeProvider` + `CssBaseline` + `SnackbarProvider`. Split out because these need a Client Component while `layout.tsx` must stay a Server Component to export `metadata`.
  - `page.tsx` — `/`, renders the classic frontend.
  - `layout.module.css` (backdrop styles), `globals.css`.
- `src/hooks.ts` — `usePersistentState` (generic; no engine dependency).
- `src/metronome/core/` — the kernel.
  - `engine.ts` — **core audio engine** (`Metronome` class). Web Audio `AudioContext` look-ahead scheduler: a `setInterval` loop (`handleScheduler`, every `_schedulerInterval` ≈ 5ms) schedules clicks up to `_schedulerHorizon` ≈ 50ms ahead, for precise timing decoupled from JS timer jitter. A single context is reused across play/stop: `play()` resumes it, `stop()` suspends it and cancels in-flight `_scheduledSources` so pending clicks don't sound; the context is only `close()`d in `cleanup()` (unmount). Emits "current beat" via `setTimeout` so the UI can highlight (suppressed at ≥10000 BPM, see `_shouldNotifyBeatHit`). Defines `Rhythm` and `MetronomeSpec`.
  - `emitter.ts` — tiny generic pub/sub `Emitter<T>` used for beat (`BeatNotifier`) and playing-state (`PlayingNotifier`) notifications.
  - `soundpacks.ts` — generates click `AudioBuffer`s from sine-frequency clusters (memoized per sampleRate+params). Packs: `default`, `inverted`, `dirac`. `freqMultiplier` shifts pitch.
  - `types.ts` — `BeatStrength` (`strong`/`weak`/`off`), `Beat` (`{strength, duration}`), `Measure`/`Measures` (nested arrays), `BeatFillMethod`.
  - `presetstore.ts` — built-in rhythm library (Greek/Balkan/Turkish/etc. odd meters).
  - `util.ts` — math/stats helpers + **multi-array** helpers (`multiLength`, `multiIndex`, `toSplitIndex`) that treat `Measures` (array-of-arrays) as one flat indexable beat sequence.
  - `smarttap/` — **rhythm inference** from tap timing. `methodone.ts` is a heuristic scorer pipeline: generate candidate cycles → score by timing/strength consistency & subdivision quality → quantize to a beat grid → reduce (halves/thirds) to a minimal pattern, returning a `Result<{beats, tempo}>` (i.e. `{value: {beats, tempo}, confidence}` or `undefined`).
- `src/metronome/shared/` — cross-frontend React kit.
  - `usemetronome.ts` — `useMetronome(spec)` hook bridging the engine to React (holds a stable instance, calls `updateSpec`, subscribes to beat/playing events, cleans up on unmount).
  - `snackbar.tsx` — `SnackbarProvider` (owns the single app-wide `<Snackbar>`) + `useSnackbar()` hook. Mounted once in `app/providers.tsx`.
- `src/metronome/classic/` — the classic frontend.
  - `page.tsx` — top-level component (owns `beats`/`bpm`/`volume`/etc. state, builds the `MetronomeSpec` memo, share/load via base64 URL hash `#rhythm-...`, play/clear).
  - `classic.module.css` — this frontend's styles (content wrapper class is `.Classic`).
  - `components/` — tempo, measures grid (`measurecomponent`/`measuressection`), measure-spec input (`4+3+2`), `smarttap.tsx` (Tap Rhythm; `,`/`.` keys mark strong/weak), settings, presets/keybinds modals, global keyboard/long-press listeners. Spacebar toggles play.

## Conventions & gotchas
- Lowercase, no-separator filenames (`measureinputsection.tsx`).
- **Imports**: `./` for same-directory siblings, `@/…` (alias → `src/`) for anything that climbs out of the current directory. No `../` climbing imports.
- The classic frontend's top component (`classic/page.tsx`) is `dynamic(..., { ssr: false })` — it depends on `AudioContext`/`window`/`localStorage`, so keep browser-only code out of SSR. New frontends do the same.
- A `MetronomeSpec` (rhythm + bpm + sound) is the single source of truth fed to the engine; mutate via the React state setters in the frontend component, not the engine directly.
- Persisted settings use `usePersistentState` (`src/hooks.ts`) → `localStorage` under `persistentState/<key>`. Keys are a single global namespace shared across all frontends, so **prefix per-frontend keys with the frontend name** (e.g. `simple/bpm`, `classic/volume`) to avoid one frontend clobbering another's state. Only use a bare key (e.g. `bpm`) when you intentionally want the value shared across frontends. When renaming a key, pass the old key as the `migrateFrom` arg (4th param, after `pollInterval`) so existing saved values carry over: `usePersistentState("classic/bpm", 120, 0, "bpm")`.
- The global shell (dark theme + backdrop + snackbar) currently lives in `src/app/` and applies to every route. To give a frontend its own theme/backdrop, move the shell into a per-frontend route group (`app/(frontend)/layout.tsx`).
