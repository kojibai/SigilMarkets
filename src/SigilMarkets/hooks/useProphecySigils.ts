// SigilMarkets/hooks/useProphecySigils.ts
"use client";

import { useCallback, useMemo } from "react";
import type { EvidenceBundle } from "../types/oracleTypes";
import type { KaiPulse, PhiMicro } from "../types/marketTypes";
import type { ProphecyRecord, ProphecySigilArtifact } from "../types/prophecySigilTypes";
import { useActiveVault } from "../state/vaultStore";
import { useSigilMarketsUi } from "../state/uiStore";
import { useSigilMarketsProphecySigilStore } from "../state/prophecySigilStore";
import { momentFromUTC } from "../../utils/kai_pulse";
import { canonicalizeEvidenceBundleV2 } from "../api/oracleApi";
import { computeZkPoseidonHash } from "../../utils/kai";
import { buildProofHints, generateZkProofFromPoseidonHash } from "../../utils/zkProof";
import {
  buildProphecyPayloadBase,
  buildProphecySvg,
  computeProphecyCanonicalHash,
  deriveProphecyId,
  encodeProphecyText,
  toMicroDecimal,
} from "../utils/prophecySigil";
import { registerSigilUrl } from "../../utils/sigilRegistry";
import { asSvgHash } from "../types/vaultTypes";
import { sha256Hex } from "../utils/ids";

export type SealProphecyRequest = Readonly<{
  text: string;
  category?: string;
  expirationPulse?: KaiPulse;
  escrowPhiMicro?: PhiMicro;
  evidence?: EvidenceBundle;
}>;

export type SealProphecyResult =
  | Readonly<{ ok: true; record: ProphecyRecord; sigil: ProphecySigilArtifact }>
  | Readonly<{ ok: false; error: string }>;

export type UseProphecySigilsResult = Readonly<{
  prophecies: readonly ProphecyRecord[];
  activeVault: ReturnType<typeof useActiveVault>;
  actions: Readonly<{
    sealProphecy: (req: SealProphecyRequest) => Promise<SealProphecyResult>;
    remove: (id: ProphecyRecord["id"]) => void;
    requireAuth: () => void;
  }>;
}>;

export const useProphecySigils = (): UseProphecySigilsResult => {
  const { state, actions } = useSigilMarketsProphecySigilStore();
  const activeVault = useActiveVault();
  const { actions: ui } = useSigilMarketsUi();

  const prophecies = useMemo(
    () => state.ids.map((id) => state.byId[id as unknown as string]).filter((p): p is ProphecyRecord => Boolean(p)),
    [state.byId, state.ids],
  );

  const requireAuth = useCallback(() => {
    ui.pushSheet({ id: "inhale-glyph", reason: "auth" });
  }, [ui]);

  const sealProphecy = useCallback(
    async (req: SealProphecyRequest): Promise<SealProphecyResult> => {
      if (!activeVault) {
        requireAuth();
        return { ok: false, error: "not authenticated" };
      }

      const text = req.text.trim();
      if (!text) return { ok: false, error: "prophecy text required" };

      const moment = momentFromUTC();
      const { encoded, enc } = encodeProphecyText(text);

      const evidence = await canonicalizeEvidenceBundleV2(req.evidence);

      const prophecyId = await deriveProphecyId({
        userPhiKey: activeVault.owner.userPhiKey,
        pulse: moment.pulse,
        text,
      });

      const escrowPhiMicro = toMicroDecimal(req.escrowPhiMicro);

      const payloadBase = buildProphecyPayloadBase({
        prophecyId,
        text,
        textEnc: enc,
        category: req.category,
        expirationPulse: req.expirationPulse,
        escrowPhiMicro,
        evidence,
        userPhiKey: activeVault.owner.userPhiKey,
        kaiSignature: activeVault.owner.kaiSignature,
        moment,
      });

      const canonicalHash = await computeProphecyCanonicalHash(payloadBase);
      const { hash: poseidonHash, secret } = await computeZkPoseidonHash(canonicalHash);

      const proofHints = buildProofHints(poseidonHash, { scheme: "groth16-poseidon" });
      const generated = await generateZkProofFromPoseidonHash({
        poseidonHash,
        secret,
        proofHints,
      });

      if (!generated) {
        return { ok: false, error: "ZK proof unavailable" };
      }

      const payload = {
        ...payloadBase,
        canonicalHash,
        zk: {
          scheme: "groth16-poseidon",
          proof: generated.proof,
          publicInputs: generated.zkPublicInputs,
          poseidonHash,
        },
      };

      const shouldUseLocal = typeof import.meta !== "undefined" && !!import.meta.env?.DEV;
      let sigilId = prophecyId as unknown as string;
      let svgText: string | null = null;
      let svgHashText: string | null = null;
      let sigilUrl: string | undefined;

      if (!shouldUseLocal) {
        let res = await fetch("/sigils/seal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "prophecy", payload, textEncoded: encoded }),
        });

        if (res.status === 404) {
          res = await fetch("/api/sigils/seal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "prophecy", payload, textEncoded: encoded }),
          });
        }

        if (res.ok) {
          const body = (await res.json()) as {
            sigilId?: string;
            svg?: string;
            svgHash?: string;
          };
          if (body && typeof body.svg === "string" && typeof body.svgHash === "string") {
            sigilId = typeof body.sigilId === "string" ? body.sigilId : sigilId;
            svgText = body.svg;
            svgHashText = body.svgHash;
            sigilUrl = `/sigils/${sigilId}.svg`;
          }
        }
      }

      if (!svgText || !svgHashText) {
        svgText = buildProphecySvg(payload, encoded);
        svgHashText = await sha256Hex(svgText);
        const blob = new Blob([svgText], { type: "image/svg+xml" });
        sigilUrl = URL.createObjectURL(blob);
      }

      const svgHash = asSvgHash(svgHashText);

      const sigil: ProphecySigilArtifact = {
        sigilId: prophecyId,
        svgHash,
        svg: svgText,
        url: sigilUrl,
        canonicalHash,
        payload,
        zk: payload.zk,
      };

      const record = actions.addProphecy({
        text,
        category: req.category,
        expirationPulse: req.expirationPulse,
        escrowPhiMicro: req.escrowPhiMicro,
        evidence,
        sigil,
        createdAtPulse: moment.pulse,
      });

      if (sigilUrl) registerSigilUrl(sigilUrl);
      ui.toast("success", "Prophecy sealed", undefined, { atPulse: moment.pulse });

      return { ok: true, record, sigil };
    },
    [actions, activeVault, requireAuth, ui],
  );

  const remove = useCallback(
    (id: ProphecyRecord["id"]) => {
      actions.removeProphecy(id);
      ui.toast("info", "Removed", "Prophecy removed");
    },
    [actions, ui],
  );

  return {
    prophecies,
    activeVault,
    actions: {
      sealProphecy,
      remove,
      requireAuth,
    },
  };
};
