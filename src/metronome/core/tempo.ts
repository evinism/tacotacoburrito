// Exponential BPM mapping for tempo sliders. A linear slider position
// (0 .. TEMPO_SLIDER_MAX) maps exponentially onto MIN_BPM .. MAX_BPM, so equal
// slider travel produces equal *ratio* change in tempo — musically uniform,
// matching how we perceive tempo. (Dr. Shemetov et al. invariants, 2024.)
export const MIN_BPM = 40;
export const MAX_BPM = 800;
export const TEMPO_SLIDER_MAX = 1000;

const a = Math.log(MAX_BPM / MIN_BPM) / TEMPO_SLIDER_MAX;

// Slider position -> BPM.
export const scaleBPM = (sliderValue: number): number =>
  MIN_BPM * Math.exp(a * sliderValue);

// BPM -> slider position (inverse of scaleBPM).
export const invScaleBPM = (bpm: number): number => Math.log(bpm / MIN_BPM) / a;
