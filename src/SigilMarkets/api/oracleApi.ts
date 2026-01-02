// SigilMarkets/api/oracleApi.ts
"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * SigilMarkets — oracleApi
 *
 * MVP responsibilities:
 * - Provide a simple interface for:
 *   - proposing a resolution (optional)
 *   - finalizing a resolution
 *
 * This module intentionally does NOT decide policy.
 * It just transports/normalizes "resolution objects" for stores to apply.
 */

import type { KaiMoment, KaiPulse, MarketId, MarketOutcome } from "../types/marketTypes";
import { asEvidenceHash } from "../types/marketTypes";

import type {
  EvidenceBundle,
  EvidenceItem,
  OracleResolutionFinal,
  OracleResolutionProposal,
  OracleSig,
  OracleSigner,
  ResolutionSigilPayloadV1,
  EvidenceUrl,
} from "../types/oracleTypes";

import { asEvidenceBundleHash, asEvidenceUrl, asOracleDecisionId } from "../types/oracleTypes";
import type { MarketOraclePolicy } from "../types/marketTypes";
import type { KaiSignature, UserPhiKey } from "../types/vaultTypes";
import { sha256Hex } from "../utils/ids";

type UnknownRecord = Record<string, unknown>;
const isString = (v: unknown): v is string => typeof v === "string";

/** Typed guards (safe + clean) */
const isUrlItem = (item: EvidenceItem): item is Extract<EvidenceItem, { kind: "url" }> => item.kind === "url";
const isHashItem = (item: EvidenceItem): item is Extract<EvidenceItem, { kind: "hash" }> => item.kind === "hash";

export type SigilMarketsOracleApiConfig = Readonly<{
  /** Optional remote base for oracle actions. If absent, oracleApi is local-only. */
  baseUrl?: string;
  /** Endpoint path for posting a resolution proposal. Default: "/oracle/propose" */
  proposePath?: string;
  /** Endpoint path for finalizing a resolution. Default: "/oracle/finalize" */
  finalizePath?: string;
}>;

export type OracleActionResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: string }>;

export const defaultOracleApiConfig = (): SigilMarketsOracleApiConfig => {
  const g = globalThis as unknown as UnknownRecord;
  const base = isString(g["__SIGIL_MARKETS_ORACLE_API_BASE__"])
    ? (g["__SIGIL_MARKETS_ORACLE_API_BASE__"] as string)
    : undefined;

  return { baseUrl: base, proposePath: "/oracle/propose", finalizePath: "/oracle/finalize" };
};

/**
 * Canonicalize minimal evidence bundle and optionally compute a bundle hash.
 *
 * Fix:
 * - Produces real EvidenceItem types (EvidenceUrl / EvidenceHash branded values).
 * - Uses EvidenceUrl explicitly (no unused import).
 */
export const canonicalizeEvidenceBundle = async (bundle?: EvidenceBundle): Promise<EvidenceBundle | undefined> => {
  if (!bundle) return undefined;

  const normalized: EvidenceItem[] = [];

  for (const it of bundle.items) {
    if (it.kind === "url") {
      const raw = (it.url as unknown as string).trim();
      if (raw.length === 0) continue;

      // ✅ Use the branded EvidenceUrl type explicitly
      const url: EvidenceUrl = asEvidenceUrl(raw);

      normalized.push({
        kind: "url",
        url,
        label: it.label,
        note: it.note,
      });
      continue;
    }

    // hash
    const raw = (it.hash as unknown as string).trim();
    if (raw.length === 0) continue;

    normalized.push({
      kind: "hash",
      hash: asEvidenceHash(raw),
      label: it.label,
      note: it.note,
    });
  }

  // Data used for hashing: stable minimal representation (no label/note).
  const data = {
    items: normalized.map((it) =>
      it.kind === "url"
        ? { kind: "url" as const, url: it.url }
        : { kind: "hash" as const, hash: it.hash },
    ),
    summary: bundle.summary ?? "",
  };

  const bundleHash = await sha256Hex(JSON.stringify(data));

  return {
    items: normalized,
    summary: bundle.summary,
    bundleHash: asEvidenceBundleHash(bundleHash),
  };
};

/**
 * Local "proposal" creation:
 * - Generates deterministic decisionId from (marketId, outcome, proposedPulse, oracle provider)
 */
