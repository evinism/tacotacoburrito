// Benchmark for smart-tap rhythm inference.
//
//   npm run bench:smarttap -- [flags]
//   node --import ./scripts/tsalias.mjs scripts/smarttapbench.ts [flags]
//
// Takes every rhythm in the preset store as a known-answer "preimage", taps it
// out synthetically at a range of timing-jitter levels, runs inference over the
// resulting taps, and reports how often the metronome would play back what was
// tapped. Deterministic: the same --seed reproduces every trial exactly.
//
// Flags:
//   --method NAME       which inference method to run         [the shipped one]
//   --trials N          trials per grid cell                  [10]
//   --cycles N          how many times the pattern is tapped  [4]
//   --jitter a,b,c      timing-jitter sweep, ms sd            [5,10,20,40]
//   --tempo a,b,c       multipliers on each preset's own bpm  [0.5,0.75,1,1.5,2]
//   --drift a,b,c       tempo-walk sweep, sd per grid cell    [0,0.002,0.005,0.01,0.02]
//   --flat-accents      tap everything weak, as the button does
//   --seed N            base seed                             [1]
//   --miss F            probability a tap is dropped          [0]
//   --ghost F           probability of a stray extra tap      [0]
//   --accent-error F    probability strong/weak flips         [0]
//   --random N          arbitrary generated patterns to include [1/4 of corpus]
//   --case SUBSTR       only run cases whose name contains it
//   --json PATH         dump every trial for later plotting
//   --examples          print one worked failure per case

import { writeFileSync } from "node:fs";
import shippedMethod, {
  methods,
  type MethodName,
} from "@/metronome/core/smarttap";
import {
  generateTaps,
  makeRng,
  randomPreimage,
  toPreimage,
  type Humanization,
  type Preimage,
} from "@/metronome/core/smarttap/synth";
import {
  gradeRhythm,
  type Grade,
  type Verdict,
} from "@/metronome/core/smarttap/evaluate";
import { defaultPresetStore } from "@/metronome/core/presetstore";
import type { Beat } from "@/metronome/core/types";

// --- args ---------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const num = (name: string, fallback: number): number => {
  const raw = flag(name);
  return raw === undefined ? fallback : Number(raw);
};

// Per grid cell. Every reported table pools over the axes it doesn't show, so
// the count behind a printed figure is this times the pooled axes: 10 here puts
// 200 trials behind each case/jitter and each case/drift cell.
const TRIALS = num("trials", 10);

// Defaults to whatever the app ships, so a bare run reports what users get
// rather than a method nothing is pointed at.
const shipped = (Object.keys(methods) as MethodName[]).find(
  (name) => methods[name] === shippedMethod,
);
const METHOD = (flag("method") ?? shipped ?? "methodOne") as MethodName;
if (!(METHOD in methods)) {
  console.error(
    `Unknown --method ${METHOD}. Known: ${Object.keys(methods).join(", ")}`,
  );
  process.exit(1);
}
const inferRhythm = methods[METHOD];
const CYCLES = num("cycles", 4);
const SEED = num("seed", 1);
// Deliberately no 0 in the default sweep. Perfectly quantized taps are a
// degenerate input no human can produce, and they hit a tie-breaking path that
// nothing else does — a mere 0.5ms of jitter takes plain 4/4 from 0% to 100%.
// Leaving 0 in the default made the whole table read pessimistically. It's
// still worth probing on purpose, via --jitter 0.
const JITTERS = (flag("jitter") ?? "5,10,20,40").split(",").map(Number);
// Each preset carries its own tempo, and they range over 5x in grid-cell
// duration (667ms for 3/4 down to 133ms for Sedi Donka). Since jitter is
// absolute, that means a fixed jitter is a far bigger fraction of a fast
// rhythm's cell — so "hard rhythm" and "fast rhythm" are confounded unless the
// same rhythm is also run at other speeds. These are multipliers on the
// preset's own bpm, which keeps each rhythm musically plausible.
//
// The default spans 4x, centred on each preset's notated tempo, and stays
// inside the range the app's own tempo slider covers (40..800 bpm). Sweeping
// tempo by default matters because accuracy turns out to depend on it far more
// than on jitter. Push further out — `--tempo 0.25` — to probe the slow-tempo
// breakdown, at tempos below what the slider can reach.
const TEMPOS = (flag("tempo") ?? "0.5,0.75,1,1.5,2").split(",").map(Number);
// Tempo wander, swept as its own axis. Values are sd per grid cell and compound
// as sd*sqrt(cells), so they look tiny next to the other axes: by 0.02 the
// tapper is wandering ±13% over a performance. The top of the range is where
// accuracy actually halves — below ~0.005 drift costs only a few points.
// Grading uses each performance's realized tempo, so every level here is honest
// rather than penalising inference for tracking a tempo that genuinely moved.
const DRIFTS = (flag("drift") ?? "0,0.002,0.005,0.01,0.02").split(",").map(Number);
const CASE_FILTER = flag("case");
// The Tap Rhythm button reports every tap as "weak" — only the ,/. keys
// distinguish strong from weak. So the mouse path gives inference no accent
// information at all, and it's worth being able to model that.
const FLAT_ACCENTS = argv.includes("--flat-accents");
const JSON_OUT = flag("json");
const SHOW_EXAMPLES = argv.includes("--examples");

