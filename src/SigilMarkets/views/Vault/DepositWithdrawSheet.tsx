// SigilMarkets/views/Vault/DepositWithdrawSheet.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { KaiMoment, PhiMicro } from "../../types/marketTypes";
import type { VaultRecord } from "../../types/vaultTypes";
import { Sheet } from "../../ui/atoms/Sheet";
import { Button } from "../../ui/atoms/Button";
import { Divider } from "../../ui/atoms/Divider";
import { Icon } from "../../ui/atoms/Icon";
import { parsePhiToMicro, formatPhiMicro } from "../../utils/format";
import { useVaultActions } from "../../hooks/useVault";
import GlyphImportModal from "../../../components/GlyphImportModal";
import type { Glyph } from "../../../glyph/types";
import type { SigilMetadataLite } from "../../../utils/valuation";
import { ETERNAL_STEPS_PER_BEAT } from "../../../SovereignSolar";
import {
  makeSigilUrlLoose,
  type SigilSharePayloadLoose,
} from "../../../utils/sigilUrl";
import { registerSigilUrl } from "../../../utils/sigilRegistry";
import { enqueueInhaleKrystal, flushInhaleQueue } from "../../../components/SigilExplorer/inhaleQueue";

export type DepositWithdrawSheetProps = Readonly<{
  open: boolean;
  onClose: () => void;
  mode: "deposit" | "withdraw";
  vault: VaultRecord;
  now: KaiMoment;
}>;

export const DepositWithdrawSheet = (props: DepositWithdrawSheetProps) => {
  const { deposit, withdraw } = useVaultActions();

  const [amt, setAmt] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);

  useEffect(() => {
    if (props.mode !== "deposit") setDepositOpen(false);
  }, [props.mode]);

  const title = props.mode === "deposit" ? "Deposit Φ" : "Withdraw Φ";

  const spendableLabel = useMemo(
    () => formatPhiMicro(props.vault.spendableMicro, { withUnit: true, maxDecimals: 6, trimZeros: true }),
    [props.vault.spendableMicro],
  );

  const apply = (): void => {
    const r = parsePhiToMicro(amt);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setErr(null);

    if (props.mode === "deposit") deposit(props.vault.vaultId, r.micro as PhiMicro, props.now.pulse);
    else withdraw(props.vault.vaultId, r.micro as PhiMicro, props.now.pulse);

    setAmt("");
    props.onClose();
  };

  const handleRegisterGlyph = useCallback(
    (glyph: Glyph) => {
      const hash = typeof glyph.hash === "string" ? glyph.hash.toLowerCase() : "";
      if (!hash) return;
      const meta = (glyph.meta || {}) as SigilMetadataLite & Record<string, unknown>;
      const pulse =
        typeof meta.pulse === "number"
          ? meta.pulse
          : typeof meta.kaiPulse === "number"
          ? meta.kaiPulse
          : null;
      const beat = typeof meta.beat === "number" ? meta.beat : null;
      const stepIndex = typeof meta.stepIndex === "number" ? meta.stepIndex : null;
      const chakraDay = typeof meta.chakraDay === "string" ? meta.chakraDay : null;
      if (pulse == null || beat == null || stepIndex == null || !chakraDay) return;

      const payload: SigilSharePayloadLoose = {
        pulse,
        beat,
        stepIndex,
        chakraDay,
        stepsPerBeat: typeof meta.stepsPerBeat === "number" ? meta.stepsPerBeat : ETERNAL_STEPS_PER_BEAT,
        canonicalHash: hash,
        kaiSignature: typeof meta.kaiSignature === "string" ? meta.kaiSignature : undefined,
        userPhiKey: typeof meta.userPhiKey === "string" ? meta.userPhiKey : undefined,
        exportedAtPulse: typeof meta.exportedAtPulse === "number" ? meta.exportedAtPulse : undefined,
      };

      const url = makeSigilUrlLoose(hash, payload);
      registerSigilUrl(url);
      enqueueInhaleKrystal(url, payload);
      void flushInhaleQueue();
    },
    [enqueueInhaleKrystal, flushInhaleQueue, registerSigilUrl, makeSigilUrlLoose]
  );

  const handleDepositFromGlyph = useCallback(
    (amountPhi: number) => {
      const parsed = parsePhiToMicro(amountPhi.toString());
      if (!parsed.ok) {
        setErr(parsed.error);
        return;
      }
      setErr(null);
      deposit(props.vault.vaultId, parsed.micro as PhiMicro, props.now.pulse);
      setDepositOpen(false);
      props.onClose();
    },
    [deposit, props.vault.vaultId, props.now.pulse, props.onClose]
  );

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title={title}
      subtitle={`Spendable: ${spendableLabel}`}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          {props.mode === "deposit" ? (
            <Button
              variant="primary"
              onClick={() => setDepositOpen(true)}
              leftIcon={<Icon name="plus" size={14} tone="gold" />}
            >
              Upload glyph
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={apply}
              disabled={amt.trim().length === 0}
              leftIcon={<Icon name="vault" size={14} tone="gold" />}
            >
              Apply
            </Button>
          )}
        </div>
      }
    >
      <div className="sm-dw">
        {props.mode === "withdraw" ? (
          <input
            className="sm-input"
            value={amt}
            onChange={(e) => setAmt(e.target.value)}
            placeholder="e.g. 5.0"
            inputMode="decimal"
          />
        ) : (
          <div className="sm-small">
            Upload a verified sigil glyph to deposit Φ from its live valuation into your Vault.
          </div>
        )}
        {err ? <div className="sm-small" style={{ color: "rgba(255,104,104,0.90)", marginTop: 8 }}>{err}</div> : null}
        <Divider />
        <div className="sm-small">Deposits use live glyph verification; withdrawals move spendable Φ.</div>
      </div>
      <GlyphImportModal
        open={depositOpen && props.mode === "deposit"}
        onClose={() => setDepositOpen(false)}
        onImport={handleRegisterGlyph}
        onCreditPhi={handleDepositFromGlyph}
      />
    </Sheet>
  );
};
