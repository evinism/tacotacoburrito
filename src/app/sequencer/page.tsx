import type { Metadata } from "next";
import SequencerMetronome from "@/metronome/sequencer/page";

export const metadata: Metadata = {
  title: "Sequencer",
};

export default function Sequencer() {
  return <SequencerMetronome />;
}