const baseHumanization: Omit<Humanization, "jitterMs" | "driftPerBeat"> = {
  missRate: num("miss", 0),
  ghostRate: num("ghost", 0),
  strengthErrorRate: num("accent-error", 0),
};

// --- corpus -------------------------------------------------------------

type BenchCase = { name: string; preimage: Preimage };

// Flattening the *preimage* (not just the taps) drops accents from the target
// as well as the input, so the run measures what's actually recoverable from a
// button-tapped performance: the timing, not the emphasis.
const flatten = (preimage: Preimage): Preimage => ({
  ...preimage,
  beats: preimage.beats.map((beat) => ({
    ...beat,
    voices: beat.voices.length === 0 ? [] : ["weak"],
  })),
});

const presetCases: BenchCase[] = Object.entries(defaultPresetStore).flatMap(
  ([topic, rhythms]) =>
    Object.entries(rhythms).map(([name, rhythm]) => ({
      name: `${topic}/${name}`,
      preimage: toPreimage(rhythm),
    })),
);

// Enough arbitrary patterns to make a quarter of the corpus, so the headline
// number isn't purely a measure of how well inference handles the two dozen
// dance rhythms that happen to ship with the app. Their own rng stream, keyed
// off --seed, so the drawn corpus is stable run to run but moves with the seed.
const RANDOM_COUNT = num("random", Math.round(presetCases.length / 3));
const randomRng = makeRng(SEED + 999983);
const randomCases: BenchCase[] = Array.from({ length: RANDOM_COUNT }, (_, i) => ({
  name: `Random/r${i + 1}`,
  preimage: randomPreimage(randomRng),
}));

const corpus: BenchCase[] = [...presetCases, ...randomCases]
  .map((benchCase) => ({
    ...benchCase,
    preimage: FLAT_ACCENTS ? flatten(benchCase.preimage) : benchCase.preimage,
  }))
  .filter(({ name }) => !CASE_FILTER || name.includes(CASE_FILTER));

if (corpus.length === 0) {
  console.error(`No cases matched --case ${CASE_FILTER}`);
  process.exit(1);
}

// --- running ------------------------------------------------------------

type Trial = {
  case: string;
  jitterMs: number;
  tempoMult: number;
  driftPerBeat: number;
  // What the performance actually ran at, once drift had its way, over the
  // nominal tempo it started from. 1 without drift.
  tempoWander: number;
  // Duration of one grid cell at this trial's tempo, and the jitter as a
  // fraction of it — the quantity that actually governs whether a tap can still
  // be placed in the right cell.
  cellMs: number;
  relJitter: number;
  trial: number;
  seed: number;
  confidence: number;
  taps: number;
  inferred: { beats: Beat[]; tempo: number } | null;
} & Grade;

