// SigilMarkets/utils/prophecySigil.ts
"use client";

import type { EvidenceBundle } from "../types/oracleTypes";
import type { KaiMoment, KaiPulse } from "../types/marketTypes";
import type {
  ProphecySigilPayloadV1,
  ProphecyTextEncoding,
  ProphecyZkBundle,
} from "../types/prophecyTypes";
import { sha256Hex } from "./ids";
import { derivePhiKeyFromSig } from "../../components/VerifierStamper/sigilUtils";

type UnknownRecord = Record<string, unknown>;

const isRecord = (v: unknown): v is UnknownRecord => typeof v === "object" && v !== null;

type JSONPrimitive = string | number | boolean | null;
interface JSONObject {
  readonly [k: string]: JSONValue;
}
type JSONValue = JSONPrimitive | ReadonlyArray<JSONValue> | JSONObject;

const isJsonPrimitive = (v: unknown): v is JSONPrimitive =>
  v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

const toJsonValue = (v: unknown): JSONValue => {
  if (isJsonPrimitive(v)) return v;
  if (Array.isArray(v)) return v.map((x) => toJsonValue(x));
  if (isRecord(v)) {
    const out: Record<string, JSONValue> = {};
    const keys = Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const k of keys) out[k] = toJsonValue(v[k]);
    return out;
  }
  return String(v);
};