export const createLocalProposal = async (args: Readonly<{
  marketId: MarketId;
  outcome: MarketOutcome;
  proposedPulse: KaiPulse;
  oracle: MarketOraclePolicy;
  evidence?: EvidenceBundle;
  attestations?: readonly Readonly<{ signer: OracleSigner; sig: OracleSig; atPulse: KaiPulse; weight?: number }>[];
}>): Promise<OracleResolutionProposal> => {
  const ev = await canonicalizeEvidenceBundle(args.evidence);

  const key = `SM:ORACLE:PROPOSE:${args.marketId}:${args.outcome}:${args.proposedPulse}:${args.oracle.provider}:${args.oracle.oracleId ?? ""}`;
  const h = await sha256Hex(key);

  return {
    decisionId: asOracleDecisionId(`dec_${h.slice(0, 40)}`),
    marketId: args.marketId,
    outcome: args.outcome,
    proposedPulse: args.proposedPulse,
    oracle: args.oracle,
    evidence: ev,
    attestations: args.attestations,
  };
};

/**
 * Local "finalization" creation:
 * - Can reference a proposal or finalize directly
 */
export const createLocalFinalization = async (args: Readonly<{
  proposal?: OracleResolutionProposal;
  marketId: MarketId;
  outcome: MarketOutcome;
  finalPulse: KaiPulse;
  oracle: MarketOraclePolicy;
  evidence?: EvidenceBundle;
  finalAttestations?: readonly Readonly<{ signer: OracleSigner; sig: OracleSig; atPulse: KaiPulse; weight?: number }>[];
  dispute?: OracleResolutionFinal["dispute"];
}>): Promise<OracleResolutionFinal> => {
  const ev = await canonicalizeEvidenceBundle(args.evidence ?? args.proposal?.evidence);

  const baseKey = args.proposal
    ? `SM:ORACLE:FINAL:${args.proposal.decisionId}:${args.finalPulse}`
    : `SM:ORACLE:FINAL:${args.marketId}:${args.outcome}:${args.finalPulse}:${args.oracle.provider}:${args.oracle.oracleId ?? ""}`;

  const h = await sha256Hex(baseKey);
  const decisionId = args.proposal ? args.proposal.decisionId : asOracleDecisionId(`dec_${h.slice(0, 40)}`);

  return {
    decisionId,
    marketId: args.marketId,
    outcome: args.outcome,
    finalPulse: args.finalPulse,
    oracle: args.oracle,
    proposedPulse: args.proposal?.proposedPulse,
    evidence: ev,
    dispute: args.dispute,
    finalAttestations: args.finalAttestations,
  };
};

/**
 * Mint a Resolution Sigil payload (portable proof).
 * Rendering the SVG happens in sigils/ResolutionSigilMint.tsx.
 */
export const makeResolutionSigilPayload = async (args: Readonly<{
  marketId: MarketId;
  outcome: MarketOutcome;
  oracle: MarketOraclePolicy;
  proposedPulse?: KaiPulse;
  finalPulse: KaiPulse;
  evidence?: EvidenceBundle;
  mintedAt: KaiMoment;
  mintedBy?: Readonly<{ userPhiKey: UserPhiKey; kaiSignature: KaiSignature }>;
  label?: string;
}>): Promise<ResolutionSigilPayloadV1> => {
  const ev = await canonicalizeEvidenceBundle(args.evidence);

  return {
    v: "SM-RES-1",
    kind: "resolution",
    marketId: args.marketId,
    outcome: args.outcome,
    oracle: args.oracle,
    proposedPulse: args.proposedPulse,
    finalPulse: args.finalPulse,
    evidence: ev
      ? {
          bundleHash: ev.bundleHash,
          urls: ev.items.filter(isUrlItem).map((i) => (i.url as unknown as string)),
          hashes: ev.items.filter(isHashItem).map((i) => (i.hash as unknown as string)),
          summary: ev.summary,
        }
      : undefined,
    attestations: undefined,
    mintedBy: args.mintedBy ? { userPhiKey: args.mintedBy.userPhiKey, kaiSignature: args.mintedBy.kaiSignature } : undefined,
    mintedAt: args.mintedAt,
    label: args.label,
  };
};

/**
 * Placeholder remote calls (optional).
 * For now, these return a clear error (MVP local-only).
 */
export const postProposal = async (
  _cfg: SigilMarketsOracleApiConfig,
  _proposal: OracleResolutionProposal,
): Promise<OracleActionResult<true>> => {
  return { ok: false, error: "remote oracle propose not implemented in MVP" };
};

export const postFinalization = async (
  _cfg: SigilMarketsOracleApiConfig,
  _final: OracleResolutionFinal,
): Promise<OracleActionResult<true>> => {
  return { ok: false, error: "remote oracle finalize not implemented in MVP" };
};