// A distinct, reproducible stream per cell so trials stay independent and any
// single one can be replayed from the seed recorded alongside it.
const trialSeed = (
  caseIndex: number,
  tempoIndex: number,
  jitterIndex: number,
  driftIndex: number,
  trial: number,
) =>
  SEED +
  caseIndex * 7919 +
  tempoIndex * 1299709 +
  jitterIndex * 104729 +
  driftIndex * 15485863 +
  trial * 31;

const atTempo = (preimage: Preimage, tempoMult: number): Preimage => ({
  ...preimage,
  bpm: preimage.bpm * tempoMult,
});

const runTrial = (
  preimage: Preimage,
  jitterMs: number,
  driftPerBeat: number,
  seed: number,
) => {
  const { clicks, realizedBpm } = generateTaps(
    preimage,
    CYCLES,
    { ...baseHumanization, jitterMs, driftPerBeat },
    makeRng(seed),
  );
  const result = inferRhythm(clicks);
  return {
    // Grade against the tempo the performance actually ran at. Under drift the
    // nominal bpm is only where the tapper started, so holding inference to it
    // would score correct tracking as a tempo error.
    ...gradeRhythm({ ...preimage, bpm: realizedBpm }, result?.value),
    tempoWander: realizedBpm / preimage.bpm,
    confidence: result?.confidence ?? NaN,
    taps: clicks.length,
    inferred: result ? { beats: result.value.beats, tempo: result.value.tempo } : null,
  };
};

const trials: Trial[] = [];
for (const [caseIndex, benchCase] of corpus.entries()) {
  for (const [tempoIndex, tempoMult] of TEMPOS.entries()) {
    const preimage = atTempo(benchCase.preimage, tempoMult);
    const cellMs = 60000 / preimage.bpm;
    for (const [jitterIndex, jitterMs] of JITTERS.entries()) {
      for (const [driftIndex, driftPerBeat] of DRIFTS.entries()) {
        for (let trial = 0; trial < TRIALS; trial++) {
          const seed = trialSeed(
            caseIndex,
            tempoIndex,
            jitterIndex,
            driftIndex,
            trial,
          );
          trials.push({
            case: benchCase.name,
            jitterMs,
            tempoMult,
            driftPerBeat,
            cellMs,
            relJitter: jitterMs / cellMs,
            trial,
            seed,
            ...runTrial(preimage, jitterMs, driftPerBeat, seed),
          });
        }
      }
    }
  }
}

// --- reporting ----------------------------------------------------------

const VERDICTS: Verdict[] = [
  "exact",
  "accents",
  "rotated",
  "tempo",
  "wrong",
  "none",
];

const pct = (n: number, total: number) =>
  total === 0 ? "-" : `${Math.round((100 * n) / total)}%`;

const table = (headers: string[], rows: string[][]) => {
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => row[i].length)),
  );
  // First column reads as a label, the rest as numbers.
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i])))
      .join("  ");
  console.log(line(headers));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(line(row));
};

const where = (predicate: (trial: Trial) => boolean) => trials.filter(predicate);

const describe = (beats: Beat[]) =>
  beats
    .map((beat) =>
      beat.voices.length === 0 ? "." : beat.voices.includes("strong") ? "X" : "x",
    )
    .join("");

console.log(`\nsmart tap bench — ${METHOD}`);
console.log(
  `${corpus.length} cases x ${TEMPOS.length} tempos x ${JITTERS.length} jitters ` +
    `x ${DRIFTS.length} drifts x ${TRIALS} trials = ${trials.length} runs`,
);
console.log(
  `tempos ${TEMPOS.map((t) => `${t}x`).join(",")}  jitter ${JITTERS.join(",")}ms  ` +
    `drift ${DRIFTS.join(",")}${FLAT_ACCENTS ? "  flat-accents" : ""}`,
);
console.log(
  `seed ${SEED}  cycles ${CYCLES}  ` +
    `miss ${baseHumanization.missRate}  ghost ${baseHumanization.ghostRate}  ` +
    `accent-error ${baseHumanization.strengthErrorRate}`,
);

