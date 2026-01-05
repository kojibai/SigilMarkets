// SigilMarkets/utils/prophecySigil.ts
"use client";

import type { EvidenceBundle } from "../types/oracleTypes";
import type { ProphecyId, ProphecySigilPayloadV1, ProphecySigilZkBundle } from "../types/prophecySigilTypes";
import { asProphecyId } from "../types/prophecySigilTypes";
import type { KaiPulse, MicroDecimalString, PhiMicro } from "../types/marketTypes";
import type { KaiMoment as KaiMomentExact } from "../../utils/kai_pulse";
import { asMicroDecimalString } from "../types/marketTypes";
import type { KaiSignature, UserPhiKey } from "../types/vaultTypes";
import { sha256Hex } from "./ids";

/* ───────────────────────── JSON canonicalization ───────────────────────── */

type JSONPrimitive = string | number | boolean | null;
interface JSONObject {
  readonly [k: string]: JSONValue;
}
type JSONValue = JSONPrimitive | ReadonlyArray<JSONValue> | JSONObject;

type UnknownRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is UnknownRecord => typeof v === "object" && v !== null;

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

/* ───────────────────────── text encoding ───────────────────────── */

export type ProphecyTextEncoding = "uri";

export const encodeProphecyText = (text: string): Readonly<{ enc: ProphecyTextEncoding; encoded: string }> => ({
  enc: "uri",
  encoded: encodeURIComponent(text),
});

export const decodeProphecyText = (text: string, enc: ProphecyTextEncoding | string | undefined): string => {
  if (enc === "uri") {
    try {
      return decodeURIComponent(text);
    } catch {
      return text;
    }
  }
  return text;
};

/* ───────────────────────── canonical hashing ───────────────────────── */

export const deriveProphecyId = async (args: Readonly<{
  userPhiKey: UserPhiKey;
  pulse: KaiPulse;
  text: string;
}>): Promise<ProphecyId> => {
  const base = `SM:PROPHECY:ID:${args.userPhiKey}:${args.pulse}:${args.text}`;
  const h = await sha256Hex(base);
  return asProphecyId(`prophecy_${h.slice(0, 40)}`);
};

export const toMicroDecimal = (v: PhiMicro | undefined): MicroDecimalString | undefined => {
  if (v === undefined) return undefined;
  const s = (v as unknown as bigint).toString(10);
  return asMicroDecimalString(s);
};

export const canonicalPayloadForProphecy = (payload: Omit<ProphecySigilPayloadV1, "canonicalHash" | "zk">): JSONValue =>
  toJsonValue({
    v: payload.v,
    kind: payload.kind,
    prophecyId: payload.prophecyId,
    text: payload.text,
    textEnc: payload.textEnc,
    category: payload.category ?? null,
    expirationPulse: payload.expirationPulse ?? null,
    escrowPhiMicro: payload.escrowPhiMicro ?? null,
    evidence: payload.evidence ?? null,
    userPhiKey: payload.userPhiKey,
    kaiSignature: payload.kaiSignature,
    pulse: payload.pulse,
    beat: payload.beat,
    stepIndex: payload.stepIndex,
    stepPct: payload.stepPct,
    chakraDay: payload.chakraDay,
    createdAtPulse: payload.createdAtPulse,
  });

export const computeProphecyCanonicalHash = async (
  payload: Omit<ProphecySigilPayloadV1, "canonicalHash" | "zk">
): Promise<string> => {
  const canon = canonicalPayloadForProphecy(payload);
  const canonStr = stableStringify(canon);
  return (await sha256Hex(`SM:PROPHECY:CANON:${canonStr}`)).toLowerCase();
};

/* ───────────────────────── SVG parsing ───────────────────────── */

const getAttr = (svg: Element, key: string): string | undefined => {
  const v = svg.getAttribute(key);
  return v && v.trim().length > 0 ? v.trim() : undefined;
};

