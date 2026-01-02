// SigilMarkets/views/MarketRoom/MintPositionSheet.tsx
"use client";

import React, { useMemo } from "react";
import type { KaiMoment } from "../../types/marketTypes";
import type { PositionRecord } from "../../types/sigilPositionTypes";
import { Sheet } from "../../ui/atoms/Sheet";
import { Button } from "../../ui/atoms/Button";
import { Divider } from "../../ui/atoms/Divider";
import { Icon } from "../../ui/atoms/Icon";
import { formatPhiMicro, formatSharesMicro } from "../../utils/format";

export type MintPositionSheetProps = Readonly<{
  open: boolean;
  onClose: () => void;

  now: KaiMoment;

  position: PositionRecord | null;

  onMint: () => void;

  loading?: boolean;
}>;

export const MintPositionSheet = (props: MintPositionSheetProps) => {
  const p = props.position;

  const title = p ? `Position • ${p.entry.side}` : "Position";
  const stake = useMemo(() => (p ? formatPhiMicro(p.entry.stakeMicro, { withUnit: true, maxDecimals: 6, trimZeros: true }) : "—"), [p]);
  const shares = useMemo(() => (p ? formatSharesMicro(p.entry.sharesMicro, { maxDecimals: 2 }) : "—"), [p]);
  const avg = useMemo(() => (p ? `${Number(p.entry.avgPriceMicro) / 10_000}¢` : "—"), [p]);

  const hasSigil = !!p?.sigil;

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title={title}
      subtitle="Mint your Position Sigil (portable receipt) for sharing, printing, and proof."
      footer={
        <div className="sm-mint-footer">
          <Button variant="ghost" onClick={props.onClose} disabled={props.loading}>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={props.onMint}
            disabled={!p || hasSigil || props.loading}
            loading={props.loading}
            leftIcon={<Icon name="spark" size={14} tone="gold" />}
          >
            {hasSigil ? "Minted" : "Mint sigil"}
          </Button>
        </div>
      }
    >
      <div className="sm-mint">
        <div className="sm-mint-hero sm-breathe">
          <div className="sm-mint-badge">
            <Icon name="hex" size={18} tone="cyan" />
          </div>
          <div>
            <div className="sm-mint-title">Your stance is now an artifact.</div>
            <div className="sm-mint-sub">pulse {props.now.pulse}</div>
          </div>
        </div>

        <Divider />

        <div className="sm-mint-grid">
          <div className="sm-mint-row">
            <span className="sm-mint-k">Stake</span>
            <span className="sm-mint-v">{stake}</span>
          </div>
          <div className="sm-mint-row">
            <span className="sm-mint-k">Shares</span>
            <span className="sm-mint-v">{shares}</span>
          </div>
          <div className="sm-mint-row">
            <span className="sm-mint-k">Avg</span>
            <span className="sm-mint-v">{avg}</span>
          </div>
        </div>

        {hasSigil ? (
          <div className="sm-small" style={{ marginTop: 12 }}>
            This position already has a minted sigil. You can export it from the Position screen.
          </div>
        ) : (
          <div className="sm-small" style={{ marginTop: 12 }}>
            Minting creates an SVG with embedded metadata (proof capsule) bound to your identity.
          </div>
        )}
      </div>
    </Sheet>
  );
};