// The random cases have opaque names, so show what was actually drawn.
const drawn = corpus.filter(({ name }) => name.startsWith("Random/"));
if (drawn.length > 0) {
  console.log(
    `\n${drawn.length} arbitrary patterns drawn ` +
      `(${pct(drawn.length, corpus.length)} of corpus)\n`,
  );
  table(
    ["", "pattern", "cells", "taps", "bpm"],
    drawn.map(({ name, preimage }) => [
      name,
      describe(preimage.beats),
      String(preimage.beats.length),
      String(preimage.beats.filter((b) => b.voices.length > 0).length),
      String(preimage.bpm),
    ]),
  );
}

const exactPct = (subset: Trial[]) =>
  pct(subset.filter((t) => t.verdict === "exact").length, subset.length);

type Axis = { label: string; match: (trial: Trial) => boolean };

const axisOf = <T,>(
  values: T[],
  label: (value: T) => string,
  field: (trial: Trial) => T,
): Axis[] => values.map((value) => ({ label: label(value), match: (t) => field(t) === value }));

const caseAxis = axisOf(corpus.map((c) => c.name), (n) => n, (t) => t.case);
const jitterAxis = axisOf(JITTERS, String, (t) => t.jitterMs);
const tempoAxis = axisOf(TEMPOS, (t) => `${t}x`, (t) => t.tempoMult);
const driftAxis = axisOf(DRIFTS, String, (t) => t.driftPerBeat);

// Every table shows exact% over two axes and pools over the rest. Pooling is
// why the drift columns aren't measured at zero jitter and vice versa — each
// figure is an average across the axes it doesn't name.
const matrix = (
  title: string,
  corner: string,
  rows: Axis[],
  cols: Axis[],
  withTotal = false,
) => {
  console.log(`\n${title}\n`);
  const body = rows.map((row) => [
    row.label,
    ...cols.map((col) => exactPct(where((t) => row.match(t) && col.match(t)))),
  ]);
  if (withTotal) {
    body.push(["ALL", ...cols.map((col) => exactPct(where(col.match)))]);
  }
  table([corner, ...cols.map((c) => c.label)], body);
};

const pooledOver = (...axes: string[]) => `pooled over ${axes.join(" and ")}`;

matrix(
  `playback matches what was tapped ("exact"), by jitter (ms sd), ` +
    pooledOver(`${TEMPOS.length} tempos`, `${DRIFTS.length} drifts`),
  "case",
  caseAxis,
  jitterAxis,
  true,
);

matrix(
  `the same, by tempo drift (sd per grid cell), ` +
    pooledOver(`${TEMPOS.length} tempos`, `${JITTERS.length} jitters`),
  "case",
  caseAxis,
  driftAxis,
  true,
);

if (TEMPOS.length > 1) {
  matrix(
    `same rhythms, taken faster and slower (x preset tempo)`,
    "tempo",
    tempoAxis,
    jitterAxis,
  );
}

if (DRIFTS.length > 1) {
  matrix(`jitter against drift — the two noise axes`, "jitter", jitterAxis, driftAxis);

  // Drift settings are sd-per-cell and compound, so the number itself says
  // little. This is what each level did to the tempo of an actual performance —
  // and the spread the realized-tempo grading is absorbing.
  console.log(`\nhow far each drift level actually moved the tempo\n`);
  table(
    ["drift", "p5", "median", "p95"],
    DRIFTS.map((driftPerBeat) => {
      const wander = where((t) => t.driftPerBeat === driftPerBeat)
        .map((t) => t.tempoWander)
        .sort((a, b) => a - b);
      const at = (q: number) => wander[Math.floor(q * (wander.length - 1))].toFixed(3);
      return [String(driftPerBeat), at(0.05), at(0.5), at(0.95)];
    }),
  );
}

