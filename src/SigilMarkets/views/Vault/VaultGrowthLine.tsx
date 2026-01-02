// SigilMarkets/views/Vault/VaultActions.tsx
"use client";

import React from "react";
import type { KaiMoment } from "../../types/marketTypes";
import type { VaultRecord } from "../../types/vaultTypes";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Button } from "../../ui/atoms/Button";
import { Icon } from "../../ui/atoms/Icon";

export type VaultActionsProps = Readonly<{
  vault: VaultRecord;
  now: KaiMoment;
  onDeposit: () => void;
  onWithdraw: () => void;
}>;

export const VaultActions = (props: VaultActionsProps) => {
  return (
    <Card variant="glass2">
      <CardContent>
        <div className="sm-vault-actions">
          <Button variant="primary" onClick={props.onDeposit} leftIcon={<Icon name="plus" size={14} tone="cyan" />}>
            Deposit
          </Button>
          <Button variant="ghost" onClick={props.onWithdraw} leftIcon={<Icon name="minus" size={14} tone="dim" />}>
            Withdraw
          </Button>
        </div>
        <div className="sm-small" style={{ marginTop: 10 }}>
          Deposits/withdrawals are local in MVP. Wire to payments/transfer rails in integration.
        </div>
      </CardContent>
    </Card>
  );
};
