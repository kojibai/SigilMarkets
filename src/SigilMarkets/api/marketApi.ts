// SigilMarkets/api/marketApi.ts
"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * SigilMarkets — marketApi
 *
 * Goals:
 * - Provide a single, clean interface for loading Markets.
 * - Offline-first: can run fully local with seeded demo markets.
 * - Remote-ready: if a baseUrl is configured, fetch + decode markets.
 *
 * Remote JSON contract (supported):
 * 1) Array of markets: SerializedBinaryMarket[]
 * 2) Object wrapper: { markets: SerializedBinaryMarket[], lastSyncedPulse?: number }
 *
 * Where SerializedBinaryMarket has:
 *   { def: {...}, state: {...} }
 * and micro values are decimal strings.
 */

import type {
  AmmCurve,
  AmmState,
  BinaryMarket,
  BinaryMarketDefinition,
  BinaryMarketState,
  BinaryPricesMicro,
  ClobPriceLevel,
  ClobState,
  KaiPulse,
  Market,
  MarketCategory,
  MarketOraclePolicy,
  MarketRules,
  MarketSettlementPolicy,
  MarketStatus,
  MarketTiming,
  MarketVenueState,
  OracleProvider,
  ParimutuelState,
  PhiMicro,
  PriceMicro,
  ShareMicro,
  MarketOutcome,
} from "../types/marketTypes";

import {
  asEvidenceHash,
  asMarketId,
  asMarketSlug,
  asOracleId,
  isMarketOutcome,
  isMarketStatus,
  ONE_PHI_MICRO,
} from "../types/marketTypes";

import { cachedJsonFetch, type DecodeResult } from "./cacheApi";
import { makeEmptyBinaryMarket } from "../state/marketStore";

type UnknownRecord = Record<string, unknown>;

const isRecord = (v: unknown): v is UnknownRecord => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isArray = (v: unknown): v is readonly unknown[] => Array.isArray(v);

const clampInt = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.floor(n)));

const parsePulse = (v: unknown): KaiPulse | null => {
  if (!isNumber(v)) return null;
  if (v < 0) return 0;
  return Math.floor(v);
};

const parseBps = (v: unknown): number | null => {
  if (!isNumber(v)) return null;
  return clampInt(v, 0, 10_000);
};

