// SigilMarkets/views/MarketRoom/MarketRoom.tsx
"use client";

import React, { useMemo } from "react";
import type { KaiMoment, MarketId } from "../../types/marketTypes";
import { useMarket } from "../../hooks/useMarket";
import { useSigilMarketsUi } from "../../state/uiStore";
import { useScrollRestoration } from "../../hooks/useScrollRestoration";

import { TopBar } from "../../ui/chrome/TopBar";
import { MarketHeader } from "./MarketHeader";
import { MarketChart } from "./MarketChart";
import { MarketOrderPanel } from "./MarketOrderPanel";
import { MarketRules } from "./MarketRules";
import { MarketActivity } from "./MarketActivity";
import { Card, CardContent } from "../../ui/atoms/Card";

export type MarketRoomProps = Readonly<{
  marketId: MarketId;
  now: KaiMoment;
  scrollMode: "window" | "container";
  scrollRef: React.RefObject<HTMLDivElement | null> | null;
}>;

export const MarketRoom = (props: MarketRoomProps) => {
  const { actions, state } = useSigilMarketsUi();
  const m = useMarket(props.marketId, props.now.pulse);

  useScrollRestoration(state.route, {
    mode: props.scrollMode,
    containerRef: props.scrollRef ?? undefined,
    restoreDelayMs: 0,
  });

  if (m.status === "missing" || !m.market) {
    return (
      <div className="sm-page" data-sm="market-room">
        <TopBar
          title="Market"
          subtitle="Missing"
          now={props.now}
          scrollMode={props.scrollMode}
          scrollRef={props.scrollRef}
          back
          onBack={() => actions.backToGrid()}
        />
        <Card variant="glass">
          <CardContent>
            <div className="sm-title">Market not found.</div>
            <div className="sm-subtitle" style={{ marginTop: 8 }}>
              It may be offline or removed.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const market = m.market;

  const subtitle = useMemo(() => {
    const cat = market.def.category as unknown as string;
    return `${cat} • close p${market.def.timing.closePulse}`;
  }, [market.def.category, market.def.timing.closePulse]);

  return (
    <div className="sm-page" data-sm="market-room">
      <TopBar
        title="Market"
        subtitle={subtitle}
        now={props.now}
        scrollMode={props.scrollMode}
        scrollRef={props.scrollRef}
        back
        onBack={() => actions.navigate({ view: "grid" })}
      />

      <MarketHeader market={market} now={props.now} />

      <div className="sm-mkt-stack">
        <MarketChart now={props.now} yesPriceMicro={market.state.pricesMicro.yes} />

        <MarketOrderPanel market={market} now={props.now} />

        <MarketActivity market={market} />

        <MarketRules market={market} />
      </div>
    </div>
  );
};
