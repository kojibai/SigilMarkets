// SigilMarkets/views/Prophecy/ProphecyCard.tsx
"use client";

import React, { useMemo } from "react";
import type { KaiMoment } from "../../types/marketTypes";
import type { ProphecyRecord } from "../../types/prophecyTypes";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Chip } from "../../ui/atoms/Chip";
import { Icon } from "../../ui/atoms/Icon";
import { shortKey } from "../../utils/format";
import { prophecyWindowStatus } from "../../utils/prophecySigil";
import { useProphecyVerification } from "../../hooks/useProphecyVerification";

export type ProphecyCardProps = Readonly<{
  prophecy: ProphecyRecord;
  now: KaiMoment;
  onOpenSigil?: () => void;
  onRemove: () => void;
}>;

export const ProphecyCard = (props: ProphecyCardProps) => {
  const p = props.prophecy;

  const author = useMemo(() => shortKey(p.author.userPhiKey as unknown as string), [p.author.userPhiKey]);
  const windowStatus = prophecyWindowStatus(p.expirationPulse, props.now.pulse);
  const verification = useProphecyVerification(p.sigil?.payload, props.now.pulse);

  const textSnippet = useMemo(() => {
    const t = p.text.trim();
    if (t.length <= 120) return t;
    return `${t.slice(0, 118)}…`;
  }, [p.text]);

  return (
    <div className="sm-proph-item">
      <button
        type="button"
        className="sm-proph-btn"
        onClick={props.onOpenSigil}
        aria-label="Open prophecy sigil"
        disabled={!props.onOpenSigil}
      >
        <Card variant="glass2" className="sm-proph-card">
          <CardContent compact>
            <div className="sm-proph-top">
              <div className="sm-proph-q">{textSnippet}</div>
              <Chip size="sm" selected={false} variant="outline" tone={windowStatus === "closed" ? "danger" : "gold"}>
                {windowStatus === "closed" ? "window closed" : windowStatus === "open" ? "window open" : "no expiry"}
              </Chip>
            </div>

            <div className="sm-proph-mid">
              {p.category ? (
                <span className="sm-pill">
                  <Icon name="spark" size={14} tone="dim" /> {p.category}
                </span>
              ) : null}
              <span className="sm-small">sealed p {p.createdAt.pulse}</span>
              <span className="sm-small">by {author}</span>
            </div>

            <div className="sm-proph-foot">
              <span className="sm-pill">
                <Icon name="check" size={14} tone="dim" /> signature {verification.signature}
              </span>

              <span className="sm-pill">
                <Icon name="spark" size={14} tone="dim" /> ZK {verification.zk}
              </span>

              {p.expirationPulse ? (
                <span className="sm-pill">
                  <Icon name="warning" size={14} tone="dim" /> exp p{p.expirationPulse}
                </span>
              ) : null}

              {p.escrowPhiMicro ? (
                <span className="sm-pill">
                  <Icon name="vault" size={14} tone="dim" /> μΦ {p.escrowPhiMicro}
                </span>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </button>

      <div className="sm-proph-actions">
        <Chip size="sm" selected={false} onClick={props.onRemove} variant="outline" tone="danger" left={<Icon name="x" size={14} tone="danger" />}>
          Remove
        </Chip>
      </div>
    </div>
  );
};
