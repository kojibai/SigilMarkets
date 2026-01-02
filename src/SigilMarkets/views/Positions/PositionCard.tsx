// SigilMarkets/views/Positions/PositionsHome.tsx
"use client";

import React, { useMemo } from "react";
import type { KaiMoment } from "../../types/marketTypes";
import { useSigilMarketsUi } from "../../state/uiStore";
import { useScrollRestoration } from "../../hooks/useScrollRestoration";
import { usePositions } from "../../hooks/usePositions";
import { TopBar } from "../../ui/chrome/TopBar";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Chip } from "../../ui/atoms/Chip";
import { Icon } from "../../ui/atoms/Icon";
import { PositionCard } from "./PositionCard";

export type PositionsHomeProps = Readonly<{
  now: KaiMoment;
  scrollMode: "window" | "container";
  scrollRef: React.RefObject<HTMLDivElement | null> | null;
}>;

export const PositionsHome = (props: PositionsHomeProps) => {
  const { state: uiState, actions } = useSigilMarketsUi();

  useScrollRestoration(uiState.route, {
    mode: props.scrollMode,
    containerRef: props.scrollRef ?? undefined,
    restoreDelayMs: 0,
  });

  const { positions, buckets, counts } = usePositions();

  const subtitle = useMemo(() => {
    if (counts.total === 0) return "No positions yet";
    return `${counts.total} • ${counts.open} open • ${counts.claimable} claimable`;
  }, [counts]);

  const sections = useMemo(
    () =>
      [
        { key: "claimable", title: "Claimable", items: buckets.claimable, tone: "gold" as const },
        { key: "open", title: "Open", items: buckets.open, tone: "cyan" as const },
        { key: "lost", title: "Lost", items: buckets.lost, tone: "danger" as const },
        { key: "refundable", title: "Refundable", items: buckets.refundable, tone: "violet" as const },
        { key: "claimed", title: "Claimed", items: buckets.claimed, tone: "default" as const },
        { key: "refunded", title: "Refunded", items: buckets.refunded, tone: "default" as const },
      ].filter((s) => s.items.length > 0),
    [buckets],
  );

  return (
    <div className="sm-page" data-sm="positions">
      <TopBar
        title="Positions"
        subtitle={subtitle}
        now={props.now}
        scrollMode={props.scrollMode}
        scrollRef={props.scrollRef}
      />

      {counts.total === 0 ? (
        <Card variant="glass">
          <CardContent>
            <div className="sm-title">No positions yet.</div>
            <div className="sm-subtitle" style={{ marginTop: 8 }}>
              Make a wager in any market to mint your first Position Sigil.
            </div>
            <div style={{ marginTop: 12 }}>
              <Chip size="sm" selected={false} tone="cyan" onClick={() => actions.navigate({ view: "grid" })} left={<Icon name="hex" size={14} tone="dim" />}>
                Browse markets
              </Chip>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="sm-pos-stack">
          {sections.map((s) => (
            <div key={s.key} className="sm-pos-section">
              <div className="sm-pos-head">
                <div className="sm-pos-title">
                  <Icon name="positions" size={14} tone="dim" /> {s.title}
                </div>
                <Chip size="sm" selected={false} variant="outline" tone={s.tone}>
                  {s.items.length}
                </Chip>
              </div>

              <div className="sm-pos-list">
                {s.items.slice(0, 24).map((p) => (
                  <PositionCard key={p.id as unknown as string} position={p} now={props.now} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
