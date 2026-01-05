// SigilMarkets/sigils/ProphecySigilMint.tsx
"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

import type { EvidenceBundle } from "../types/oracleTypes";
import type { KaiMoment, KaiPulse } from "../types/marketTypes";
import type { VaultRecord } from "../types/vaultTypes";
import type {
  ProphecySigilArtifact,
  ProphecySigilPayloadV1,
  ProphecyTextEncoding,
  ProphecyZkBundle,
} from "../types/prophecyTypes";
import { asProphecyId } from "../types/prophecyTypes";
import { asSvgHash } from "../types/vaultTypes";
import { canonicalizeEvidenceBundleV2 } from "../api/oracleApi";
import { computeZkPoseidonHash } from "../../utils/kai";
import { buildProofHints, generateZkProofFromPoseidonHash } from "../../utils/zkProof";
import { momentFromPulse } from "../../utils/kai_pulse";
import { sha256Hex } from "../utils/ids";
import { encodeProphecyText, computeProphecyCanonicalHash } from "../utils/prophecySigil";

const deriveProphecyId = async (seed: string) => {
  const h = await sha256Hex(`SM:PROPHECY:ID:${seed}`);
  return asProphecyId(`prophecy_${h.slice(0, 40)}`);
};

const stepPctFromPulse = (pulse: KaiPulse): number | undefined => {
  const moment = momentFromPulse(pulse) as unknown as { stepPctAcrossBeat?: number };
  if (typeof moment.stepPctAcrossBeat === "number" && Number.isFinite(moment.stepPctAcrossBeat)) {
    return moment.stepPctAcrossBeat;
  }
  return undefined;
};

export type MintProphecyInput = Readonly<{
  text: string;
  category?: string;
  expirationPulse?: KaiPulse;
  escrowPhiMicro?: string;
  evidence?: EvidenceBundle;
  now: KaiMoment;
  vault: VaultRecord;
}>;

export type MintProphecyResult =
  | Readonly<{ ok: true; sigil: ProphecySigilArtifact; svgText: string }>
  | Readonly<{ ok: false; error: string }>;

export const mintProphecySigil = async (input: MintProphecyInput): Promise<MintProphecyResult> => {
  try {
    const text = input.text.trim();
    if (!text) return { ok: false, error: "Prophecy text is required." };

    const textEnc: ProphecyTextEncoding = "uri";
    const textEncoded = encodeProphecyText(text, textEnc);

    const normalizedEvidence = await canonicalizeEvidenceBundleV2(input.evidence);
    const stepPct = stepPctFromPulse(input.now.pulse);

    const prophecyId = await deriveProphecyId(
      `${input.vault.owner.userPhiKey}:${input.now.pulse}:${text}`,
    );

    const draft: Omit<ProphecySigilPayloadV1, "canonicalHash" | "zk"> = {
      v: "SM-PROPHECY-1",
      kind: "prophecy",
      prophecyId,
      text,
      textEnc,
      textEncoded,
      category: input.category?.trim() || undefined,
      expirationPulse: input.expirationPulse,
      escrowPhiMicro: input.escrowPhiMicro,
      evidence: normalizedEvidence,
      userPhiKey: input.vault.owner.userPhiKey,
      kaiSignature: input.vault.owner.kaiSignature,
      pulse: input.now.pulse,
      beat: input.now.beat,
      stepIndex: input.now.stepIndex,
      stepPct,
      createdAt: input.now,
      createdAtPulse: input.now.pulse,
    };

    const canonicalHash = await computeProphecyCanonicalHash(draft);
    const { hash: poseidonHash, secret } = await computeZkPoseidonHash(canonicalHash);
    const proofHints = buildProofHints(poseidonHash);

    const proofBundle = await generateZkProofFromPoseidonHash({
      poseidonHash,
      secret,
      proofHints,
    });

    if (!proofBundle) {
      return { ok: false, error: "ZK proof generation failed." };
    }

    const zk: ProphecyZkBundle = {
      scheme: proofHints.scheme,
      proof: proofBundle.proof,
      publicInputs: proofBundle.zkPublicInputs,
      poseidonHash,
    };

    const payload: ProphecySigilPayloadV1 = {
      ...draft,
      canonicalHash: canonicalHash as ProphecySigilPayloadV1["canonicalHash"],
      zk,
    };

    const res = await fetch("/sigils/seal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "prophecy", payload }),
    });

    if (!res.ok) {
      const msg = await res.text();
      return { ok: false, error: msg || `Seal failed (${res.status})` };
    }

    const body = (await res.json()) as {
      sigilId?: string;
      svg?: string;
      svgHash?: string;
      url?: string;
      canonicalHash?: string;
    };

    const svgText = body.svg ?? "";
    const svgHash = asSvgHash(body.svgHash ?? (await sha256Hex(svgText)));
    const url = body.url ?? (svgText ? URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" })) : undefined);

    const sigil: ProphecySigilArtifact = {
      svgHash,
      url,
      svgText,
      canonicalHash: (body.canonicalHash ?? canonicalHash) as ProphecySigilPayloadV1["canonicalHash"],
      payload,
      zk,
    };

    return { ok: true, sigil, svgText };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Mint failed";
    return { ok: false, error: msg };
  }
};
