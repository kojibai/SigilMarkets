// SigilMarkets/views/Vault/VaultActions.tsx
"use client";

import { useMemo } from "react";
import type { KaiMoment } from "../../types/marketTypes";
import type { VaultRecord } from "../../types/vaultTypes";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Button } from "../../ui/atoms/Button";
import { Icon } from "../../ui/atoms/Icon";
import { formatPhiMicro, formatPhiMicroCompact } from "../../utils/format";

export type VaultActionsProps = Readonly<{
  vault: VaultRecord;
  now: KaiMoment;
  onDeposit: () => void;
  onWithdraw: () => void;
}>;

export const VaultActions = (props: VaultActionsProps) => {
  const spendable = props.vault.spendableMicro;
  const locked = props.vault.lockedMicro;

  const spendableLabel = useMemo(
    () => formatPhiMicroCompact(spendable, { withUnit: true, maxSig: 5 }),
    [spendable],
  );

  const lockedLabel = useMemo(
    () => formatPhiMicroCompact(locked, { withUnit: true, maxSig: 5 }),
    [locked],
  );

  const isFrozen = props.vault.status === "frozen";

  return (
    <Card variant="glass2">
      <CardContent>
        <div className="sm-vault-actions-head">
          <div className="sm-vault-actions-title">
            <Icon name="vault" size={14} tone="gold" /> Actions
          </div>
          <div className="sm-small">pulse {props.now.pulse}</div>
        </div>

        <div className="sm-vault-actions-badges">
          <span className="sm-pill">
            <Icon name="vault" size={14} tone="dim" /> spendable {spendableLabel}
          </span>
          <span className="sm-pill">
            <Icon name="positions" size={14} tone="dim" /> locked {lockedLabel}
          </span>
        </div>

        <div className="sm-vault-actions-row">
          <Button
            variant="primary"
            onClick={props.onDeposit}
            leftIcon={<Icon name="plus" size={14} tone="cyan" />}
            disabled={isFrozen}
          >
            Deposit
          </Button>

          <Button
            variant="ghost"
            onClick={props.onWithdraw}
            leftIcon={<Icon name="minus" size={14} tone="dim" />}
            disabled={isFrozen}
          >
            Withdraw
          </Button>
        </div>

        {isFrozen ? (
          <div className="sm-small" style={{ marginTop: 10 }}>
            Vault is frozen — deposits/withdrawals are disabled.
          </div>
        ) : (
          <div className="sm-small" style={{ marginTop: 10 }}>
            Deposits/withdrawals are local in MVP. Wire to real rails in integration.
          </div>
        )}
      </CardContent>
    </Card>
  );
};
