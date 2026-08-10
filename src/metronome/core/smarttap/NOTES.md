# Notes on tuning rhythm inference

A lab notebook for the smarttap methods: how they get measured, what the last
round of work found, and — mostly — the things that looked obviously right and
weren't. Written so the dead ends don't get re-walked.

The code comments explain what each method *does*. This explains why it does it
that way and what else was tried.

---

## 1. Two different metrics, do not confuse them

Almost every number below is one of two things, and they are not comparable.

**Bench accuracy** — `npm run bench:smarttap`. End-to-end: synthesise taps,
infer, grade, report `exact%` pooled over tempo/jitter/drift. This is the number
that matters. methodTwo scores 91/87/71/43 across the default jitter sweep;
methodThree scores 93/89/73/45.

**Offline selection accuracy** — a candidate dump (section 5) scored by "did the
cost function pick the right candidate out of ~25?" On the same corpus methodTwo
scores 74.9% and methodThree 76.8%. These are *lower* than bench numbers because
the condition mix is different and because a trial counts as failed when no
candidate is right at all.

A 2-point move offline was worth about 2 points on the bench in this round, but
that ratio is not guaranteed. **Always confirm an offline win on the real bench
before believing it.** Two of the offline wins in section 6 evaporated.

---

## 2. Where the methods stand

Full default grid, 68000 runs each.

```
                     jitter  5    10    20    40      drift  0   .002  .005  .01  .02
methodOne                   58    55    45    30            57    56    52    43   26
methodTwo                   91    87    71    43            77    76    75    72   63
methodThree                 93    89    73    45            80    79    77    74   66

presets by variant          two                      three
  base              99 / 97 / 80 / 48         100 / 98 / 83 / 52
  flat              99 / 97 / 74 / 39          99 / 96 / 75 / 40
  skeleton          63 / 52 / 36 / 22          71 / 58 / 40 / 25
```

By jitter as a fraction of a grid cell — the axis that actually governs
difficulty, since absolute jitter and tempo only matter through their ratio:

```
jitter/cell   0-.5%  .5-1%  1-2%  2-4%  4-6%  6-9%  9-13%  13-20%  >20%
methodTwo      100     97     94    93    90    86     72      35     3
methodThree    100     98     96    94    92    88     74      41     5
```

Latency, mean over every prefix of 20 performances (the UI re-infers on every
tap, so the per-call cost over the whole history is what matters):

```
methodOne    0.668 ms/call    worst full-history call 2.04 ms
methodTwo    0.284 ms/call                            2.02 ms
methodThree  0.357 ms/call                            2.54 ms
```

Robustness axes, `--trials 4`, methodTwo vs methodThree:

```
miss 0.05           56/54/43/26   57/55/45/28
ghost 0.05          67/59/43/23   69/61/45/24
accent-error 0.15   39/37/31/18   41/39/33/20
flat-accents        88/83/68/42   89/85/70/44
jitter 0            92            94
tempo 0.25,0.5      92/92/90/84   94/93/92/86
all three noises    25/21/16/8    26/22/17/9
cycles 8            87/83/67/39   89/85/69/41
cycles 3 (n=24)     92/88/71/43   94/89/73/45
cycles 2 (n=24)     93/87/68/39   93/86/66/39   <- the one regression
```

---

## 3. The diagnosis that produced methodthree

methodTwo picks the grid **blind**: it scores each candidate cell on how tightly
the taps sit on it, picks a winner, and only then reads a cycle off the winner.
The question it asks never mentions the rhythm.

Two instrumented losers, both from `--jitter 40`:

```
Syrtos (4/4), truth X..xX.x. @ 240ms cell
  X...xX.x.   9 cells   misfit 0.1525   <- wins
  X..xX.x.    8 cells   misfit 0.1573   <- truth

Kalamatianos (7/8) skeleton, truth x..x... @ 500ms cell
  x...x....   9 cells   misfit 0.0355   <- wins
  x..x...     7 cells   misfit 0.0495   <- truth
```

The wrong grid fits *better*, and it has to. Judging by residual alone rewards
whichever grid has more cells to hide error in, and the local regression that
gives methodTwo its drift tolerance makes it worse by absorbing a wrong grid's
error as though it were a wandering tempo.

**The decisive measurement** was an oracle sweep over hard trials (jitter 20/40,
tempo 1–2x, 1392 trials): enumerate every candidate grid × every cycle length,
ask whether *any* of them is exactly right.