const getFirstMetadataJson = (doc: Document): Record<string, unknown> | null => {
  const meta = doc.querySelector("metadata#sm-prophecy") ?? doc.querySelector("metadata");
  const raw = meta?.textContent ?? "";
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export type ParsedProphecySigil = Readonly<{
  payload: Partial<ProphecySigilPayloadV1>;
  textDecoded?: string;
  zk?: ProphecySigilZkBundle;
}>;

export const parseProphecySigilSvg = (svgText: string): ParsedProphecySigil => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;

  const payload: Partial<ProphecySigilPayloadV1> = {};
  const meta = getFirstMetadataJson(doc);
  if (meta && isRecord(meta)) {
    Object.assign(payload, meta as Partial<ProphecySigilPayloadV1>);
  }

  payload.kind ??= getAttr(svg, "data-kind") as "prophecy" | undefined;
  payload.v ??= getAttr(svg, "data-v") as "SM-PROPHECY-1" | undefined;
  payload.prophecyId ??= getAttr(svg, "data-prophecy-id") as ProphecyId | undefined;
  payload.userPhiKey ??= getAttr(svg, "data-phikey") as UserPhiKey | undefined;
  payload.kaiSignature ??= getAttr(svg, "data-kai-signature") as KaiSignature | undefined;

  const textEnc = (payload.textEnc ?? getAttr(svg, "data-text-enc")) as string | undefined;
  const textEncoded = getAttr(svg, "data-text") ?? (payload as { textEncoded?: string }).textEncoded;
  if (textEncoded && typeof payload.text !== "string") {
    payload.text = decodeProphecyText(textEncoded, textEnc);
  }
  if (textEnc && typeof payload.textEnc !== "string") {
    payload.textEnc = textEnc as ProphecyTextEncoding;
  }

  const categoryAttr = getAttr(svg, "data-category");
  if (categoryAttr && typeof payload.category !== "string") payload.category = categoryAttr;

  const expirationAttr = getAttr(svg, "data-expiration");
  if (expirationAttr && typeof payload.expirationPulse !== "number") {
    const n = Number(expirationAttr);
    if (Number.isFinite(n)) payload.expirationPulse = n as KaiPulse;
  }

  const escrowAttr = getAttr(svg, "data-phi-escrow-micro");
  if (escrowAttr && typeof payload.escrowPhiMicro !== "string") {
    payload.escrowPhiMicro = escrowAttr as MicroDecimalString;
  }

  const pulseRaw = getAttr(svg, "data-pulse");
  const beatRaw = getAttr(svg, "data-beat");
  const stepRaw = getAttr(svg, "data-step-index");
  const stepPctRaw = getAttr(svg, "data-step-pct");

  if (pulseRaw && !payload.pulse) payload.pulse = Number(pulseRaw) as KaiPulse;
  if (beatRaw && payload.beat == null) payload.beat = Number(beatRaw);
  if (stepRaw && payload.stepIndex == null) payload.stepIndex = Number(stepRaw);
  if (stepPctRaw && payload.stepPct == null) payload.stepPct = Number(stepPctRaw);

  const chakraDay = getAttr(svg, "data-chakra-day");
  if (chakraDay && !payload.chakraDay) payload.chakraDay = chakraDay;

  const canonicalHash = getAttr(svg, "data-payload-hash") ?? getAttr(svg, "data-canonical-hash");
  if (canonicalHash && !payload.canonicalHash) payload.canonicalHash = canonicalHash;

  const scheme = getAttr(svg, "data-zk-scheme") ?? (payload.zk ? payload.zk.scheme : undefined);
  const poseidonHash = getAttr(svg, "data-zk-poseidon-hash") ?? (payload.zk ? payload.zk.poseidonHash : undefined);
  const zkPublic = getAttr(svg, "data-zk-public") ?? getAttr(svg, "data-zk-public-inputs");

  let publicInputs: string[] | undefined;
  if (zkPublic) {
    try {
      const decoded = JSON.parse(zkPublic) as unknown;
      if (Array.isArray(decoded)) publicInputs = decoded.map((entry) => String(entry));
      else publicInputs = [String(decoded)];
    } catch {
      publicInputs = [zkPublic];
    }
  }

  const zkMeta = isRecord(meta?.zk) ? (meta?.zk as Record<string, unknown>) : undefined;
  let proof = zkMeta && isRecord(zkMeta) && "proof" in zkMeta ? zkMeta.proof : undefined;
  const proofAttr = getAttr(svg, "data-zk-proof");
  if (!proof && proofAttr) {
    try {
      proof = JSON.parse(proofAttr) as unknown;
    } catch {
      proof = proofAttr;
    }
  }

  const zk: ProphecySigilZkBundle | undefined =
    scheme || poseidonHash || publicInputs || proof
      ? {
          scheme: typeof scheme === "string" ? scheme : "groth16-poseidon",
          poseidonHash: typeof poseidonHash === "string" ? poseidonHash : undefined,
          publicInputs: publicInputs,
          proof: proof,
          verifiedHint: typeof zkMeta?.verifiedHint === "boolean" ? (zkMeta?.verifiedHint as boolean) : undefined,
        }
      : undefined;

  return {
    payload,
    textDecoded: payload.text,
    zk,
  };
};

export const buildProphecyPayloadBase = (args: Readonly<{
  prophecyId: ProphecyId;
  text: string;
  textEnc: ProphecyTextEncoding;
  category?: string;
  expirationPulse?: KaiPulse;
  escrowPhiMicro?: MicroDecimalString;
  evidence?: EvidenceBundle;
  userPhiKey: UserPhiKey;
  kaiSignature: KaiSignature;
  moment: KaiMomentExact;
}>): Omit<ProphecySigilPayloadV1, "canonicalHash" | "zk"> => ({
  v: "SM-PROPHECY-1",
  kind: "prophecy",
  prophecyId: args.prophecyId,
  text: args.text,
  textEnc: args.textEnc,
  category: args.category,
  expirationPulse: args.expirationPulse,
  escrowPhiMicro: args.escrowPhiMicro,
  evidence: args.evidence,
  userPhiKey: args.userPhiKey,
  kaiSignature: args.kaiSignature,
  pulse: args.moment.pulse,
  beat: args.moment.beat,
  stepIndex: args.moment.stepIndex,
  stepPct: args.moment.stepPctAcrossBeat,
  chakraDay: args.moment.chakraDay,
  createdAtPulse: args.moment.pulse,
});