const parseBigIntDec = (v: unknown): bigint | null => {
  if (typeof v === "bigint") return v;
  if (!isString(v)) return null;
  const s = v.trim();
  if (s.length === 0) return null;
  if (!/^\d+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
};

const parseCategory = (v: unknown): MarketCategory | null => {
  if (!isString(v) || v.length === 0) return null;
  return v as MarketCategory;
};

const parseOracleProvider = (v: unknown): OracleProvider | null => {
  if (!isString(v) || v.length === 0) return null;
  return v as OracleProvider;
};

/** Price micros are probabilities for a binary market, expressed in Φ-micro (0 .. 1Φ). */
const isPriceMicro = (bi: bigint): bi is PriceMicro => bi >= 0n && bi <= ONE_PHI_MICRO;

/** ---------------------------------------
 * Remote JSON shapes (micro values = strings)
 * -------------------------------------- */

type MicroStr = string;

type SerializedBinaryPricesMicro = Readonly<{ yes: MicroStr; no: MicroStr }>;

type SerializedAmmState = Readonly<{
  curve: AmmCurve;
  yesInventoryMicro: MicroStr;
  noInventoryMicro: MicroStr;
  feeBps: number;
  paramMicro?: MicroStr;
}>;

type SerializedParimutuelState = Readonly<{
  yesPoolMicro: MicroStr;
  noPoolMicro: MicroStr;
  feeBps: number;
}>;

type SerializedClobPriceLevel = Readonly<{ priceMicro: MicroStr; sizeMicro: MicroStr }>;

type SerializedClobState = Readonly<{
  yesBidMicro?: MicroStr;
  yesAskMicro?: MicroStr;
  noBidMicro?: MicroStr;
  noAskMicro?: MicroStr;
  depthYes?: readonly SerializedClobPriceLevel[];
  depthNo?: readonly SerializedClobPriceLevel[];
  feeBps: number;
}>;

type SerializedVenueState =
  | Readonly<{ venue: "amm"; amm: SerializedAmmState }>
  | Readonly<{ venue: "parimutuel"; pool: SerializedParimutuelState }>
  | Readonly<{ venue: "clob"; clob: SerializedClobState }>;

type SerializedMarketResolution = Readonly<{
  marketId: string;
  outcome: MarketOutcome;
  resolvedPulse: KaiPulse;
  oracle: Readonly<{
    provider: string;
    oracleId?: string;
    disputeWindowPulses?: number;
    evidenceRequired?: boolean;
  }>;
  evidence?: Readonly<{
    urls?: readonly string[];
    hashes?: readonly string[];
    summary?: string;
  }>;
  dispute?: Readonly<{
    proposedPulse: KaiPulse;
    finalPulse: KaiPulse;
    meta?: Readonly<Record<string, string>>;
  }>;
}>;

type SerializedBinaryMarketState = Readonly<{
  status: MarketStatus;
  venueState: SerializedVenueState;
  pricesMicro: SerializedBinaryPricesMicro;
  liquidityMicro?: MicroStr;
  volume24hMicro?: MicroStr;
  updatedPulse: KaiPulse;
  resolution?: SerializedMarketResolution;
}>;

type SerializedMarketTiming = Readonly<{
  createdPulse: KaiPulse;
  openPulse: KaiPulse;
  closePulse: KaiPulse;
  resolveEarliestPulse?: KaiPulse;
  resolveByPulse?: KaiPulse;
}>;

type SerializedSettlementPolicy = Readonly<{
  unit: "phi";
  redeemPerShareMicro: MicroStr;
  feeBps: number;
  feeTiming: "entry" | "exit";
}>;

type SerializedOraclePolicy = Readonly<{
  provider: string;
  oracleId?: string;
  disputeWindowPulses?: number;
  evidenceRequired?: boolean;
}>;

type SerializedRules = Readonly<{
  yesCondition: string;
  clarifications?: readonly string[];
  oracle: SerializedOraclePolicy;
  settlement: SerializedSettlementPolicy;
  voidPolicy: Readonly<{
    canVoid: boolean;
    refundMode: "refund-stake" | "refund-less-fee" | "no-refund";
  }>;
}>;

type SerializedBinaryMarketDefinition = Readonly<{
  id: string;
  kind: "binary";
  slug: string;
  question: string;
  description?: string;
  category: string;
  tags: readonly string[];
  timing: SerializedMarketTiming;
  rules: SerializedRules;
  iconEmoji?: string;
  heroImageUrl?: string;
  definitionHash?: string;
}>;

type SerializedBinaryMarket = Readonly<{ def: SerializedBinaryMarketDefinition; state: SerializedBinaryMarketState }>;

type SerializedMarketListResponse =
  | readonly SerializedBinaryMarket[]
  | Readonly<{ markets: readonly SerializedBinaryMarket[]; lastSyncedPulse?: KaiPulse }>;

/** ---------------------------------------
 * Decoders
 * -------------------------------------- */

const decodePrices = (v: unknown): DecodeResult<BinaryPricesMicro> => {
  if (!isRecord(v)) return { ok: false, error: "pricesMicro: not object" };
  const yes = parseBigIntDec(v["yes"]);
  const no = parseBigIntDec(v["no"]);
  if (yes === null || no === null) return { ok: false, error: "pricesMicro: bad micros" };
  if (!isPriceMicro(yes) || !isPriceMicro(no)) return { ok: false, error: "pricesMicro: out of range (0..1Φ)" };
  return { ok: true, value: { yes, no } };
};

const decodeVenueState = (v: unknown): DecodeResult<MarketVenueState> => {
  if (!isRecord(v)) return { ok: false, error: "venueState: not object" };
  const venue = v["venue"];

  if (venue === "amm") {
    const amm = v["amm"];
    if (!isRecord(amm)) return { ok: false, error: "amm: not object" };
    const curve = amm["curve"];
    if (curve !== "cpmm" && curve !== "lmsr") return { ok: false, error: "amm.curve: bad" };

    const yesInv = parseBigIntDec(amm["yesInventoryMicro"]);
    const noInv = parseBigIntDec(amm["noInventoryMicro"]);
    const feeBps = parseBps(amm["feeBps"]);
    if (yesInv === null || noInv === null || feeBps === null) return { ok: false, error: "amm: bad micros/fee" };

    const param = amm["paramMicro"] !== undefined ? parseBigIntDec(amm["paramMicro"]) : null;

    const out: AmmState = {
      curve,
      yesInventoryMicro: yesInv as ShareMicro,
      noInventoryMicro: noInv as ShareMicro,
      feeBps,
      paramMicro: param !== null ? (param as PhiMicro) : undefined,
    };
    return { ok: true, value: { venue: "amm", amm: out } };
  }

  if (venue === "parimutuel") {
    const pool = v["pool"];
    if (!isRecord(pool)) return { ok: false, error: "pool: not object" };

    const yesPool = parseBigIntDec(pool["yesPoolMicro"]);
    const noPool = parseBigIntDec(pool["noPoolMicro"]);
    const feeBps = parseBps(pool["feeBps"]);
    if (yesPool === null || noPool === null || feeBps === null) return { ok: false, error: "pool: bad micros/fee" };

    const out: ParimutuelState = {
      yesPoolMicro: yesPool as PhiMicro,
      noPoolMicro: noPool as PhiMicro,
      feeBps,
    };
    return { ok: true, value: { venue: "parimutuel", pool: out } };
  }

  if (venue === "clob") {
    const clob = v["clob"];
    if (!isRecord(clob)) return { ok: false, error: "clob: not object" };
    const feeBps = parseBps(clob["feeBps"]);
    if (feeBps === null) return { ok: false, error: "clob.feeBps: bad" };

    const parseOptPrice = (x: unknown): PriceMicro | undefined => {
      const bi = parseBigIntDec(x);
      return bi !== null && isPriceMicro(bi) ? bi : undefined;
    };

    const parseDepth = (x: unknown): readonly ClobPriceLevel[] | undefined => {
      if (!isArray(x)) return undefined;
      const out: ClobPriceLevel[] = [];
      for (const item of x) {
        if (!isRecord(item)) continue;
        const price = parseBigIntDec(item["priceMicro"]);
        const size = parseBigIntDec(item["sizeMicro"]);
        if (price === null || size === null) continue;
        if (!isPriceMicro(price)) continue;
        out.push({ priceMicro: price, sizeMicro: size as ShareMicro });
      }
      return out;
    };

    const out: ClobState = {
      yesBidMicro: parseOptPrice(clob["yesBidMicro"]),
      yesAskMicro: parseOptPrice(clob["yesAskMicro"]),
      noBidMicro: parseOptPrice(clob["noBidMicro"]),
      noAskMicro: parseOptPrice(clob["noAskMicro"]),
      depthYes: parseDepth(clob["depthYes"]),
      depthNo: parseDepth(clob["depthNo"]),
      feeBps,
    };

    return { ok: true, value: { venue: "clob", clob: out } };
  }

  return { ok: false, error: "venueState: unknown venue" };
};

const decodeTiming = (v: unknown): DecodeResult<MarketTiming> => {
  if (!isRecord(v)) return { ok: false, error: "timing: not object" };
  const createdPulse = parsePulse(v["createdPulse"]);
  const openPulse = parsePulse(v["openPulse"]);
  const closePulse = parsePulse(v["closePulse"]);
  if (createdPulse === null || openPulse === null || closePulse === null) return { ok: false, error: "timing: bad pulses" };

  const resolveEarliestPulse = v["resolveEarliestPulse"] !== undefined ? parsePulse(v["resolveEarliestPulse"]) : null;
  const resolveByPulse = v["resolveByPulse"] !== undefined ? parsePulse(v["resolveByPulse"]) : null;

  return {
    ok: true,
    value: {
      createdPulse,
      openPulse,
      closePulse,
      resolveEarliestPulse: resolveEarliestPulse ?? undefined,
      resolveByPulse: resolveByPulse ?? undefined,
    },
  };
};

const decodeOraclePolicy = (v: unknown): DecodeResult<MarketOraclePolicy> => {
  if (!isRecord(v)) return { ok: false, error: "oracle: not object" };
  const provider = parseOracleProvider(v["provider"]);
  if (provider === null) return { ok: false, error: "oracle.provider: bad" };

  const oracleId = v["oracleId"];
  const disputeWindowPulses = v["disputeWindowPulses"];
  const evidenceRequired = v["evidenceRequired"];

  const dw =
    typeof disputeWindowPulses === "number" && Number.isFinite(disputeWindowPulses) && disputeWindowPulses >= 0
      ? clampInt(disputeWindowPulses, 0, 1_000_000_000)
      : undefined;

  return {
    ok: true,
    value: {
      provider,
      oracleId: isString(oracleId) && oracleId.length > 0 ? asOracleId(oracleId) : undefined,
      disputeWindowPulses: dw,
      evidenceRequired: typeof evidenceRequired === "boolean" ? evidenceRequired : undefined,
    },
  };
};

const decodeSettlementPolicy = (v: unknown): DecodeResult<MarketSettlementPolicy> => {
  if (!isRecord(v)) return { ok: false, error: "settlement: not object" };
  const unit = v["unit"];
  if (unit !== "phi") return { ok: false, error: "settlement.unit: bad" };

  const redeem = parseBigIntDec(v["redeemPerShareMicro"]);
  const feeBps = parseBps(v["feeBps"]);
  const feeTiming = v["feeTiming"];

  if (redeem === null) return { ok: false, error: "settlement.redeemPerShareMicro: bad" };
  if (feeBps === null) return { ok: false, error: "settlement.feeBps: bad" };
  if (feeTiming !== "entry" && feeTiming !== "exit") return { ok: false, error: "settlement.feeTiming: bad" };

  return {
    ok: true,
    value: {
      unit: "phi",
      redeemPerShareMicro: redeem as PhiMicro,
      feeBps,
      feeTiming,
    },
  };
};

const decodeRules = (v: unknown): DecodeResult<MarketRules> => {
  if (!isRecord(v)) return { ok: false, error: "rules: not object" };
  const yesCondition = v["yesCondition"];
  if (!isString(yesCondition) || yesCondition.length === 0) return { ok: false, error: "rules.yesCondition: bad" };

  const clarificationsRaw = v["clarifications"];
  const clarifications = isArray(clarificationsRaw)
    ? clarificationsRaw.filter((x): x is string => isString(x) && x.length > 0)
    : undefined;

  const oracleRes = decodeOraclePolicy(v["oracle"]);
  if (!oracleRes.ok) return { ok: false, error: oracleRes.error };

  const settlementRes = decodeSettlementPolicy(v["settlement"]);
  if (!settlementRes.ok) return { ok: false, error: settlementRes.error };

  const voidPolicy = v["voidPolicy"];
  if (!isRecord(voidPolicy)) return { ok: false, error: "rules.voidPolicy: bad" };
  const canVoid = voidPolicy["canVoid"];
  const refundMode = voidPolicy["refundMode"];
  if (typeof canVoid !== "boolean") return { ok: false, error: "voidPolicy.canVoid: bad" };
  if (refundMode !== "refund-stake" && refundMode !== "refund-less-fee" && refundMode !== "no-refund") {
    return { ok: false, error: "voidPolicy.refundMode: bad" };
  }

  return {
    ok: true,
    value: {
      yesCondition,
      clarifications,
      oracle: oracleRes.value,
      settlement: settlementRes.value,
      voidPolicy: { canVoid, refundMode },
    },
  };
};

const decodeResolution = (v: unknown): DecodeResult<BinaryMarketState["resolution"] | undefined> => {
  if (v === undefined || v === null) return { ok: true, value: undefined };
  if (!isRecord(v)) return { ok: false, error: "resolution: not object" };

  const marketId = v["marketId"];
  if (!isString(marketId) || marketId.length === 0) return { ok: false, error: "resolution.marketId: bad" };

  const outcome = v["outcome"];
  if (!isMarketOutcome(outcome)) return { ok: false, error: "resolution.outcome: bad" };

  const resolvedPulse = parsePulse(v["resolvedPulse"]);
  if (resolvedPulse === null) return { ok: false, error: "resolution.resolvedPulse: bad" };

  const oracleRes = decodeOraclePolicy(v["oracle"]);
  if (!oracleRes.ok) return { ok: false, error: `resolution.oracle: ${oracleRes.error}` };

  const evidenceRaw = v["evidence"];
  const evidence =
    isRecord(evidenceRaw)
      ? {
          urls: isArray(evidenceRaw["urls"])
            ? evidenceRaw["urls"].filter((x): x is string => isString(x) && x.length > 0)
            : undefined,
          hashes: isArray(evidenceRaw["hashes"])
            ? evidenceRaw["hashes"]
                .filter((x): x is string => isString(x) && x.length > 0)
                .map((h) => asEvidenceHash(h))
            : undefined,
          summary: isString(evidenceRaw["summary"]) ? evidenceRaw["summary"] : undefined,
        }
      : undefined;

  const disputeRaw = v["dispute"];
  const dispute =
    isRecord(disputeRaw) && disputeRaw["proposedPulse"] !== undefined && disputeRaw["finalPulse"] !== undefined
      ? (() => {
          const proposedPulse = parsePulse(disputeRaw["proposedPulse"]) ?? resolvedPulse;
          const finalPulse = parsePulse(disputeRaw["finalPulse"]) ?? resolvedPulse;

          const metaRaw = disputeRaw["meta"];
          let meta: Readonly<Record<string, string>> | undefined;

          if (isRecord(metaRaw)) {
            const out: Record<string, string> = {};
            for (const [k, val] of Object.entries(metaRaw)) {
              if (isString(val)) out[k] = val;
            }
            meta = Object.keys(out).length > 0 ? out : undefined;
          }

          return { proposedPulse, finalPulse, meta };
        })()
      : undefined;

  return {
    ok: true,
    value: {
      marketId: asMarketId(marketId),
      outcome,
      resolvedPulse,
      oracle: oracleRes.value,
      evidence: evidence ? { urls: evidence.urls, hashes: evidence.hashes, summary: evidence.summary } : undefined,
      dispute,
    },
  };
};

const decodeBinaryMarket = (v: unknown): DecodeResult<BinaryMarket> => {
  if (!isRecord(v)) return { ok: false, error: "market: not object" };

  const defRaw = v["def"];
  const stateRaw = v["state"];
  if (!isRecord(defRaw) || !isRecord(stateRaw)) return { ok: false, error: "market: missing def/state" };

  // def
  const id = defRaw["id"];
  const kind = defRaw["kind"];
  const slug = defRaw["slug"];
  const question = defRaw["question"];
  const category = defRaw["category"];
  const tagsRaw = defRaw["tags"];

  if (!isString(id) || id.length === 0) return { ok: false, error: "def.id: bad" };
  if (kind !== "binary") return { ok: false, error: "def.kind: bad" };
  if (!isString(slug) || slug.length === 0) return { ok: false, error: "def.slug: bad" };
  if (!isString(question) || question.length === 0) return { ok: false, error: "def.question: bad" };

  const cat = parseCategory(category);
  if (cat === null) return { ok: false, error: "def.category: bad" };

  const tags = isArray(tagsRaw) ? tagsRaw.filter((x): x is string => isString(x) && x.length > 0) : [];

  const timingRes = decodeTiming(defRaw["timing"]);
  if (!timingRes.ok) return { ok: false, error: `def.timing: ${timingRes.error}` };

  const rulesRes = decodeRules(defRaw["rules"]);
  if (!rulesRes.ok) return { ok: false, error: `def.rules: ${rulesRes.error}` };

  const definitionHash = isString(defRaw["definitionHash"]) ? asEvidenceHash(defRaw["definitionHash"]) : undefined;

  const def: BinaryMarketDefinition = {
    id: asMarketId(id),
    kind: "binary",
    slug: asMarketSlug(slug),
    question,
    description: isString(defRaw["description"]) ? defRaw["description"] : undefined,
    category: cat,
    tags,
    timing: timingRes.value,
    rules: rulesRes.value,
    iconEmoji: isString(defRaw["iconEmoji"]) ? defRaw["iconEmoji"] : undefined,
    heroImageUrl: isString(defRaw["heroImageUrl"]) ? defRaw["heroImageUrl"] : undefined,
    definitionHash,
  };

  // state
  const status = stateRaw["status"];
  if (!isMarketStatus(status)) return { ok: false, error: "state.status: bad" };

  const venueRes = decodeVenueState(stateRaw["venueState"]);
  if (!venueRes.ok) return { ok: false, error: `state.venueState: ${venueRes.error}` };

  const pricesRes = decodePrices(stateRaw["pricesMicro"]);
  if (!pricesRes.ok) return { ok: false, error: `state.pricesMicro: ${pricesRes.error}` };

  const updatedPulse = parsePulse(stateRaw["updatedPulse"]);
  if (updatedPulse === null) return { ok: false, error: "state.updatedPulse: bad" };

  const liquidityMicro = stateRaw["liquidityMicro"] !== undefined ? parseBigIntDec(stateRaw["liquidityMicro"]) : null;
  const volume24hMicro = stateRaw["volume24hMicro"] !== undefined ? parseBigIntDec(stateRaw["volume24hMicro"]) : null;

  const resolutionRes = decodeResolution(stateRaw["resolution"]);
  if (!resolutionRes.ok) return { ok: false, error: `state.resolution: ${resolutionRes.error}` };

  const state: BinaryMarketState = {
    status,
    venueState: venueRes.value,
    pricesMicro: pricesRes.value,
    liquidityMicro: liquidityMicro !== null ? (liquidityMicro as PhiMicro) : undefined,
    volume24hMicro: volume24hMicro !== null ? (volume24hMicro as PhiMicro) : undefined,
    updatedPulse,
    resolution: resolutionRes.value,
  };

  return { ok: true, value: { def, state } };
};

const decodeMarketListResponse = (
  v: unknown,
): DecodeResult<Readonly<{ markets: readonly Market[]; lastSyncedPulse?: KaiPulse }>> => {
  // Use the declared response union so it’s not dead code (and helps readability).
  const raw = v as SerializedMarketListResponse;

  if (isArray(raw)) {
    const markets: Market[] = [];
    for (const item of raw) {
      const dm = decodeBinaryMarket(item);
      if (dm.ok) markets.push(dm.value);
    }
    return { ok: true, value: { markets } };
  }

  if (isRecord(raw) && isArray(raw["markets"])) {
    const rawMarkets = raw["markets"];
    const markets: Market[] = [];
    for (const item of rawMarkets) {
      const dm = decodeBinaryMarket(item);
      if (dm.ok) markets.push(dm.value);
    }
    const lastSyncedPulse =
      raw["lastSyncedPulse"] !== undefined ? parsePulse(raw["lastSyncedPulse"]) ?? undefined : undefined;
    return { ok: true, value: { markets, lastSyncedPulse } };
  }

  return { ok: false, error: "unsupported response shape" };
};

/** ---------------------------------------
 * API surface
 * -------------------------------------- */

export type SigilMarketsMarketApiConfig = Readonly<{
  /** If absent, API runs in local/demo mode (seeded). */
  baseUrl?: string;
  /** Path for market list (default: "/markets"). */
  marketsPath?: string;
  /** Optional query params appended to list request. */
  marketsQuery?: Readonly<Record<string, string>>;
  /** Cache policy for market list. */
  cache: Readonly<{ maxAgeMs: number; staleWhileRevalidateMs: number }>;
}>;

export type FetchMarketsResult =
  | Readonly<{ ok: true; markets: readonly Market[]; lastSyncedPulse?: KaiPulse; fromCache: boolean; isStale: boolean }>
  | Readonly<{ ok: false; error: string; fromCache: boolean }>;

const joinUrl = (base: string, path: string): string => {
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
};

const withQuery = (url: string, query?: Readonly<Record<string, string>>): string => {
  if (!query) return url;
  const entries = Object.entries(query).filter(([k, val]) => k.length > 0 && val.length > 0);
  if (entries.length === 0) return url;

  const u = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://localhost");
  for (const [k, val] of entries) u.searchParams.set(k, val);
  return u.toString();
};

/**
 * Local seeded markets for standalone app / offline mode.
 *
 * KKS v1 “Sovereignty Test” (deterministic curriculum):
 * - Every market resolves from Kai-Klok math only.
 * - Every question teaches canon: lattice (11/44/36/6), primes, Fibonacci/Lucas/φ motifs, and cycle structure.
 * - No external reality. No feeds. No weather. No sports teams. No Chronos calendar.
 *
 * Design:
 * - Questions are simple to read.
 * - But hard to answer unless you understand the canon (or learn it by playing).
 */
export const seedDemoMarkets = (nowPulse: KaiPulse): readonly Market[] => {
  // Keep category strings stable — your UI filter can key off these exactly.
  const CAT = {
    PULSE: "pulse",
    KAI: "kai",
    CULTURE: "culture",
    MARKETS: "markets",
    FINANCE: "finance",
    CRYPTO: "crypto",
    TECH: "tech",
    WORLD: "world",
    OTHER: "other",
    SPORTS: "sports",
    WEATHER: "weather",
    CALENDAR: "calendar",
  } as const;

  type SeedCategory = typeof CAT[keyof typeof CAT];

  const mk = (
    id: string,
    slug: string,
    question: string,
    opts: Readonly<{
      category: SeedCategory;
      tags?: readonly string[];
      description?: string;
      iconEmoji?: string;
      closeInPulses?: number;
    }>,
  ): Market => {
    const base = makeEmptyBinaryMarket({ id, slug, question, nowPulse });

    const closeIn =
      typeof opts.closeInPulses === "number" && Number.isFinite(opts.closeInPulses) ? opts.closeInPulses : undefined;
    const timing = closeIn
      ? (() => {
          const period = Math.max(1, Math.floor(closeIn));
          const anchoredNow = Math.max(0, Math.floor(nowPulse));
          const cycleIndex = Math.floor(anchoredNow / period);
          const openPulse = (cycleIndex * period) as KaiPulse;
          const closePulse = (openPulse + period) as KaiPulse;

          return {
            ...base.def.timing,
            // Anchor to genesis pulse so cycles are stable across reloads.
            createdPulse: openPulse,
            openPulse,
            closePulse,
          } as MarketTiming;
        })()
      : base.def.timing;

    return {
      ...base,
      def: {
        ...base.def,
        category: opts.category as unknown as MarketCategory,
        tags: (opts.tags ?? []) as readonly string[],
        description: opts.description ?? base.def.description,
        iconEmoji: opts.iconEmoji ?? base.def.iconEmoji,
        timing,
      },
    };
  };

  // ─────────────────────────────────────────────────────────────
  // KKS v1 Canon constants (discrete lattice)
  // ─────────────────────────────────────────────────────────────
  const PULSES_PER_STEP = 11;
  const STEPS_PER_BEAT = 44;
  const BEATS_PER_DAY = 36;
  const BEATS_PER_ARC = 6;
  const DAYS_PER_WEEK = 6;
  const WEEKS_PER_MONTH = 7;
  const MONTHS_PER_YEAR = 8;
const P_BEAT = PULSES_PER_STEP * STEPS_PER_BEAT; // 484
const P_ARC = P_BEAT * BEATS_PER_ARC; // 2,904

// Discrete lattice day (indexing truth): 36×44×11 = 17,424
const P_GRID_DAY = P_BEAT * BEATS_PER_DAY; // 17,424

// Demo day bucket used for seeded markets: lattice day + drift
// (teaches the canon difference: 17,491 − 17,424 = 67)
const P_DAY = P_GRID_DAY + 67; // 17,491

  const P_WEEK = P_DAY * DAYS_PER_WEEK; // 6-day Kai week
  const P_MONTH = P_WEEK * WEEKS_PER_MONTH; // 42-day Kai month
  const P_YEAR = P_MONTH * MONTHS_PER_YEAR; // 336-day Kai year

  // NOTE:
  // P_GRID_DAY teaches the discrete lattice truth (36×44×11 = 17,424).
  // P_DAY is used for “daily” seeded scheduling windows in the demo list.

  return [
    /* ─────────────────────────────────────────────────────────────
       🔮 PULSE — Lattice Mastery (11 / 44 / 484 / 6-beat arcs)
       Learn to read the moment: breath → step → beat → arc.
    ───────────────────────────────────────────────────────────── */

    mk("m_pulse_next_step_is_boundary", "next-step-boundary", "Will the next moment land exactly on a STEP boundary?", {
      category: CAT.PULSE,
      tags: ["kks", "pulse", "step", "11"],
      iconEmoji: "🧿",
      closeInPulses: PULSES_PER_STEP,
      description: "A STEP is 11 pulses. Boundary means breath residue = 0 (pulse mod 11).",
    }),

    mk(
      "m_pulse_next_step_stepindex_is_0_11_22_33",
      "next-step-multiple-of-11",
      "At the next STEP boundary, will the STEP index be 0, 11, 22, or 33?",
      {
        category: CAT.PULSE,
        tags: ["kks", "step", "11", "44"],
        iconEmoji: "🧮",
        closeInPulses: PULSES_PER_STEP,
        description: "STEP index is 0..43. Multiples of 11 are the four sovereign checkpoints.",
      },
    ),

    mk("m_pulse_next_beat_boundary", "next-beat-boundary", "Will the next moment land exactly on a BEAT boundary?", {
      category: CAT.PULSE,
      tags: ["kks", "beat", "484"],
      iconEmoji: "🥁",
      closeInPulses: P_BEAT,
      description: "A BEAT is 44 steps × 11 pulses = 484 pulses. Boundary means pulse mod 484 = 0.",
    }),

    mk(
      "m_pulse_next_beat_index_prime",
      "next-beat-prime",
      "At the next BEAT boundary, will the BEAT number be PRIME?",
      {
        category: CAT.PULSE,
        tags: ["kks", "prime", "beat", "36"],
        iconEmoji: "🔢",
        closeInPulses: P_BEAT,
        description: "BEAT number is 0..35 inside a Kai day. Prime beats are rare power-moments.",
      },
    ),

    mk(
      "m_pulse_next_beat_is_arc_gate",
      "next-beat-arc-gate",
      "At the next BEAT boundary, will it also be an ARC gate (beat % 6 = 0)?",
      {
        category: CAT.PULSE,
        tags: ["kks", "arc", "gate", "6"],
        iconEmoji: "🚪",
        closeInPulses: P_BEAT,
        description: "Each ARC is 6 beats. ARC gates happen when beatIndex is divisible by 6.",
      },
    ),

    mk("m_pulse_next_arc_boundary", "next-arc-boundary", "Will the next moment land exactly on an ARC boundary?", {
      category: CAT.PULSE,
      tags: ["kks", "arc", "2904"],
      iconEmoji: "⚡",
      closeInPulses: P_ARC,
      description: "An ARC is 6 beats = 2,904 pulses. ARC boundary means pulse mod 2,904 = 0.",
    }),

    mk(
      "m_pulse_next_arc_index_is_0",
      "next-arc-ignition",
      "At the next ARC boundary, will the ARC index be 0 (Ignition)?",
      {
        category: CAT.PULSE,
        tags: ["kks", "arc", "6", "ignition"],
        iconEmoji: "🔥",
        closeInPulses: P_ARC,
        description: "ARC index is 0..5. Arc 0 is Ignition: the sovereign start.",
      },
    ),

    mk(
      "m_pulse_next_pulse_is_fibonacci",
      "next-pulse-fibonacci",
      "Will the next pulse number be a Fibonacci number?",
      {
        category: CAT.PULSE,
        tags: ["phi", "fibonacci", "pulse"],
        iconEmoji: "🌀",
        closeInPulses: PULSES_PER_STEP,
        description: "Fibonacci membership is exact. This trains your eye for φ-structure in time.",
      },
    ),

    mk(
      "m_pulse_next_pulse_is_lucas",
      "next-pulse-lucas",
      "Will the next pulse number be a Lucas number?",
      {
        category: CAT.PULSE,
        tags: ["phi", "lucas", "pulse"],
        iconEmoji: "🧬",
        closeInPulses: PULSES_PER_STEP,
        description: "Lucas numbers are Fibonacci’s royal sibling. Exact membership — no vibes.",
      },
    ),

    mk(
      "m_pulse_next_pulsehash_starts_00",
      "next-pulsehash-00",
      "Will the next pulse-hash start with '00'?",
      {
        category: CAT.PULSE,
        tags: ["proof", "hash", "pulse"],
        iconEmoji: "🔐",
        closeInPulses: PULSES_PER_STEP,
        description: "A proof-game: hash(pulse) is deterministic. The answer is always verifiable offline.",
      },
    ),

    mk(
      "m_pulse_next_pulsehash_last_hex_even",
      "next-pulsehash-even",
      "Will the next pulse-hash end in an EVEN hex digit?",
      {
        category: CAT.PULSE,
        tags: ["proof", "hash", "pulse"],
        iconEmoji: "⚖️",
        closeInPulses: PULSES_PER_STEP,
        description: "Teaches parity + hashing as witness. No authority needed.",
      },
    ),

    /* ─────────────────────────────────────────────────────────────
       🌈 KAI — Canon Names (Weekday + Arc)
       Simple to read, but the point is to learn the 6×6 structure.
    ───────────────────────────────────────────────────────────── */

    mk("m_kai_weekday_solhara_now", "weekday-solhara", "Is the current Kai weekday Solhara?", {
      category: CAT.KAI,
      tags: ["kks", "weekday", "6", "solhara"],
      iconEmoji: "☀️",
      closeInPulses: P_DAY,
      description: "KKS week has 6 weekdays: Solhara, Aquaris, Flamora, Verdari, Sonari, Kaelith.",
    }),
    mk("m_kai_weekday_aquaris_now", "weekday-aquaris", "Is the current Kai weekday Aquaris?", {
      category: CAT.KAI,
      tags: ["kks", "weekday", "6", "aquaris"],
      iconEmoji: "💧",
      closeInPulses: P_DAY,
    }),
    mk("m_kai_weekday_flamora_now", "weekday-flamora", "Is the current Kai weekday Flamora?", {
      category: CAT.KAI,
      tags: ["kks", "weekday", "6", "flamora"],
      iconEmoji: "🔥",
      closeInPulses: P_DAY,
    }),
    mk("m_kai_weekday_verdari_now", "weekday-verdari", "Is the current Kai weekday Verdari?", {
      category: CAT.KAI,
      tags: ["kks", "weekday", "6", "verdari"],
      iconEmoji: "🌿",
      closeInPulses: P_DAY,
    }),
    mk("m_kai_weekday_sonari_now", "weekday-sonari", "Is the current Kai weekday Sonari?", {
      category: CAT.KAI,
      tags: ["kks", "weekday", "6", "sonari"],
      iconEmoji: "🎶",
      closeInPulses: P_DAY,
    }),
    mk("m_kai_weekday_kaelith_now", "weekday-kaelith", "Is the current Kai weekday Kaelith?", {
      category: CAT.KAI,
      tags: ["kks", "weekday", "6", "kaelith"],
      iconEmoji: "🪞",
      closeInPulses: P_DAY,
      description: "Kaelith is the mirror day: measure yourself against coherence.",
    }),

    mk("m_kai_arc_ignition_now", "arc-ignition", "Is the current Kai arc Ignition?", {
      category: CAT.KAI,
      tags: ["kks", "arc", "6", "ignition"],
      iconEmoji: "⚡",
      closeInPulses: P_ARC,
      description: "KKS day has 6 arcs (6 beats each): Ignition, Integration, Harmonization, Reflection, Purification, Dream.",
    }),
    mk("m_kai_arc_integration_now", "arc-integration", "Is the current Kai arc Integration?", {
      category: CAT.KAI,
      tags: ["kks", "arc", "6", "integration"],
      iconEmoji: "🧩",
      closeInPulses: P_ARC,
    }),
    mk("m_kai_arc_harmonization_now", "arc-harmonization", "Is the current Kai arc Harmonization?", {
      category: CAT.KAI,
      tags: ["kks", "arc", "6", "harmonization"],
      iconEmoji: "🌀",
      closeInPulses: P_ARC,
    }),
    mk("m_kai_arc_reflection_now", "arc-reflection", "Is the current Kai arc Reflection?", {
      category: CAT.KAI,
      tags: ["kks", "arc", "6", "reflection"],
      iconEmoji: "🪞",
      closeInPulses: P_ARC,
    }),
    mk("m_kai_arc_purification_now", "arc-purification", "Is the current Kai arc Purification?", {
      category: CAT.KAI,
      tags: ["kks", "arc", "6", "purification"],
      iconEmoji: "💠",
      closeInPulses: P_ARC,
    }),
    mk("m_kai_arc_dream_now", "arc-dream", "Is the current Kai arc Dream?", {
      category: CAT.KAI,
      tags: ["kks", "arc", "6", "dream"],
      iconEmoji: "🌙",
      closeInPulses: P_ARC,
      description: "Dream is the sixth arc: integration beyond effort.",
    }),

    /* ─────────────────────────────────────────────────────────────
       💬 CULTURE — Pattern Literacy (digits as a language)
       These teach you to see order: palindrome, runs, sequences, and sevens.
    ───────────────────────────────────────────────────────────── */

    mk(
      "m_culture_closepulse_palindrome_today",
      "closepulse-palindrome",
      "Will this cycle’s CLOSE pulse be a palindrome (reads the same backward)?",
      {
        category: CAT.CULTURE,
        tags: ["pattern", "palindrome", "pulse"],
        iconEmoji: "🪞",
        closeInPulses: P_DAY,
        description: "You’re learning to read number-meaning: palindromes are symmetry in time.",
      },
    ),

    mk(
      "m_culture_closepulse_uniform_digit_4plus",
      "closepulse-run4",
      "Will this cycle’s CLOSE pulse contain a run of 4+ identical digits?",
      {
        category: CAT.CULTURE,
        tags: ["pattern", "digits", "run"],
        iconEmoji: "🧱",
        closeInPulses: P_DAY,
        description: "Runs teach signal vs noise. Coherence leaves footprints.",
      },
    ),

    mk(
      "m_culture_closepulse_has_ascending_4",
      "closepulse-asc4",
      "Will this cycle’s CLOSE pulse contain an ascending digit chain of length 4 (like 1234)?",
      {
        category: CAT.CULTURE,
        tags: ["pattern", "sequence", "digits"],
        iconEmoji: "📈",
        closeInPulses: P_DAY,
        description: "Consecutive sequences are order motifs. This is literacy training.",
      },
    ),

    mk(
      "m_culture_closepulse_has_descending_4",
      "closepulse-desc4",
      "Will this cycle’s CLOSE pulse contain a descending digit chain of length 4 (like 4321)?",
      {
        category: CAT.CULTURE,
        tags: ["pattern", "sequence", "digits"],
        iconEmoji: "📉",
        closeInPulses: P_DAY,
      },
    ),

    mk(
      "m_culture_closepulse_sevens_3plus",
      "closepulse-sevens3",
      "Will this cycle’s CLOSE pulse contain 3 or more '7' digits?",
      {
        category: CAT.CULTURE,
        tags: ["pattern", "digits", "7"],
        iconEmoji: "7️⃣",
        closeInPulses: P_DAY,
        description: "Not superstition: it’s a measurable motif. You’re learning to witness patterns cleanly.",
      },
    ),

    mk(
      "m_culture_closepulse_even_digit_majority",
      "closepulse-even-majority",
      "Will this cycle’s CLOSE pulse have more EVEN digits than ODD digits?",
      {
        category: CAT.CULTURE,
        tags: ["pattern", "parity", "digits"],
        iconEmoji: "⚖️",
        closeInPulses: P_DAY,
        description: "Parity is a sovereign skill. Count the world without asking permission.",
      },
    ),

    /* ─────────────────────────────────────────────────────────────
       🪙 MARKETS — φ-Value Motifs (Fibonacci / Lucas / φ transition)
       These align with the valuation canon: exact set membership, not opinion.
    ───────────────────────────────────────────────────────────── */

    mk(
      "m_markets_closepulse_fibonacci_today",
      "closepulse-fib",
      "Will this cycle’s CLOSE pulse be an exact Fibonacci number?",
      {
        category: CAT.MARKETS,
        tags: ["phi", "markets", "fibonacci"],
        iconEmoji: "🌀",
        closeInPulses: P_DAY,
        description: "Fibonacci membership is exact. Coherence has a measurable signature.",
      },
    ),

    mk(
      "m_markets_closepulse_lucas_today",
      "closepulse-lucas",
      "Will this cycle’s CLOSE pulse be an exact Lucas number?",
      {
        category: CAT.MARKETS,
        tags: ["phi", "markets", "lucas"],
        iconEmoji: "🧬",
        closeInPulses: P_DAY,
        description: "Lucas is Fibonacci’s royal lineage. Same φ law, different sequence.",
      },
    ),

    mk(
      "m_markets_closepulse_phi_transition_today",
      "closepulse-phi-transition",
      "Will this cycle’s CLOSE pulse be a φ-transition pulse (ceil(φ^n) for some n)?",
      {
        category: CAT.MARKETS,
        tags: ["phi", "markets", "transition"],
        iconEmoji: "✨",
        closeInPulses: P_DAY,
        description: "φ-transition pulses mark exact spiral thresholds. Rare, provable, sovereign.",
      },
    ),

    mk(
      "m_markets_closepulse_prime_today",
      "closepulse-prime",
      "Will this cycle’s CLOSE pulse be PRIME?",
      {
        category: CAT.MARKETS,
        tags: ["prime", "markets", "pulse"],
        iconEmoji: "🔢",
        closeInPulses: P_DAY,
        description: "Prime is indivisible power. This is a clean math witness — no oracle needed.",
      },
    ),

    mk(
      "m_markets_closepulse_divisible_by_484",
      "closepulse-div484",
      "Will this cycle’s CLOSE pulse be divisible by 484 (exactly on a BEAT boundary)?",
      {
        category: CAT.MARKETS,
        tags: ["kks", "markets", "484", "beat"],
        iconEmoji: "🥁",
        closeInPulses: P_DAY,
        description: "484 = 44×11. If divisible, the close lands perfectly on beat structure.",
      },
    ),

    mk(
      "m_markets_closepulse_mod11_is_0",
      "closepulse-mod11",
      "Will this cycle’s CLOSE pulse be divisible by 11 (exact STEP boundary)?",
      {
        category: CAT.MARKETS,
        tags: ["kks", "markets", "11", "step"],
        iconEmoji: "🧿",
        closeInPulses: P_DAY,
        description: "11 pulses per step. Divisible by 11 means breath residue = 0 at close.",
      },
    ),

    /* ─────────────────────────────────────────────────────────────
       💰 FINANCE — Stewardship Arithmetic (not prices, not feeds)
       Sovereignty is: can you compute and verify without permission?
    ───────────────────────────────────────────────────────────── */

    mk(
      "m_finance_closepulse_digit_sum_div9",
      "closepulse-dsum-div9",
      "Will the sum of digits of this cycle’s CLOSE pulse be divisible by 9?",
      {
        category: CAT.FINANCE,
        tags: ["finance", "arithmetic", "digits"],
        iconEmoji: "🧾",
        closeInPulses: P_DAY,
        description: "Digit-sum divisibility is a sovereignty skill: fast verification, no tools required.",
      },
    ),

    mk(
      "m_finance_closepulse_mod_phi_floor",
      "closepulse-mod44",
      "Will this cycle’s CLOSE pulse be divisible by 44?",
      {
        category: CAT.FINANCE,
        tags: ["finance", "kks", "44"],
        iconEmoji: "📏",
        closeInPulses: P_DAY,
        description: "44 steps per beat. Divisible by 44 means the close aligns to the step-grid spine.",
      },
    ),

    mk(
      "m_finance_closepulse_evenness",
      "closepulse-even",
      "Will this cycle’s CLOSE pulse be EVEN?",
      {
        category: CAT.FINANCE,
        tags: ["finance", "parity"],
        iconEmoji: "⚖️",
        closeInPulses: P_DAY,
        description: "Even/odd is the first gate of measurement. A sovereign counts cleanly.",
      },
    ),

    mk(
      "m_finance_closepulse_mod6_is_0",
      "closepulse-mod6",
      "Will this cycle’s CLOSE pulse be divisible by 6?",
      {
        category: CAT.FINANCE,
        tags: ["finance", "cycle", "6"],
        iconEmoji: "♻️",
        closeInPulses: P_DAY,
        description: "6 is the sovereign cycle base (6 days/week, 6 arcs/day).",
      },
    ),

    mk(
      "m_finance_closepulse_has_double_zero",
      "closepulse-has-00",
      "Will this cycle’s CLOSE pulse contain '00' somewhere in its digits?",
      {
        category: CAT.FINANCE,
        tags: ["finance", "pattern", "digits"],
        iconEmoji: "🪙",
        closeInPulses: P_DAY,
        description: "Pattern recognition is stewardship: you see the signal without superstition.",
      },
    ),

    /* ─────────────────────────────────────────────────────────────
       💠 CRYPTO — Proof Games (hash as witness)
       All solvable offline, all verifiable, no authority.
    ───────────────────────────────────────────────────────────── */

    mk(
      "m_crypto_closepulse_hash_starts_00",
      "closepulse-hash-00",
      "Will the hash of this cycle’s CLOSE pulse start with '00'?",
      {
        category: CAT.CRYPTO,
        tags: ["crypto", "proof", "hash"],
        iconEmoji: "🔐",
        closeInPulses: P_DAY,
        description: "Hash is a public witness. You don’t trust — you verify.",
      },
    ),

    mk(
      "m_crypto_closepulse_hash_ends_even",
      "closepulse-hash-even",
      "Will the hash of this cycle’s CLOSE pulse end in an EVEN hex digit?",
      {
        category: CAT.CRYPTO,
        tags: ["crypto", "proof", "hash", "parity"],
        iconEmoji: "⚖️",
        closeInPulses: P_DAY,
      },
    ),

    mk(
      "m_crypto_closepulse_hash_contains_phi",
      "closepulse-hash-phi",
      "Will the hash of this cycle’s CLOSE pulse contain 'phi' (case-insensitive)?",
      {
        category: CAT.CRYPTO,
        tags: ["crypto", "proof", "hash", "phi"],
        iconEmoji: "🌀",
        closeInPulses: P_DAY,
        description: "A proof hunt. The result is deterministic — your job is to witness it.",
      },
    ),

    mk(
      "m_crypto_pulsehash_contains_beef_today",
      "pulsehash-beef",
      "Will any pulse-hash in this cycle contain 'beef'?",
      {
        category: CAT.CRYPTO,
        tags: ["crypto", "proof", "hash"],
        iconEmoji: "🥩",
        closeInPulses: P_DAY,
        description: "Deterministic search across a window. Coherence can still be playful.",
      },
    ),

    /* ─────────────────────────────────────────────────────────────
       🧪 TECH — Protocol Invariants (the skeleton of KKS v1)
       These teach the numbers you must know by heart.
    ───────────────────────────────────────────────────────────── */

    mk(
      "m_tech_grid_day_is_17424",
      "gridday-17424",
      "Will the discrete lattice day length equal 17,424 pulses (36×44×11)?",
      {
        category: CAT.TECH,
        tags: ["kks", "invariant", "17424"],
        iconEmoji: "🧠",
        closeInPulses: P_DAY,
        description: "This is the KKS discrete truth: 36 beats/day × 44 steps/beat × 11 pulses/step = 17,424.",
      },
    ),

    mk(
      "m_tech_next_beat_is_every_484",
      "beat-484",
      "Will a BEAT always equal 484 pulses (44×11) in the lattice?",
      {
        category: CAT.TECH,
        tags: ["kks", "invariant", "484"],
        iconEmoji: "🥁",
        closeInPulses: P_BEAT,
        description: "Sovereignty means knowing the constants. 484 is the beat spine.",
      },
    ),

    mk(
      "m_tech_next_arc_is_every_2904",
      "arc-2904",
      "Will an ARC always equal 2,904 pulses (6×484) in the lattice?",
      {
        category: CAT.TECH,
        tags: ["kks", "invariant", "2904"],
        iconEmoji: "⚡",
        closeInPulses: P_ARC,
        description: "Arc = 6 beats. 6 is the sovereign cycle base.",
      },
    ),

    mk(
      "m_tech_closepulse_mod_17424_is_0",
      "closepulse-mod17424",
      "Will this cycle’s CLOSE pulse land exactly on a discrete lattice day boundary (mod 17,424 = 0)?",
      {
        category: CAT.TECH,
        tags: ["kks", "17424", "boundary"],
        iconEmoji: "🧭",
        closeInPulses: P_DAY,
        description: "Tests alignment to the lattice day (17,424). A deep coherence check.",
      },
    ),

    /* ─────────────────────────────────────────────────────────────
       🌍 WORLD — Cycles of Dominion (Week / Month / Year in KKS)
       No Chronos. Only sovereign structure: 6 / 7 / 8 (336-day year).
    ───────────────────────────────────────────────────────────── */

    mk(
      "m_world_next_week_boundary_mod6",
      "next-week-boundary",
      "Will the next KKS WEEK boundary land on a STEP boundary (divisible by 11)?",
      {
        category: CAT.WORLD,
        tags: ["kks", "week", "6", "11"],
        iconEmoji: "🌍",
        closeInPulses: P_WEEK,
        description: "KKS week = 6 days. This tests multi-cycle alignment (week boundary vs breath lattice).",
      },
    ),

    mk(
      "m_world_next_month_boundary_mod484",
      "next-month-beat-aligned",
      "Will the next KKS MONTH boundary land exactly on a BEAT boundary (divisible by 484)?",
      {
        category: CAT.WORLD,
        tags: ["kks", "month", "42", "484"],
        iconEmoji: "🗺️",
        closeInPulses: P_MONTH,
        description: "KKS month = 7 weeks = 42 days. Tests long-cycle beat alignment.",
      },
    ),

    mk(
      "m_world_next_year_boundary_prime",
      "next-year-prime",
      "Will the next KKS YEAR boundary pulse be PRIME?",
      {
        category: CAT.WORLD,
        tags: ["kks", "year", "336", "prime"],
        iconEmoji: "🏛️",
        closeInPulses: P_YEAR,
        description: "KKS year = 8 months = 336 days. This is a true long-cycle sovereignty test.",
      },
    ),

    mk(
      "m_world_next_month_boundary_fibonacci",
      "next-month-fibonacci",
      "Will the next KKS MONTH boundary pulse be a Fibonacci number?",
      {
        category: CAT.WORLD,
        tags: ["kks", "month", "fibonacci", "phi"],
        iconEmoji: "🌀",
        closeInPulses: P_MONTH,
        description: "Long-cycle φ test: Fibonacci membership at a boundary pulse.",
      },
    ),

    /* ─────────────────────────────────────────────────────────────
       🧩 OTHER — Mastery Gates (hard, clean, deterministic)
       These are the “if you can do this, you’re sovereign” questions.
    ───────────────────────────────────────────────────────────── */

    mk(
      "m_other_next_phi_transition_within_arc",
      "phi-transition-within-arc",
      "Will a φ-transition pulse occur within the next ARC (2,904 pulses)?",
      {
        category: CAT.OTHER,
        tags: ["phi", "transition", "arc", "mastery"],
        iconEmoji: "✨",
        closeInPulses: P_ARC,
        description: "φ-transition pulses are ceil(φ^n). This tests spiral literacy inside a fixed window.",
      },
    ),

    mk(
      "m_other_next_fibonacci_within_beat",
      "fibonacci-within-beat",
      "Will a Fibonacci pulse occur within the next BEAT (484 pulses)?",
      {
        category: CAT.OTHER,
        tags: ["phi", "fibonacci", "beat", "mastery"],
        iconEmoji: "🌀",
        closeInPulses: P_BEAT,
        description: "Exact Fibonacci membership across a window. Deterministic search. No oracle.",
      },
    ),

    mk(
      "m_other_next_lucas_within_beat",
      "lucas-within-beat",
      "Will a Lucas pulse occur within the next BEAT (484 pulses)?",
      {
        category: CAT.OTHER,
        tags: ["phi", "lucas", "beat", "mastery"],
        iconEmoji: "🧬",
        closeInPulses: P_BEAT,
        description: "Lucas is rarer. This trains patience + exact verification.",
      },
    ),

    mk(
      "m_other_next_arc_gate_is_prime_arc",
      "prime-arc",
      "At the next ARC boundary, will the ARC index be PRIME?",
      {
        category: CAT.OTHER,
        tags: ["kks", "arc", "prime", "mastery"],
        iconEmoji: "🔢",
        closeInPulses: P_ARC,
        description: "ARC index is 0..5. Prime arcs are {2,3,5}. Simple set, deep timing.",
      },
    ),

    /* ─────────────────────────────────────────────────────────────
       🏈 SPORTS — Prime Trials (no teams, no scores, pure math)
       “Sports” here means: competitive reasoning under rules.
    ───────────────────────────────────────────────────────────── */

    mk(
      "m_sports_next_beat_prime",
      "beat-prime",
      "Will the next BEAT number be PRIME?",
      {
        category: CAT.SPORTS,
        tags: ["prime", "beat", "trial"],
        iconEmoji: "🏁",
        closeInPulses: P_BEAT,
        description: "A pure sovereignty trial: know primes, know beats, know the moment.",
      },
    ),

    mk(
      "m_sports_next_stepindex_in_top_quarter",
      "stepindex-top-quarter",
      "At the next STEP boundary, will the STEP index be in the top quarter (33–43)?",
      {
        category: CAT.SPORTS,
        tags: ["kks", "step", "trial"],
        iconEmoji: "🏋️",
        closeInPulses: PULSES_PER_STEP,
        description: "Step index is 0..43. This trains your intuition for lattice position.",
      },
    ),

    mk(
      "m_sports_next_arc_gate",
      "arc-gate",
      "Will the next BEAT boundary also be an ARC gate (beat % 6 = 0)?",
      {
        category: CAT.SPORTS,
        tags: ["kks", "arc", "gate", "trial"],
        iconEmoji: "🚪",
        closeInPulses: P_BEAT,
      },
    ),

    /* ─────────────────────────────────────────────────────────────
       🌦️ WEATHER — Coherence Climate (no external weather)
       “Weather” here means: pattern density of the closing number.
    ───────────────────────────────────────────────────────────── */

    mk(
      "m_weather_closepulse_has_3plus_same_digit_run",
      "climate-run3",
      "Will this cycle’s CLOSE pulse contain a run of 3+ identical digits?",
      {
        category: CAT.WEATHER,
        tags: ["pattern", "digits", "run", "climate"],
        iconEmoji: "🌫️",
        closeInPulses: P_DAY,
        description: "Coherence climate: runs indicate structured repetition in the closing stamp.",
      },
    ),

    mk(
      "m_weather_closepulse_has_00",
      "climate-00",
      "Will this cycle’s CLOSE pulse contain '00'?",
      {
        category: CAT.WEATHER,
        tags: ["pattern", "digits", "climate"],
        iconEmoji: "☁️",
        closeInPulses: P_DAY,
      },
    ),

    mk(
      "m_weather_closepulse_palindrome",
      "climate-palindrome",
      "Will this cycle’s CLOSE pulse be a palindrome?",
      {
        category: CAT.WEATHER,
        tags: ["pattern", "palindrome", "climate"],
        iconEmoji: "⛈️",
        closeInPulses: P_DAY,
      },
    ),

    /* ─────────────────────────────────────────────────────────────
       🗓️ CALENDAR — KKS Calendar (no Chronos)
       6 days/week, 7 weeks/month, 8 months/year.
    ───────────────────────────────────────────────────────────── */

    mk(
      "m_calendar_next_week_boundary_even",
      "next-week-even",
      "Will the next KKS WEEK boundary pulse be EVEN?",
      {
        category: CAT.CALENDAR,
        tags: ["kks", "calendar", "week", "6", "parity"],
        iconEmoji: "🗓️",
        closeInPulses: P_WEEK,
        description: "KKS week = 6 days. You’re learning sovereign calendar structure by measurement.",
      },
    ),

    mk(
      "m_calendar_next_month_boundary_div11",
      "next-month-div11",
      "Will the next KKS MONTH boundary pulse be divisible by 11?",
      {
        category: CAT.CALENDAR,
        tags: ["kks", "calendar", "month", "42", "11"],
        iconEmoji: "🧿",
        closeInPulses: P_MONTH,
        description: "Month = 42 days. Divisible by 11 means exact step-boundary alignment at the boundary.",
      },
    ),

    mk(
      "m_calendar_next_year_boundary_div484",
      "next-year-div484",
      "Will the next KKS YEAR boundary pulse be divisible by 484?",
      {
        category: CAT.CALENDAR,
        tags: ["kks", "calendar", "year", "336", "484"],
        iconEmoji: "🥁",
        closeInPulses: P_YEAR,
        description: "Year = 336 days. Divisible by 484 means it lands exactly on a beat boundary.",
      },
    ),

    mk(
      "m_calendar_next_month_boundary_prime",
      "next-month-prime",
      "Will the next KKS MONTH boundary pulse be PRIME?",
      {
        category: CAT.CALENDAR,
        tags: ["kks", "calendar", "month", "prime"],
        iconEmoji: "🔢",
        closeInPulses: P_MONTH,
        description: "A long-horizon sovereignty test: primality at a true boundary.",
      },
    ),

    mk(
      "m_calendar_grid_day_is_17424",
      "gridday-17424",
      "Will the discrete lattice day equal 17,424 pulses (36×44×11)?",
      {
        category: CAT.CALENDAR,
        tags: ["kks", "calendar", "17424"],
        iconEmoji: "🧠",
        closeInPulses: P_DAY,
        description: "This repeats on purpose: you should know 17,424 by heart.",
      },
    ),

    mk(
      "m_calendar_next_boundary_is_arc_boundary",
      "next-arc-boundary",
      "Will the next ARC boundary occur within the next 2,904 pulses?",
      {
        category: CAT.CALENDAR,
        tags: ["kks", "calendar", "arc", "2904"],
        iconEmoji: "⚡",
        closeInPulses: P_ARC,
        description: "Arc length is fixed in the lattice: 2,904 pulses (6 beats).",
      },
    ),
  ];
};

/**
 * Fetch the market list.
 * - Remote mode if baseUrl provided.
 * - Local mode otherwise (seeded).
 */
export const fetchMarkets = async (cfg: SigilMarketsMarketApiConfig, nowPulse: KaiPulse): Promise<FetchMarketsResult> => {
  if (!cfg.baseUrl) {
    return { ok: true, markets: seedDemoMarkets(nowPulse), lastSyncedPulse: nowPulse, fromCache: true, isStale: false };
  }

  const path = cfg.marketsPath ?? "/markets";
  const url = withQuery(joinUrl(cfg.baseUrl, path), cfg.marketsQuery);

  const res = await cachedJsonFetch<Readonly<{ markets: readonly Market[]; lastSyncedPulse?: KaiPulse }>>({
    url,
    policy: { maxAgeMs: cfg.cache.maxAgeMs, staleWhileRevalidateMs: cfg.cache.staleWhileRevalidateMs, persist: true },
    mode: "cache-first",
    decode: decodeMarketListResponse,
  });

  if (!res.ok) return { ok: false, error: res.error, fromCache: res.fromCache };

  return {
    ok: true,
    markets: res.value.markets,
    lastSyncedPulse: res.value.lastSyncedPulse,
    fromCache: res.fromCache,
    isStale: res.isStale,
  };
};

/** Default config (safe for both standalone and integrated apps). */
export const defaultMarketApiConfig = (): SigilMarketsMarketApiConfig => {
  // Global override hook: window.__SIGIL_MARKETS_API_BASE__ = "https://…"
  const g = globalThis as unknown as UnknownRecord;
  const base = isString(g["__SIGIL_MARKETS_API_BASE__"]) ? (g["__SIGIL_MARKETS_API_BASE__"] as string) : undefined;

  return {
    baseUrl: base,
    marketsPath: "/markets",
    cache: { maxAgeMs: 12_000, staleWhileRevalidateMs: 60_000 },
  };
};