```
methodTwo actually gets                   45.8%
right answer exists in top-6 grids
        at findCycleLength's cycle        56.9%
        at any cycle length               58.8%
right answer exists in any grid           65.9%
```

That split the problem cleanly: **11 points were pure scoring loss** (the answer
was already in the shortlist and wasn't chosen), ~2 more in cycle-length search,
~7 in a wider shortlist. Do this measurement first next time. It is cheap and it
decides whether to work on scoring or on candidate generation.

**The fix.** A wrong grid's error is *periodic in the cycle*; drift is *smooth in
time*. A regression window can't tell them apart — but once you know the cycle
length you can sort each tap's residual into its residue class and separate them
exactly: spread *within* a class is the tapper's jitter, offset *between* classes
is a beat consistently in the wrong cell. So

```
cost = residual² × (residual² / jitter²)^0.75
```

which requires finding the cycle *before* choosing the grid rather than after.
Flat over `RESIDUAL_FLOOR` ∈ [1e-3, 3e-2] and the exponent ∈ [0.5, 1.25] — not a
knife-edge, which is the main reason to trust it.

It also subsumes methodTwo's complexity penalty for free: the degenerate fine
grid the penalty existed to block gives every tap its own residue class, has no
within-class spread to compare against, and prices itself out.

---

## 4. What did not work

Numbers are offline selection accuracy (section 1) unless stated.

| Idea | Result | Why |
|---|---|---|
| **Pattern EM** — re-place taps on the hypothesised rhythm, re-vote, iterate | Built twice, deleted twice | Moved taps in **3.4%** of candidates and changed exactly one bench cell by 1%. `findCycleLength` returns a near-span cycle on a noisy grid, so every occupied residue votes "onset" and the constraint is vacuous. Also `buildBeats`' majority vote already handles most of what it was meant to fix. |
| **Penalising cycle length** `× (1 + w·L/n)` | 76.8 → 66.8 at w=1, worse as w grows | For a *fixed grid* the cost is identical for every L, so it cannot choose L at all — it only re-ranks grids, badly. The ranker gives `L` a **positive** weight once complexity is controlled: it wants *sparse* rhythms, not short cycles. |
| **MDL on cells-per-gap** — `ms-residual × geomean(multiples)^w` | peaks at w=1 → 74.8, i.e. no change | At w=1 this is algebraically ≈ the existing scale-free misfit. Per-case analysis suggested w≈2.1; that wins those cases and loses many more (65.5 at w=2). |
| **Widening the scoring regression window** | 74.9 → 71.3 (±8) → 67.0 (±16) → 64.8 (global) | Was meant to stop a short window absorbing periodic error. It does, but it destroys drift tolerance — "drifty" bucket falls 67.1 → 41.4. |
| **dof correction** — `σ² = SS_within/(n − classes)`, the textbook ANOVA form | 76.8 → 75.2 | The "biased" `/n` divisor is **load-bearing**: it implicitly penalises readings that scatter taps over many residue classes. Correcting it removes a signal that was doing real work. Tried in order to fix the cycles=2 regression; made cycles=4 worse. |
| **Capping the inflation factor** | Inert at every cap from 4 to 256 | Winners' inflation values are all small; the cap never binds. Also tried for cycles=2. |
| **`classes` penalty alone** | 74.6 at k=0.25, down to 56.7 at k=3 | The ranker's largest weight (−4.38) but it only works jointly with terms that were dropped. See open leads. |
| **Shape terms on the new cost** (`classes^k · L^j · (span/n)^m`) | +0.7, at the *edge* of the search grid | Edge-of-grid optimum with two unexplainable constants = noise-fitting. Rejected. |
| `purity`, `fill`, `repeats` as features | +0.7, +0.1, negative | Purity is the only one worth anything and it is subsumed by the bias/jitter split. |

---

## 5. The tooling that made this tractable

Three throwaway scripts, in a pipeline. Rebuild them; they are worth the 20
minutes and everything above came out of them.

**(a) Dump.** Run the whole corpus × conditions, and for every trial emit *every*
candidate with its features and whether it is correct.

```
for each preimage (presets × {base,flat,skeleton} + ~20 random):
  for mult × jitter × drift × trial:
    generate taps, build candidate grids exactly as the method does
    for each candidate: record features + gradeRhythm(...) === "exact"
→ 14040 trials, ~329k candidates, one JSON
```

Features worth recording: residual at several regression windows, the
bias/within split, span, cycle length, cell ms, number of occupied residue
classes, number of classes with >1 tap, tap count.

**(b) Sweep.** Load the JSON, define `score(name, costFn)` that picks the argmin
per trial and reports top-1 accuracy bucketed by easy / hard / drifty. A cost
function is then five lines and a sweep of 100 variants takes two seconds.
This is the whole reason a dozen ideas could be tested in an afternoon —
re-running the bench for each would have been ~50 s a shot.

**(c) Rank.** A listwise softmax ranker over ~11 log features: softmax the scores
*within a trial*, gradient-ascend the log-probability of the correct candidate.
Softmax-within-trial rather than a per-candidate classifier because only the
argmin matters, so no capacity is wasted calibrating per-trial scale.

**Use it as a measuring instrument, not as a product.** It answers the question
hand-designed costs cannot: *is the information present in these features at
all?* Three costs all landing on 76% is weak evidence about the ceiling — it
can't distinguish "wrong formula" from "wrong features."

```
                    on winnable trials    on all trials
methodTwo                   88.2%             74.9%
methodThree                 90.4%             76.8%
linear ranker               94.2%             80.0%
oracle                     100%               84.9%
```

Then read the weights as hypotheses. `residual −3.55` against
`within-class jitter +2.69` is the model saying *prefer low residual relative to
its unstructured part* — which is where the shipped cost function came from.
Do **not** ship the ranker: 11 constants with no derivation and no honest comment
to write above them.

**Split by rhythm, not by trial.** The first split was even/odd over trials, and
consecutive trials are the same rhythm at neighbouring conditions, so both halves
saw all 78 rhythms. Re-run grouped by rhythm it held up (93.3% held-out, 94.2%
5-fold out-of-fold), but that was luck, not rigour.

---

## 6. Process traps, all of which bit

- **zsh does not word-split unquoted parameter expansions.** `run $flags` passes
  `"--jitter 0,2"` as one argument, the bench silently ignores it, and every row
  of the comparison table comes out identical. This has now cost time twice in
  this repo. Pass bench flags as separate arguments, or use `${=flags}`. The tell
  is a table that is *too* consistent.
- **Verify refactors by byte-diffing bench output.** Extracting `grid.ts` out of
  `methodtwo.ts` was confirmed behaviour-preserving that way, which made the
  subsequent comparisons meaningful.
- **Verify optimisations the same way.** The branch-and-bound in methodthree
  (a candidate's plain residual is an admissible lower bound on its cost, since
  the inflation factor is never < 1) cut runtime 108 s → 51 s with byte-identical
  output. An "optimisation" that changes results is a behaviour change.
- **Check apparent per-case regressions for power before chasing them.** In the
  earlier methodTwo work, five cases "regressed" ~5 points at jitter 40; at 3200
  trials/cell the effect was flat. Noise.
- **Suspect results that are too good or too identical.** The first methodthree
  run scored identically to methodTwo to the last digit, which is what prompted
  instrumenting the EM and finding it was inert.

---

## 7. Open leads

1. **`classes` is the largest ranker weight (−4.38) and nobody knows why.** Alone
   it hurts; jointly it is worth a lot. Probably a good part of the ~3 points
   still available from scoring. Worth understanding what it actually tracks
   before trying to use it.
2. **~3 points of scoring headroom remain** (methodthree 90.4% vs ranker 94.2%
   out-of-fold on winnable trials).
3. **~15 points where no candidate grid is right at all.** No scoring reaches
   these. The oracle says a wider shortlist has room (hard trials: any grid 65.9%
   vs top-6 58.8%), so candidate generation is the lever, not the cost function.
4. **cycles=2 regression**, ~1–2 points behind methodTwo at mid jitter. Splitting
   a class's error needs several taps per class and two repeats gives two. Three
   repeats already turns it around. The dof correction is *not* the fix (§4).
5. **`MAX_GAP_SUBDIVISION` 6 → 9** was measured and declined during the methodTwo
   work: +2 points on skeletons, but 1.10 → 1.78 ms/call on the per-tap hot path.
   methodthree's gap-difference seeds reach some of those cells for free, so this
   may be worth re-measuring rather than re-deciding.
6. **A prior over rhythms** (musically plausible cycle lengths, simple ratios)
   would help the presets and is arguably legitimate — real users tap real
   rhythms. It would flatter the bench, though, which is exactly why the random
   patterns are in the corpus. Weigh carefully.
