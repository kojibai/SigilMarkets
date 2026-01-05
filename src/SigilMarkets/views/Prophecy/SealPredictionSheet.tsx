// SigilMarkets/views/Prophecy/SealPredictionSheet.tsx
"use client";

import type { KaiMoment, MarketId } from "../../types/marketTypes";
import { Sheet } from "../../ui/atoms/Sheet";
import { ProphecyMintForm } from "./ProphecyMintForm";

export type SealPredictionSheetProps = Readonly<{
  open: boolean;
  onClose: () => void;
  now: KaiMoment;
  /** If provided, pre-selects a market */
  initialMarketId: MarketId | null;
}>;

export const SealPredictionSheet = (props: SealPredictionSheetProps) => {
  const subtitle = "Seal a Prophecy Sigil with your ΦKey + ZK proof.";

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title="Seal Prophecy"
      subtitle={subtitle}
    >
      <div className="sm-seal">
        <ProphecyMintForm now={props.now} compact onMinted={props.onClose} />
      </div>
    </Sheet>
  );
};
