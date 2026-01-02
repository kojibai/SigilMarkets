// SigilMarkets/views/Vault/VaultPanel.tsx
"use client";

import React, { useMemo, useState } from "react";
import type { KaiMoment, VaultId } from "../../types/marketTypes";
import { useSigilMarketsUi } from "../../state/uiStore";
import { useScrollRestoration } from "../../hooks/useScrollRestoration";
import { useVault, useVaultActions } from "../../hooks/useVault";

import { TopBar } from "../../ui/chrome/TopBar";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Button } from "../../ui/atoms/Button";
import { Divider } from "../../ui/atoms/Divider";
import { Icon } from "../../ui/atoms/Icon";

import { VaultSigilCard } from "./VaultSigilCard";
import { VaultBalance } from "./VaultBalance";
import { VaultLocks } from "./VaultLocks";
import { VaultGrowthLine } from "./VaultGrowthLine";
import { VaultStreak } from "./VaultStreak";
import { VaultActions } from "./VaultActions";
import { DepositWithdrawSheet } from "./DepositWithdrawSheet";

export type VaultPanelProps = Readonly<{
  vaultId?: VaultId;
  now: KaiMoment;
  scrollMode: "window" | "container";
  scrollRef: React.RefObject<HTMLDivElement | null> | null;
}>;

export const VaultPanel = (props: VaultPanelProps) => {
  const { state: uiState, actions: ui } = useSigilMarketsUi();

  useScrollRestoration(uiState.route, {
    mode: props.scrollMode,
    containerRef: props.scrollRef ?? undefined,
    restoreDelayMs: 0,
  });

  const { vault, status, spendableMicro, lockedMicro, lockedCount, locks } = useVault(props.vaultId ?? null);
  const vaultActions = useVaultActions();

  const [dwOpen, setDwOpen] = useState<boolean>(false);
  const [dwMode, setDwMode] = useState<"deposit" | "withdraw">("deposit");

  const title = "Vault";
  const subtitle = useMemo(() => {
    if (!vault) return "Inhale a glyph to activate";
    return `spendable • ${vault.spendableMicro.toString()}μ`;
  }, [vault]);

  const onBack = (): void => {
    ui.navigate({ view: "grid" });
  };

  if (!vault) {
    return (
      <div className="sm-page" data-sm="vault">
        <TopBar
          title={title}
          subtitle="No active vault"
          now={props.now}
          scrollMode={props.scrollMode}
          scrollRef={props.scrollRef}
          back
          onBack={onBack}
        />

        <Card variant="glass" className="sm-vault-empty">
          <CardContent>
            <div className="sm-title">Inhale your glyph</div>
            <div className="sm-subtitle" style={{ marginTop: 8 }}>
              Your Vault is the value-layer bound to your identity sigil. It holds spendable Φ and locks Φ into positions.
            </div>

            <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Button
                variant="primary"
                onClick={() => ui.pushSheet({ id: "inhale-glyph", reason: "vault" })}
                leftIcon={<Icon name="scan" size={14} tone="cyan" />}
              >
                Inhale glyph
              </Button>

              <Button variant="ghost" onClick={() => ui.navigate({ view: "grid" })}>
                Browse markets
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="sm-page" data-sm="vault">
      <TopBar
        title={title}
        subtitle={`locks • ${lockedCount} • pulse ${props.now.pulse}`}
        now={props.now}
        scrollMode={props.scrollMode}
        scrollRef={props.scrollRef}
        back
        onBack={onBack}
      />

      <div className="sm-vault-stack">
        <VaultSigilCard vault={vault} now={props.now} />

        <div className="sm-vault-row">
          <VaultBalance vault={vault} />
          <VaultStreak vault={vault} now={props.now} />
        </div>

        <VaultGrowthLine vault={vault} now={props.now} />

        <VaultLocks vault={vault} />

        <Divider />

        <VaultActions
          vault={vault}
          now={props.now}
          onDeposit={() => {
            setDwMode("deposit");
            setDwOpen(true);
          }}
          onWithdraw={() => {
            setDwMode("withdraw");
            setDwOpen(true);
          }}
        />
      </div>

      <DepositWithdrawSheet
        open={dwOpen}
        mode={dwMode}
        onClose={() => setDwOpen(false)}
        vault={vault}
        now={props.now}
      />
    </div>
  );
};