export const stableStringify = (v: JSONValue): string => {
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : JSON.stringify(String(v));
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x)).join(",")}]`;
  if (typeof v !== "object" || v === null) return JSON.stringify(String(v));
  const keys = Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const obj = v as JSONObject;
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
};

const base64Encode = (text: string): string => {
  if (typeof btoa === "function") {
    return btoa(unescape(encodeURIComponent(text)));
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(text, "utf8").toString("base64");
  }
  throw new Error("base64 encoder unavailable");
};

const base64Decode = (raw: string): string => {
  if (typeof atob === "function") {
    return decodeURIComponent(escape(atob(raw)));
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(raw, "base64").toString("utf8");
  }
  throw new Error("base64 decoder unavailable");
};

export const encodeProphecyText = (text: string, enc: ProphecyTextEncoding): string => {
  return enc === "b64" ? base64Encode(text) : encodeURIComponent(text);
};

export const decodeProphecyText = (encoded: string, enc: ProphecyTextEncoding): string => {
  try {
    return enc === "b64" ? base64Decode(encoded) : decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
};

const evidenceToCanonical = (evidence?: EvidenceBundle) => {
  if (!evidence) return null;
  return {
    bundleHash: evidence.bundleHash ?? null,
    summary: evidence.summary ?? null,
    items: evidence.items.map((it) =>
      it.kind === "url" ? { kind: "url" as const, url: it.url } : { kind: "hash" as const, hash: it.hash },
    ),
  };
};

export type ProphecyCanonicalInput = Readonly<{
  v: ProphecySigilPayloadV1["v"];
  kind: ProphecySigilPayloadV1["kind"];
  prophecyId: ProphecySigilPayloadV1["prophecyId"];
  text: string;
  textEnc: ProphecyTextEncoding;
  category?: string;
  expirationPulse?: KaiPulse;
  escrowPhiMicro?: string;
  evidence?: EvidenceBundle;
  userPhiKey: ProphecySigilPayloadV1["userPhiKey"];
  kaiSignature: ProphecySigilPayloadV1["kaiSignature"];
  pulse: KaiPulse;
  beat: number;
  stepIndex: number;
  stepPct?: number;
  createdAt: KaiMoment;
  createdAtPulse: KaiPulse;
}>;

export const canonicalizeProphecyPayload = (input: ProphecyCanonicalInput): JSONValue =>
  toJsonValue({
    v: input.v,
    kind: input.kind,
    prophecyId: input.prophecyId,
    text: input.text,
    textEnc: input.textEnc,
    category: input.category ?? null,
    expirationPulse: input.expirationPulse ?? null,
    escrowPhiMicro: input.escrowPhiMicro ?? null,
    evidence: evidenceToCanonical(input.evidence),
    userPhiKey: input.userPhiKey,
    kaiSignature: input.kaiSignature,
    pulse: input.pulse,
    beat: input.beat,
    stepIndex: input.stepIndex,
    stepPct: input.stepPct ?? null,
    createdAt: input.createdAt,
    createdAtPulse: input.createdAtPulse,
  });

export const computeProphecyCanonicalHash = async (input: ProphecyCanonicalInput): Promise<string> => {
  const canonStr = stableStringify(canonicalizeProphecyPayload(input));
  return sha256Hex(`SM:PROPHECY:CANON:${canonStr}`);
};

const toNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.floor(n);
  }
  return null;
};

const toFloat = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

const getAttr = (svgText: string, key: string): string | undefined => {
  const re = new RegExp(`${key}=["']([^"']+)["']`, "i");
  const match = svgText.match(re);
  return match?.[1];
};

const stripCdata = (value: string): string =>
  value.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").trim();

const parseProofBundle = (raw?: string | null, enc?: string | null): unknown => {
  if (!raw) return undefined;
  const decoded = enc === "b64" ? base64Decode(raw) : raw;
  try {
    return JSON.parse(decoded);
  } catch {
    return undefined;
  }
};

export type ProphecySvgMeta = Readonly<{
  payload?: ProphecySigilPayloadV1;
  zk?: ProphecyZkBundle;
  text?: string;
}>;

export const extractProphecyMetaFromSvg = (svgText: string): ProphecySvgMeta | null => {
  const metaMatch = svgText.match(/<metadata[^>]*id=["']sm-prophecy["'][^>]*>([\s\S]*?)<\/metadata>/i);
  if (metaMatch?.[1]) {
    const cleaned = stripCdata(metaMatch[1]);
    try {
      const parsed = JSON.parse(cleaned) as unknown;
      if (isRecord(parsed)) {
        const payload = parsed as ProphecySigilPayloadV1;
        return {
          payload,
          zk: isRecord(payload.zk) ? (payload.zk as ProphecyZkBundle) : undefined,
          text: typeof payload.text === "string" ? payload.text : undefined,
        };
      }
    } catch {
      // fall through
    }
  }

  const kind = getAttr(svgText, "data-kind");
  if (kind !== "prophecy") return null;

  const v = getAttr(svgText, "data-v") ?? "SM-PROPHECY-1";
  const prophecyId = getAttr(svgText, "data-prophecy-id") ?? "";
  const textEnc = (getAttr(svgText, "data-text-enc") ?? "uri") as ProphecyTextEncoding;
  const encodedText = getAttr(svgText, "data-text") ?? "";
  const decodedText = encodedText ? decodeProphecyText(encodedText, textEnc) : "";

  const pulse = toNumber(getAttr(svgText, "data-pulse")) ?? 0;
  const beat = toNumber(getAttr(svgText, "data-beat")) ?? 0;
  const stepIndex = toNumber(getAttr(svgText, "data-step-index")) ?? 0;
  const stepPct = toFloat(getAttr(svgText, "data-step-pct")) ?? undefined;

  const userPhiKey = getAttr(svgText, "data-phi-key") ?? getAttr(svgText, "data-phikey") ?? "";
  const kaiSignature = getAttr(svgText, "data-kai-signature") ?? "";
  const canonicalHash = getAttr(svgText, "data-canonical-hash") ?? "";

  const category = getAttr(svgText, "data-category") ?? undefined;
  const expirationPulse = toNumber(getAttr(svgText, "data-expiration")) ?? undefined;
  const escrowPhiMicro = getAttr(svgText, "data-phi-escrow-micro") ?? undefined;

  const zkScheme = getAttr(svgText, "data-zk-scheme") ?? undefined;
  const zkPoseidonHash = getAttr(svgText, "data-zk-poseidon-hash") ?? undefined;
  const proofEnc = getAttr(svgText, "data-zk-proof-enc") ?? null;
  const publicEnc = getAttr(svgText, "data-zk-public-enc") ?? null;
  const zkProof = parseProofBundle(getAttr(svgText, "data-zk-proof"), proofEnc);
  const zkPublicInputs = parseProofBundle(getAttr(svgText, "data-zk-public"), publicEnc);

  const payload: ProphecySigilPayloadV1 = {
    v: v === "SM-PROPHECY-1" ? "SM-PROPHECY-1" : "SM-PROPHECY-1",
    kind: "prophecy",
    prophecyId: prophecyId as ProphecySigilPayloadV1["prophecyId"],
    text: decodedText,
    textEnc,
    textEncoded: encodedText,
    category: category && category.length > 0 ? category : undefined,
    expirationPulse,
    escrowPhiMicro: escrowPhiMicro && escrowPhiMicro.length > 0 ? escrowPhiMicro : undefined,
    evidence: undefined,
    userPhiKey: userPhiKey as ProphecySigilPayloadV1["userPhiKey"],
    kaiSignature: kaiSignature as ProphecySigilPayloadV1["kaiSignature"],
    canonicalHash: canonicalHash as ProphecySigilPayloadV1["canonicalHash"],
    pulse,
    beat,
    stepIndex,
    stepPct,
    createdAt: { pulse, beat, stepIndex },
    createdAtPulse: pulse,
    zk:
      zkScheme && zkProof && Array.isArray(zkPublicInputs)
        ? {
            scheme: zkScheme,
            proof: zkProof,
            publicInputs: zkPublicInputs.map((x) => String(x)),
            poseidonHash: zkPoseidonHash ?? undefined,
          }
        : undefined,
  };

  return { payload, zk: payload.zk, text: decodedText };
};

export type ProphecyVerifySummary = Readonly<{
  canonicalHashMatches: boolean | null;
  signatureMatches: boolean | null;
}>;

export const verifyProphecyPayload = async (payload: ProphecySigilPayloadV1): Promise<ProphecyVerifySummary> => {
  const canonicalHash = payload.canonicalHash as unknown as string;
  const recomputed = await computeProphecyCanonicalHash({
    v: payload.v,
    kind: payload.kind,
    prophecyId: payload.prophecyId,
    text: payload.text,
    textEnc: payload.textEnc,
    category: payload.category,
    expirationPulse: payload.expirationPulse,
    escrowPhiMicro: payload.escrowPhiMicro,
    evidence: payload.evidence,
    userPhiKey: payload.userPhiKey,
    kaiSignature: payload.kaiSignature,
    pulse: payload.pulse,
    beat: payload.beat,
    stepIndex: payload.stepIndex,
    stepPct: payload.stepPct,
    createdAt: payload.createdAt,
    createdAtPulse: payload.createdAtPulse,
  });

  let signatureMatches: boolean | null = null;
  if (payload.kaiSignature && payload.userPhiKey) {
    const derived = await derivePhiKeyFromSig(String(payload.kaiSignature));
    signatureMatches = derived === String(payload.userPhiKey);
  }

  return {
    canonicalHashMatches: canonicalHash ? canonicalHash.toLowerCase() === recomputed.toLowerCase() : null,
    signatureMatches,
  };
};

export const prophecyWindowStatus = (expirationPulse: KaiPulse | undefined, nowPulse: KaiPulse): "open" | "closed" | "none" => {
  if (expirationPulse == null) return "none";
  return nowPulse >= expirationPulse ? "closed" : "open";
};
