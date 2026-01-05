// SigilMarkets/views/Prophecy/ProphecyFeed.tsx
"use client";

import { useMemo } from "react";
import type { KaiMoment } from "../../types/marketTypes";
import { useSigilMarketsUi } from "../../state/uiStore";
import { useScrollRestoration } from "../../hooks/useScrollRestoration";
import { useProphecyFeed } from "../../hooks/useProphecyFeed";

import { TopBar } from "../../ui/chrome/TopBar";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Chip } from "../../ui/atoms/Chip";
import { Icon } from "../../ui/atoms/Icon";

import { ProphecyCard } from "./ProphecyCard";
import { ProphecyMintForm } from "./ProphecyMintForm";

export type ProphecyFeedProps = Readonly<{
  now: KaiMoment;
  scrollMode: "window" | "container";
  scrollRef: React.RefObject<HTMLDivElement | null> | null;
}>;

export const ProphecyFeed = (props: ProphecyFeedProps) => {
  const { state: uiState } = useSigilMarketsUi();

  useScrollRestoration(uiState.route, {
    mode: props.scrollMode,
    containerRef: props.scrollRef ?? undefined,
    restoreDelayMs: 0,
  });

  const { prophecies, counts, activeVault, actions } = useProphecyFeed({
    includeExpired: true,
    nowPulse: props.now.pulse,
  });

  const subtitle = useMemo(() => {
    const parts: string[] = [];
    parts.push(`${counts.total} total`);
    if (counts.open > 0) parts.push(`${counts.open} open`);
    if (counts.closed > 0) parts.push(`${counts.closed} closed`);
    return parts.join(" • ");
  }, [counts.closed, counts.open, counts.total]);

  return (
    <div className="sm-page" data-sm="prophecy">
      <TopBar title="Prophecy" subtitle={subtitle} now={props.now} scrollMode={props.scrollMode} scrollRef={props.scrollRef} />

      <div className="sm-proph-toolbar">
        <div className="sm-proph-left">
          <Chip size="sm" selected={false} left={<Icon name="spark" size={14} tone="gold" />}>
            Seal a prophecy
          </Chip>
        </div>

        <div className="sm-proph-right">
          {!activeVault ? (
            <Chip
              size="sm"
              selected={false}
              variant="outline"
              onClick={() => actions.requireAuth("auth")}
              left={<Icon name="scan" size={14} tone="cyan" />}
            >
              Inhale
            </Chip>
          ) : (
            <Chip size="sm" selected={false} variant="outline" left={<Icon name="vault" size={14} tone="dim" />}>
              bound
            </Chip>
          )}
        </div>
      </div>

      <div className="sm-proph-form">
        <ProphecyMintForm now={props.now} />
      </div>

      {prophecies.length === 0 ? (
        <Card variant="glass">
          <CardContent>
            <div className="sm-title">No prophecies yet.</div>
            <div className="sm-subtitle" style={{ marginTop: 8 }}>
              Seal your first prophecy and share it as a portable SVG proof.
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="sm-proph-list">
          {prophecies.slice(0, 60).map((p) => (
            <ProphecyCard
              key={p.id as unknown as string}
              prophecy={p}
              now={props.now}
              onRemove={() => actions.remove(p.id)}
              onOpenSigil={() => {
                if (p.sigil?.url) {
                  window.open(p.sigil.url, "_blank", "noopener,noreferrer");
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};
