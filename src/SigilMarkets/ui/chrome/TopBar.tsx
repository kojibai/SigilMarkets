// SigilMarkets/ui/chrome/TopBar.tsx
"use client";

import React, { useMemo } from "react";
import type { KaiMoment } from "../../types/marketTypes";
import { useSigilMarketsUi } from "../../state/uiStore";
import { useStickyHeader } from "../../hooks/useStickyHeader";
import { Icon } from "../atoms/Icon";
import { Chip } from "../atoms/Chip";
import { ToastHost } from "../atoms/Toast";

type ScrollMode = "window" | "container";

export type TopBarProps = Readonly<{
  title: string;
  subtitle?: string;
  now: KaiMoment;
  scrollMode: ScrollMode;
  scrollRef: React.RefObject<HTMLDivElement | null> | null;
  right?: React.ReactNode;
  back?: boolean;
  onBack?: () => void;
}>;

const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(" ");

export const TopBar = (props: TopBarProps) => {
  const { actions, state } = useSigilMarketsUi();

  const sticky = useStickyHeader(
    props.scrollMode === "container"
      ? { mode: "container", containerRef: props.scrollRef ?? undefined }
      : { mode: "window" },
  );

  const cls = useMemo(() => cx("sm-topbar", sticky.t > 0.02 && "is-scrolled"), [sticky.t]);

  return (
    <>
      <ToastHost />
      <div className={cls} style={sticky.headerStyle}>
        <div className="sm-topbar-row">
          <div className="sm-topbar-left">
            {props.back ? (
              <button
                type="button"
                className="sm-topbar-back"
                onClick={props.onBack ?? (() => actions.backToGrid())}
                aria-label="Back"
              >
                <Icon name="back" size={18} tone="dim" />
              </button>
            ) : null}

            <div className="sm-topbar-titles">
              <div className="sm-topbar-title">{props.title}</div>
              {props.subtitle ? <div className="sm-topbar-sub">{props.subtitle}</div> : null}
            </div>
          </div>

          <div className="sm-topbar-right">
            <Chip
              size="sm"
              selected={false}
              onClick={() => actions.pushSheet({ id: "seal-prediction", marketId: state.route.view === "market" ? state.route.marketId : undefined })}
              title="Seal a prophecy"
              left={<Icon name="spark" size={14} tone="gold" />}
            >
              Seal
            </Chip>

            <div className="sm-topbar-kai" title="Kai pulse">
              <span className="sm-topbar-kai-dot" aria-hidden="true" />
              <span className="sm-topbar-kai-text">p {props.now.pulse}</span>
            </div>

            {props.right}
          </div>
        </div>
        <div style={sticky.dividerStyle} />
      </div>
    </>
  );
};
