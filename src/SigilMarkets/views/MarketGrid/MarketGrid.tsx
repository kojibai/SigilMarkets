// SigilMarkets/views/MarketGrid/MarketCell.tsx
"use client";

import React, { useMemo } from "react";
import type { MarketGridItem } from "../../hooks/useMarketGrid";
import { formatCloseIn, formatPriceMicro } from "../../utils/format";
import { Card } from "../../ui/atoms/Card";
import { ProgressRing } from "../../ui/atoms/ProgressRing";
import { Icon } from "../../ui/atoms/Icon";

export type MarketCellProps = Readonly<{
  item: MarketGridItem;
  onOpen: () => void;
}>;

const heatTone = (heat: number): "dim" | "cyan" | "violet" | "gold" => {
  if (heat > 0.82) return "gold";
  if (heat > 0.58) return "violet";
  if (heat > 0.30) return "cyan";
  return "dim";
};

export const MarketCell = (props: MarketCellProps) => {
  const it = props.item;

  const yesCents = useMemo(() => formatPriceMicro(it.yesPriceMicro, { mode: "cents", decimals: 0 }), [it.yesPriceMicro]);
  const noCents = useMemo(() => formatPriceMicro(it.noPriceMicro, { mode: "cents", decimals: 0 }), [it.noPriceMicro]);

  const closeLabel = useMemo(() => formatCloseIn(it.closeInPulses), [it.closeInPulses]);

  // progress ring: 0 when far, 1 when at close
  const ring = useMemo(() => {
    const p = it.closeInPulses;
    if (p <= 0) return 1;
    // within 3000 pulses ramps to 1
    const t = 1 - Math.min(1, p / 3000);
    return t;
  }, [it.closeInPulses]);

  const tone = heatTone(it.heat);

  const cls = useMemo(() => `sm-grid-cell ${it.isClosingSoon ? "is-soon sm-breathe" : ""}`, [it.isClosingSoon]);

  return (
    <button type="button" className={cls} onClick={props.onOpen} aria-label={it.market.def.question}>
      <Card variant="glass" className="sm-grid-card" breathe={it.isClosingSoon}>
        <div className="sm-grid-card-top">
          <div className="sm-grid-q">{it.market.def.question}</div>
          <div className="sm-grid-ring">
            <ProgressRing value={ring} size={44} stroke={5} tone={tone === "dim" ? "dim" : tone} label={it.isClosingSoon ? "soon" : ""} />
          </div>
        </div>

        <div className="sm-grid-meta">
          <span className="sm-pill">
            <Icon name="clock" size={14} tone="dim" />
            {closeLabel}
          </span>
          <span className="sm-pill">
            <span className="sm-grid-dot" />
            {it.market.def.category}
          </span>
        </div>

        <div className="sm-grid-prices">
          <div className="sm-grid-price yes">
            <div className="sm-grid-price-k">YES</div>
            <div className="sm-grid-price-v">{yesCents}</div>
          </div>
          <div className="sm-grid-price no">
            <div className="sm-grid-price-k">NO</div>
            <div className="sm-grid-price-v">{noCents}</div>
          </div>
        </div>
      </Card>
    </button>
  );
};
