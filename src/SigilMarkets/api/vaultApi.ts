// SigilMarkets/api/vaultApi.ts
"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * SigilMarkets — vaultApi
 *
 * This module defines the boundary between SigilMarkets and the surrounding app/backend
 * for value movements and identity-bound vault hydration.
 *
 * For MVP:
 * - Everything can run locally (no remote calls required).
 * - The API exposes hooks to:
 *   - derive vault identity from an inhaled sigil (handled in sigils/InhaleGlyphGate.tsx)
 *   - optionally sync vault snapshots from a server (if configured)
 *
 * Remote mode is optional and intentionally minimal.
 */

import type { KaiPulse, PhiMicro, VaultId } from "../types/marketTypes";
import type { VaultRecord } from "../types/vaultTypes";
import { cachedJsonFetch, type DecodeResult } from "./cacheApi";
import { parseBigIntDec } from "../utils/guards";
import { asVaultId } from "../types/marketTypes";
import { asKaiSignature, asSvgHash, asUserPhiKey, type KaiSignature, type SvgHash, type UserPhiKey } from "../types/vaultTypes";

type UnknownRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is UnknownRecord => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export type SigilMarketsVaultApiConfig = Readonly<{
  /** Optional. If absent, vaultApi is local-only. */
  baseUrl?: string;
  /** Path template for fetching a vault snapshot. Default: "/vault/{vaultId}" */
  vaultPathTemplate?: string;
  /** Cache policy. */
  cache: Readonly<{ maxAgeMs: number; staleWhileRevalidateMs: number }>;
}>;

export type FetchVaultResult =
  | Readonly<{ ok: true; vault: VaultRecord; fromCache: boolean; isStale: boolean }>
  | Readonly<{ ok: false; error: string; fromCache: boolean }>;

const joinUrl = (base: string, path: string): string => {
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
};

const replaceAll = (s: string, find: string, rep: string): string => s.split(find).join(rep);

/** Remote JSON shape */
type SerializedVaultSnapshot = Readonly<{
  vaultId: string;
  status: "active" | "frozen";
  owner: Readonly<{ userPhiKey: string; kaiSignature: string; identitySvgHash?: string }>;
  spendableMicro: string;
  lockedMicro: string;
  updatedPulse: number;
}>;

const decodeVaultSnapshot = (v: unknown): DecodeResult<VaultRecord> => {
  if (!isRecord(v)) return { ok: false, error: "vault: not object" };

  const vaultId = v["vaultId"];
  const status = v["status"];
  const owner = v["owner"];
  const spendableMicro = v["spendableMicro"];
  const lockedMicro = v["lockedMicro"];
  const updatedPulse = v["updatedPulse"];

  if (!isString(vaultId) || vaultId.length === 0) return { ok: false, error: "vaultId: bad" };
  if (status !== "active" && status !== "frozen") return { ok: false, error: "status: bad" };
  if (!isRecord(owner)) return { ok: false, error: "owner: bad" };
  if (!isString(owner["userPhiKey"]) || owner["userPhiKey"].length === 0) return { ok: false, error: "owner.userPhiKey: bad" };
  if (!isString(owner["kaiSignature"]) || owner["kaiSignature"].length === 0) return { ok: false, error: "owner.kaiSignature: bad" };
  if (!isString(spendableMicro) || !isString(lockedMicro)) return { ok: false, error: "balances: bad" };
  if (!isNumber(updatedPulse)) return { ok: false, error: "updatedPulse: bad" };

  const s = parseBigIntDec(spendableMicro);
  const l = parseBigIntDec(lockedMicro);
  if (s === null || l === null) return { ok: false, error: "balances: parse fail" };

  const identitySvgHash = isString(owner["identitySvgHash"]) ? asSvgHash(owner["identitySvgHash"]) : undefined;

  const rec: VaultRecord = {
    vaultId: asVaultId(vaultId),
    owner: {
      userPhiKey: asUserPhiKey(owner["userPhiKey"]) as UserPhiKey,
      kaiSignature: asKaiSignature(owner["kaiSignature"]) as KaiSignature,
      identitySigil: identitySvgHash ? { svgHash: identitySvgHash } : undefined,
    },
    status,
    spendableMicro: s as PhiMicro,
    lockedMicro: l as PhiMicro,
    locks: [], // remote snapshot omits lock list; local store holds actual locks
    stats: undefined,
    createdPulse: Math.max(0, Math.floor(updatedPulse)),
    updatedPulse: Math.max(0, Math.floor(updatedPulse)),
  };

  return { ok: true, value: rec };
};

export const defaultVaultApiConfig = (): SigilMarketsVaultApiConfig => {
  const g = globalThis as unknown as UnknownRecord;
  const base = isString(g["__SIGIL_MARKETS_VAULT_API_BASE__"]) ? (g["__SIGIL_MARKETS_VAULT_API_BASE__"] as string) : undefined;

  return {
    baseUrl: base,
    vaultPathTemplate: "/vault/{vaultId}",
    cache: { maxAgeMs: 6_000, staleWhileRevalidateMs: 30_000 },
  };
};

export const fetchVaultSnapshot = async (cfg: SigilMarketsVaultApiConfig, vaultId: VaultId): Promise<FetchVaultResult> => {
  if (!cfg.baseUrl) {
    return { ok: false, error: "vaultApi not configured", fromCache: false };
  }

  const tmpl = cfg.vaultPathTemplate ?? "/vault/{vaultId}";
  const path = replaceAll(tmpl, "{vaultId}", vaultId as unknown as string);
  const url = joinUrl(cfg.baseUrl, path);

  const res = await cachedJsonFetch<VaultRecord>({
    url,
    policy: { maxAgeMs: cfg.cache.maxAgeMs, staleWhileRevalidateMs: cfg.cache.staleWhileRevalidateMs, persist: true },
    mode: "cache-first",
    decode: decodeVaultSnapshot,
  });

  if (!res.ok) return { ok: false, error: res.error, fromCache: res.fromCache };

  return { ok: true, vault: res.value, fromCache: res.fromCache, isStale: res.isStale };
};
