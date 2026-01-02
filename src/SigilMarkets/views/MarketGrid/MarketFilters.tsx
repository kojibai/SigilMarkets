// SigilMarkets/views/MarketGrid/MarketFilters.tsx
"use client";

import React, { useMemo } from "react";
import type { KaiMoment, MarketCategory } from "../../types/marketTypes";
import { useSigilMarketsUi } from "../../state/uiStore";
import { Chip } from "../../ui/atoms/Chip";
import { Icon } from "../../ui/atoms/Icon";

export type MarketFiltersProps = Readonly<{
  now: KaiMoment;
}>;

const CATS: readonly MarketCategory[] = ["weather", "sports", "finance", "crypto", "tech", "world", "culture", "other"];

export const MarketFilters = (_props: MarketFiltersProps) => {
  const { state, actions } = useSigilMarketsUi();

  const active = state.grid.filters.categories;

  const toggleCat = (c: MarketCategory): void => {
    const has = active.includes(c);
    const next = has ? active.filter((x) => x !== c) : [...active, c];
    actions.setCategories(next);
  };

  const layoutIsList = state.grid.prefs.layout === "list";

  const toggleLayout = (): void => {
    actions.setGridLayout(layoutIsList ? "honeycomb" : "list");
  };

  const clear = (): void => {
    actions.setCategories([]);
    actions.setGridQuery("");
  };

  const anyFilters = active.length > 0 || state.grid.filters.query.trim().length > 0;

  const toneFor = (c: MarketCategory): "default" | "cyan" | "violet" | "gold" => {
    if (c === "weather") return "cyan";
    if (c === "crypto") return "violet";
    if (c === "finance") return "gold";
    return "default";
  };

  return (
    <div className="sm-grid-filters">
      <div className="sm-grid-filter-row">
        <button type="button" className="sm-grid-search" onClick={() => actions.pushSheet({ id: "seal-prediction", marketId: undefined })}>
          <span className="sm-grid-search-ico">
            <Icon name="spark" size={14} tone="gold" />
          </span>
          <span className="sm-grid-search-txt">Seal a prophecy…</span>
        </button>

        <Chip size="sm" selected={layoutIsList} onClick={toggleLayout} left={<Icon name="hex" size={14} tone="dim" />}>
          {layoutIsList ? "List" : "Honey"}
        </Chip>

        {anyFilters ? (
          <Chip size="sm" selected={false} onClick={clear} tone="danger" variant="outline" left={<Icon name="x" size={14} tone="danger" />}>
            Clear
          </Chip>
        ) : null}
      </div>

      <div className="sm-grid-cat-row">
        {CATS.map((c) => (
          <Chip key={c} size="sm" selected={active.includes(c)} tone={toneFor(c)} onClick={() => toggleCat(c)}>
            {c}
          </Chip>
        ))}
      </div>
    </div>
  );
};
