// SigilMarkets/views/Positions/PositionDetail.tsx
"use client";

import React, { useMemo, useState } from "react";
import type { KaiMoment } from "../../types/marketTypes";
import type { PositionId } from "../../types/sigilPositionTypes";
import { useSigilMarketsUi } from "../../state/uiStore";
import { useScrollRestoration } from "../../hooks/useScrollRestoration";
import { usePosition } from "../../hooks/usePositions";
import { useMarketById } from "../../state/marketStore";
import { TopBar } from "../../ui/chrome/TopBar";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Button } from "../../ui/atoms/Button";
import { Divider } from "../../ui/atoms/Divider";
import { Icon } from "../../ui/atoms/Icon";
import { formatPhiMicro, formatSharesMicro, shortHash } from "../../utils/format";
import { ClaimSheet } from "./ClaimSheet";
import { ExportPositionSheet } from "./ExportPositionSheet";
import { TransferPositionSheet } from "./TransferPositionSheet";
import { PositionTimeline } from "./PositionTimeline";

export type PositionDetailProps = Readonly<{
  positionId: PositionId;
  now: KaiMoment;
  scrollMode: "window" | "container";
  scrollRef: React.RefObject<HTMLDivElement | null> | null;
}>;

export const PositionDetail = (props: PositionDetailProps) => {
  const { state: uiState, actions } = useSigilMarketsUi();

  useScrollRestoration(uiState.route, {
    mode: props.scrollMode,
    containerRef: props.scrollRef ?? undefined,
    restoreDelayMs: 0,
  });

  const p = usePosition(props.positionId);
  const market = p ? useMarketById(p.marketId) : null;

  const [claimOpen, setClaimOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  if (!p) {
    return (
      <div className="sm-page" data-sm="position-detail">
        <TopBar title="Position" subtitle="Missing" now={props.now} scrollMode={props.scrollMode} scrollRef={props.scrollRef} back />
        <Card variant="glass">
          <CardContent>
            <div className="sm-title">Position not found.</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const q = market?.def.question ?? "Market";
  const stake = formatPhiMicro(p.entry.stakeMicro, { withUnit: true, maxDecimals: 6, trimZeros: true });
  const shares = formatSharesMicro(p.entry.sharesMicro, { maxDecimals: 2 });

  const lockId = p.lock.lockId as unknown as string;

  return (
    <div className="sm-page" data-sm="position-detail">
      <TopBar
        title="Position"
        subtitle={`${p.status} • p${p.entry.openedAt.pulse}`}
        now={props.now}
        scrollMode={props.scrollMode}
        scrollRef={props.scrollRef}
        back
        onBack={() => uiState.route.view === "position" ? uiState.route : uiState.route}
      />

      <Card variant="glass" className="sm-pos-detail">
        <CardContent>
          <div className="sm-pos-detail-q">{q}</div>

          <div className="sm-pos-detail-row">
            <span className={`sm-pos-side ${p.entry.side === "YES" ? "is-yes" : "is-no"}`}>{p.entry.side}</span>
            <span className="sm-pill">{p.status}</span>
          </div>

          <Divider />

          <div className="sm-pos-detail-grid">
            <div className="row"><span className="k">Stake</span><span className="v">{stake}</span></div>
            <div className="row"><span className="k">Shares</span><span className="v">{shares}</span></div>
            <div className="row"><span className="k">Lock</span><span className="v mono">{shortHash(lockId, 10, 6)}</span></div>
          </div>

          <Divider />

          <div className="sm-pos-detail-actions">
            {p.status === "claimable" || p.status === "refundable" ? (
              <Button variant="primary" onClick={() => setClaimOpen(true)} leftIcon={<Icon name="check" size={14} tone="gold" />}>
                {p.status === "claimable" ? "Claim" : "Refund"}
              </Button>
            ) : null}

            <Button variant="ghost" onClick={() => setExportOpen(true)} leftIcon={<Icon name="export" size={14} tone="dim" />}>
              Export
            </Button>

            <Button variant="ghost" onClick={() => setTransferOpen(true)} leftIcon={<Icon name="share" size={14} tone="dim" />}>
              Transfer
            </Button>
          </div>

          <Divider />

          <PositionTimeline position={p} />
        </CardContent>
      </Card>

      <ClaimSheet open={claimOpen} onClose={() => setClaimOpen(false)} position={p} now={props.now} />
      <ExportPositionSheet open={exportOpen} onClose={() => setExportOpen(false)} position={p} />
      <TransferPositionSheet open={transferOpen} onClose={() => setTransferOpen(false)} position={p} />
    </div>
  );
};
