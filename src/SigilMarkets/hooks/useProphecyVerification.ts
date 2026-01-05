// SigilMarkets/hooks/useProphecyVerification.ts
"use client";

import { useEffect, useMemo, useState } from "react";
import type { KaiPulse } from "../types/marketTypes";
import type { ProphecySigilPayloadV1 } from "../types/prophecyTypes";
import type { VerifyState } from "../../types/sigil";
import { tryVerifyGroth16 } from "../../components/VerifierStamper/zk";
import { verifyProphecyPayload } from "../utils/prophecySigil";

const loadVkey = async (): Promise<unknown | null> => {
  try {
    const res = await fetch("/zk/verification_key.json", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
};

export type ProphecyVerification = Readonly<{
  signature: VerifyState;
  canonical: VerifyState;
  zk: VerifyState;
  zkScheme?: string;
  nowPulse?: KaiPulse;
}>;

export const useProphecyVerification = (payload?: ProphecySigilPayloadV1 | null, nowPulse?: KaiPulse) => {
  const [signature, setSignature] = useState<VerifyState>("checking");
  const [canonical, setCanonical] = useState<VerifyState>("checking");
  const [zk, setZk] = useState<VerifyState>("checking");
  const [vkey, setVkey] = useState<unknown | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      if (!payload) {
        if (!active) return;
        setSignature("notfound");
        setCanonical("notfound");
        setZk("notfound");
        return;
      }

      const res = await verifyProphecyPayload(payload);
      if (!active) return;

      setSignature(res.signatureMatches === null ? "notfound" : res.signatureMatches ? "ok" : "mismatch");
      setCanonical(res.canonicalHashMatches === null ? "notfound" : res.canonicalHashMatches ? "ok" : "mismatch");
    })();

    return () => {
      active = false;
    };
  }, [payload]);

  useEffect(() => {
    let active = true;
    if (!payload?.zk?.proof || !payload.zk.publicInputs || payload.zk.publicInputs.length === 0) {
      setZk("notfound");
      return;
    }

    (async () => {
      if (!vkey) {
        const loaded = await loadVkey();
        if (!active) return;
        setVkey(loaded);
      }
      const verified = await tryVerifyGroth16({
        proof: payload.zk.proof,
        publicSignals: payload.zk.publicInputs,
        vkey: vkey ?? undefined,
        fallbackVkey: vkey ?? undefined,
      });

      if (!active) return;
      if (verified === null) setZk("na");
      else setZk(verified ? "ok" : "mismatch");
    })();

    return () => {
      active = false;
    };
  }, [payload, vkey]);

  return useMemo<ProphecyVerification>(
    () => ({
      signature,
      canonical,
      zk,
      zkScheme: payload?.zk?.scheme,
      nowPulse,
    }),
    [canonical, nowPulse, payload?.zk?.scheme, signature, zk],
  );
};
