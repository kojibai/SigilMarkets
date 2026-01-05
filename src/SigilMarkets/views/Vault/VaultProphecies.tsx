// SigilMarkets/views/Vault/VaultProphecies.tsx
"use client";

import { useMemo } from "react";
import type { KaiMoment } from "../../types/marketTypes";
import type { ProphecyRecord } from "../../types/prophecyTypes";
import { useProphecyFeed } from "../../hooks/useProphecyFeed";
import { useProphecyVerification } from "../../hooks/useProphecyVerification";
import { prophecyWindowStatus } from "../../utils/prophecySigil";
import { formatPhiMicro } from "../../utils/format";
import { Card, CardContent } from "../../ui/atoms/Card";

const toPhiLabel = (micro?: string): string => {
  if (!micro) return "—";
  try {
    return formatPhiMicro(BigInt(micro), { withUnit: true, maxDecimals: 6, trimZeros: true });
  } catch {
    return micro;
  }
};

const ProphecyRow = (props: Readonly<{ prophecy: ProphecyRecord; now: KaiMoment }>) => {
  const p = props.prophecy;
  const verify = useProphecyVerification(p.sigil?.payload, props.now.pulse);
  const windowStatus = prophecyWindowStatus(p.expirationPulse, props.now.pulse);

  return (
    <Card variant="glass2" className="sm-vault-sigil-card">
      <CardContent compact>
        <div className="sm-vault-sigil-top">
          <div className="sm-vault-sigil-title">Prophecy Sigil</div>
          <div className="sm-vault-sigil-sub">sealed p{p.createdAt.pulse}</div>
        </div>

        <div className="sm-vault-proph-text">{p.text}</div>

        <div className="sm-vault-sigil-badges">
          <span className="sm-pill">Signature {verify.signature}</span>
          <span className="sm-pill">ZK {verify.zk}</span>
          <span className="sm-pill">{windowStatus === "none" ? "no expiry" : `window ${windowStatus}`}</span>
        </div>

        <div className="sm-vault-sigil-meta">
          <div className="sm-vault-sigil-line">
            <span className="sm-vault-sigil-k">category</span>
            <span className="sm-vault-sigil-v">{p.category ?? "—"}</span>
          </div>
          <div className="sm-vault-sigil-line">
            <span className="sm-vault-sigil-k">expiration</span>
            <span className="sm-vault-sigil-v">{p.expirationPulse ? `p${p.expirationPulse}` : "—"}</span>
          </div>
          <div className="sm-vault-sigil-line">
            <span className="sm-vault-sigil-k">escrow</span>
            <span className="sm-vault-sigil-v">{toPhiLabel(p.escrowPhiMicro)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export const VaultProphecies = (props: Readonly<{ now: KaiMoment; authorPhiKey: string }>) => {
  const { prophecies } = useProphecyFeed({ authorPhiKey: props.authorPhiKey, nowPulse: props.now.pulse, includeExpired: true });

  const sorted = useMemo(() => [...prophecies].slice(0, 40), [prophecies]);

  if (sorted.length === 0) {
    return (
      <Card variant="glass">
        <CardContent>
          <div className="sm-title">No prophecy sigils yet.</div>
          <div className="sm-subtitle" style={{ marginTop: 8 }}>
            Seal a prophecy to bind it to your ΦKey and store it here.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="sm-vault-proph-list">
      {sorted.map((p) => (
        <ProphecyRow key={p.id as unknown as string} prophecy={p} now={props.now} />
      ))}
    </div>
  );
};