// Absolute jitter and tempo only matter through their ratio: what fraction of a
// grid cell the tap error spans. Collapsing every trial onto that one axis says
// whether tempo explains the per-case spread, or whether some rhythms are just
// harder than others at equal difficulty.
console.log(`\nexact% by jitter as a fraction of one grid cell\n`);
// Finely spaced at the bottom: accuracy is *not* monotone down there, so the
// low end needs the resolution to show where it turns over.
const REL_EDGES = [0.005, 0.01, 0.02, 0.04, 0.06, 0.09, 0.13, 0.2, Infinity];
const relLabel = (rel: number) => {
  const i = REL_EDGES.findIndex((edge) => rel < edge);
  const lo = i === 0 ? 0 : REL_EDGES[i - 1];
  const hi = REL_EDGES[i];
  return hi === Infinity ? `>${lo * 100}%` : `${lo * 100}-${hi * 100}%`;
};
const relBuckets = [...new Set(trials.map((t) => relLabel(t.relJitter)))];
table(
  ["jitter / cell", "trials", "exact"],
  relBuckets
    .map((label) => where((t) => relLabel(t.relJitter) === label))
    .sort((a, b) => a[0].relJitter - b[0].relJitter)
    .map((bucket) => [
      relLabel(bucket[0].relJitter),
      String(bucket.length),
      exactPct(bucket),
    ]),
);

console.log(`\nverdict mix by jitter\n`);
table(
  ["jitter", ...VERDICTS],
  JITTERS.map((jitterMs) => {
    const cell = where((t) => t.jitterMs === jitterMs);
    return [
      String(jitterMs),
      ...VERDICTS.map((verdict) =>
        pct(cell.filter((t) => t.verdict === verdict).length, cell.length),
      ),
    ];
  }),
);

// Where the tempo goes wrong, it tends to go wrong by a *ratio* — so bucket the
// ratios rather than averaging them, which would just smear 0.5 and 2 into 1.
const tempoOff = where((t) => t.verdict !== "none" && !t.tempoOk);
if (tempoOff.length > 0) {
  console.log(`\ntempo error, when the rhythm itself was right\n`);
  const shapeRight = tempoOff.filter((t) => t.patternOk || t.rotation !== null);
  const buckets = new Map<string, number>();
  for (const trial of shapeRight) {
    const key = trial.tempoRatio.toFixed(2);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  table(
    ["inferred / intended", "trials", "share"],
    [...buckets.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([ratio, count]) => [
        `${ratio}x`,
        String(count),
        pct(count, shapeRight.length),
      ]),
  );
}

if (SHOW_EXAMPLES) {
  console.log(`\none failing trial per case\n`);
  for (const { name, preimage } of corpus) {
    const failure = where((t) => t.case === name && t.verdict !== "exact")[0];
    if (!failure) continue;
    console.log(`${name}  [${failure.verdict}] seed ${failure.seed} jitter ${failure.jitterMs}`);
    console.log(
      `  tapped   ${describe(preimage.beats)} @ ${preimage.bpm.toFixed(1)}`,
    );
    console.log(
      failure.inferred
        ? `  inferred ${describe(failure.inferred.beats)} @ ${failure.inferred.tempo.toFixed(1)}` +
            `  (${failure.tempoRatio.toFixed(3)}x)`
        : `  inferred nothing`,
    );
  }
}

if (JSON_OUT) {
  writeFileSync(
    JSON_OUT,
    JSON.stringify(
      {
        config: {
          seed: SEED,
          trials: TRIALS,
          cycles: CYCLES,
          jitters: JITTERS,
          humanization: baseHumanization,
        },
        cases: corpus.map(({ name, preimage }) => ({
          name,
          bpm: preimage.bpm,
          pattern: describe(preimage.beats),
        })),
        trials,
      },
      null,
      1,
    ),
  );
  console.log(`\nwrote ${trials.length} trials to ${JSON_OUT}`);
}

console.log("");
