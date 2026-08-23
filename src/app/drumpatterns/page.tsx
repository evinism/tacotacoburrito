import type { Metadata } from "next";
import DrumPatternLibrary from "@/metronome/drumpatterns/page";

export const metadata: Metadata = {
  title: "Drum Pattern Library",
};

export default function DrumPatterns() {
  return <DrumPatternLibrary />;
}
