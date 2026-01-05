"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useContext,
  type ReactNode,
} from "react";

import {
  SM_PROPHECY_KEY,
  decodeEnvelope,
  getDefaultStorage,
  loadFromStorage,
  removeFromStorage,
  saveToStorage,
  wrapEnvelope,
  type Decoder,
  type PersistResult,
  type StorageLike,
} from "./persistence";

import type { KaiMoment, KaiPulse } from "../types/marketTypes";
import { asMicroDecimalString } from "../types/marketTypes";
import type { EvidenceBundle, EvidenceItem } from "../types/oracleTypes";
import { asEvidenceBundleHash, asEvidenceHash, asEvidenceUrl } from "../types/oracleTypes";
import type {
  ProphecyAuthor,
  ProphecyId,
  ProphecyRecord,
  ProphecySigilArtifact,
  ProphecySigilPayloadV1,
} from "../types/prophecyTypes";
import { asProphecyId } from "../types/prophecyTypes";
import { asKaiSignature, asSvgHash, asUserPhiKey } from "../types/vaultTypes";

type UnknownRecord = Record<string, unknown>;

const isRecord = (v: unknown): v is UnknownRecord => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isArray = (v: unknown): v is readonly unknown[] => Array.isArray(v);

const nowMs = (): number => {
  const t = Date.now();
  return Number.isFinite(t) ? t : 0;
};

const decodeKaiMoment = (v: unknown): PersistResult<KaiMoment> => {
  if (!isRecord(v)) return { ok: false, error: "moment: not object" };
  const pulse = v["pulse"];
  const beat = v["beat"];
  const stepIndex = v["stepIndex"];
  if (!isNumber(pulse) || !isNumber(beat) || !isNumber(stepIndex)) return { ok: false, error: "moment: bad fields" };
  return {
    ok: true,
    value: {
      pulse: Math.max(0, Math.floor(pulse)),
      beat: Math.floor(beat),
      stepIndex: Math.floor(stepIndex),
    },
  };
};

const decodeEvidenceBundle = (v: unknown): EvidenceBundle | undefined => {
  if (!isRecord(v)) return undefined;
  const itemsRaw = v["items"];
  if (!isArray(itemsRaw)) return undefined;

  const items: EvidenceItem[] = [];
  for (const item of itemsRaw) {
    if (!isRecord(item)) continue;
    const kind = item["kind"];
    if (kind === "url") {
      const urlRaw = item["url"];
      if (!isString(urlRaw) || urlRaw.length === 0) continue;
      items.push({ kind: "url", url: asEvidenceUrl(urlRaw), label: isString(item["label"]) ? item["label"] : undefined, note: isString(item["note"]) ? item["note"] : undefined });
      continue;
    }
    if (kind === "hash") {
      const hashRaw = item["hash"];
      if (!isString(hashRaw) || hashRaw.length === 0) continue;
      items.push({ kind: "hash", hash: asEvidenceHash(hashRaw), label: isString(item["label"]) ? item["label"] : undefined, note: isString(item["note"]) ? item["note"] : undefined });
    }
  }

  if (items.length === 0) return undefined;

  const bundleHash = isString(v["bundleHash"]) ? asEvidenceBundleHash(v["bundleHash"]) : undefined;
  const summary = isString(v["summary"]) ? v["summary"] : undefined;

  return { items, summary, bundleHash };
};

/* ------------------------- persistence shapes ------------------------- */

type SerializedProphecy = Readonly<{
  id: string;
  kind: "prophecy";

  text: string;
  textEnc: ProphecySigilPayloadV1["textEnc"];
  category?: string;
  expirationPulse?: KaiPulse;
  escrowPhiMicro?: string;
  evidence?: EvidenceBundle;

  createdAt: KaiMoment;
  createdAtPulse: KaiPulse;
  author: Readonly<{ userPhiKey: string; kaiSignature: string }>;

  sigil?: Readonly<{
    svgHash: string;
    url?: string;
    svgText?: string;
    canonicalHash: string;
    payload: ProphecySigilPayloadV1;
    zk?: ProphecySigilPayloadV1["zk"];
  }>;

  updatedPulse: KaiPulse;
}>;

type SerializedProphecyCache = Readonly<{
  propheciesById: Readonly<Record<string, SerializedProphecy>>;
  prophecyIds: readonly string[];
  lastUpdatedPulse?: KaiPulse;
}>;

const CACHE_ENVELOPE_VERSION = 1;

/* ------------------------- decoding helpers ------------------------- */

const decodeProphecy: Decoder<ProphecyRecord> = (v: unknown) => {
  if (!isRecord(v)) return { ok: false, error: "prophecy: not object" };

  const idRaw = v["id"];
  const kind = v["kind"];
  const text = v["text"];
  const textEnc = v["textEnc"];
  const createdAtRaw = v["createdAt"];
  const createdAtPulse = v["createdAtPulse"];
  const authorRaw = v["author"];
  const updatedPulseRaw = v["updatedPulse"];

  if (!isString(idRaw) || idRaw.length === 0) return { ok: false, error: "prophecy.id: bad" };
  if (kind !== "prophecy") return { ok: false, error: "prophecy.kind: bad" };
  if (!isString(text) || text.length === 0) return { ok: false, error: "prophecy.text: bad" };
  if (textEnc !== "uri" && textEnc !== "b64") return { ok: false, error: "prophecy.textEnc: bad" };
  if (!isRecord(authorRaw)) return { ok: false, error: "prophecy.author: bad" };
  if (!isNumber(updatedPulseRaw)) return { ok: false, error: "prophecy.updatedPulse: bad" };

  const momentRes = decodeKaiMoment(createdAtRaw);
  if (!momentRes.ok) return { ok: false, error: momentRes.error };

  const userPhiKeyRaw = authorRaw["userPhiKey"];
  const kaiSigRaw = authorRaw["kaiSignature"];
  if (!isString(userPhiKeyRaw) || userPhiKeyRaw.length === 0) return { ok: false, error: "author.userPhiKey: bad" };
  if (!isString(kaiSigRaw) || kaiSigRaw.length === 0) return { ok: false, error: "author.kaiSignature: bad" };

  const sigilRaw = v["sigil"];
  const sigil =
    isRecord(sigilRaw) && isString(sigilRaw["svgHash"]) && isRecord(sigilRaw["payload"])
      ? {
          svgHash: asSvgHash(sigilRaw["svgHash"]),
          url: isString(sigilRaw["url"]) ? sigilRaw["url"] : undefined,
          svgText: isString(sigilRaw["svgText"]) ? sigilRaw["svgText"] : undefined,
          canonicalHash: String(sigilRaw["canonicalHash"] ?? ""),
          payload: sigilRaw["payload"] as ProphecySigilPayloadV1,
          zk: isRecord(sigilRaw["zk"]) ? (sigilRaw["zk"] as ProphecySigilPayloadV1["zk"]) : undefined,
        }
      : undefined;

  const escrow = isString(v["escrowPhiMicro"]) ? v["escrowPhiMicro"] : undefined;
  const escrowPhiMicro = escrow && /^[0-9]+$/.test(escrow) ? asMicroDecimalString(escrow) : undefined;

  const evidence = decodeEvidenceBundle(v["evidence"]);

  return {
    ok: true,
    value: {
      id: asProphecyId(idRaw),
      kind: "prophecy",
      text,
      textEnc,
      category: isString(v["category"]) ? v["category"] : undefined,
      expirationPulse: isNumber(v["expirationPulse"]) ? Math.max(0, Math.floor(v["expirationPulse"])) : undefined,
      escrowPhiMicro,
      evidence,
      createdAt: momentRes.value,
      createdAtPulse: isNumber(createdAtPulse) ? Math.max(0, Math.floor(createdAtPulse)) : momentRes.value.pulse,
      author: { userPhiKey: asUserPhiKey(userPhiKeyRaw), kaiSignature: asKaiSignature(kaiSigRaw) },
      sigil,
      updatedPulse: Math.max(0, Math.floor(updatedPulseRaw)),
    },
  };
};

const decodeSerializedProphecyCache: Decoder<SerializedProphecyCache> = (v: unknown) => {
  if (!isRecord(v)) return { ok: false, error: "cache: not object" };

  const propheciesByIdRaw = v["propheciesById"];
  const prophecyIdsRaw = v["prophecyIds"];

  if (!isRecord(propheciesByIdRaw)) return { ok: false, error: "cache.propheciesById: bad" };
  if (!isArray(prophecyIdsRaw)) return { ok: false, error: "cache.prophecyIds: bad" };

  const propheciesById: Record<string, SerializedProphecy> = {};
  for (const [k, vv] of Object.entries(propheciesByIdRaw)) {
    if (!isString(k) || k.length === 0) continue;
    if (isRecord(vv)) propheciesById[k] = vv as unknown as SerializedProphecy;
  }

  const prophecyIds = prophecyIdsRaw.filter((x): x is string => isString(x) && x.length > 0);
  const lastUpdatedPulse = isNumber(v["lastUpdatedPulse"]) ? Math.max(0, Math.floor(v["lastUpdatedPulse"])) : undefined;

  return { ok: true, value: { propheciesById, prophecyIds, lastUpdatedPulse } };
};

/* ------------------------- store state ------------------------- */

export type ProphecyStoreStatus = "idle" | "loading" | "ready" | "error";

export type SigilMarketsProphecyState = Readonly<{
  propheciesById: Readonly<Record<string, ProphecyRecord>>;
  prophecyIds: readonly ProphecyId[];
  status: ProphecyStoreStatus;
  error?: string;
  lastUpdatedPulse?: KaiPulse;
  cacheSavedAtMs?: number;
}>;

const defaultProphecyState = (): SigilMarketsProphecyState => ({
  propheciesById: {},
  prophecyIds: [],
  status: "idle",
  error: undefined,
  lastUpdatedPulse: undefined,
  cacheSavedAtMs: undefined,
});

const sortProphecyIds = (byId: Readonly<Record<string, ProphecyRecord>>): ProphecyId[] => {
  const arr: Array<{ id: string; p: number }> = [];
  for (const [id, pr] of Object.entries(byId)) arr.push({ id, p: pr.updatedPulse ?? 0 });
  arr.sort((a, b) => (b.p !== a.p ? b.p - a.p : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return arr.map((x) => asProphecyId(x.id));
};

const serializeProphecy = (p: ProphecyRecord): SerializedProphecy => ({
  id: p.id as unknown as string,
  kind: p.kind,
  text: p.text,
  textEnc: p.textEnc,
  category: p.category,
  expirationPulse: p.expirationPulse,
  escrowPhiMicro: p.escrowPhiMicro,
  evidence: p.evidence,
  createdAt: p.createdAt,
  createdAtPulse: p.createdAtPulse,
  author: { userPhiKey: p.author.userPhiKey as unknown as string, kaiSignature: p.author.kaiSignature as unknown as string },
  sigil: p.sigil
    ? {
        svgHash: p.sigil.svgHash as unknown as string,
        url: p.sigil.url,
        svgText: p.sigil.svgText,
        canonicalHash: p.sigil.canonicalHash as unknown as string,
        payload: p.sigil.payload,
        zk: p.sigil.zk,
      }
    : undefined,
  updatedPulse: p.updatedPulse,
});

const persistCache = (storage: StorageLike | null, state: SigilMarketsProphecyState): void => {
  if (!storage) return;

  const propheciesById: Record<string, SerializedProphecy> = {};
  for (const [k, p] of Object.entries(state.propheciesById)) propheciesById[k] = serializeProphecy(p);

  const data: SerializedProphecyCache = {
    propheciesById,
    prophecyIds: state.prophecyIds.map((pid: ProphecyId) => pid as unknown as string),
    lastUpdatedPulse: state.lastUpdatedPulse,
  };

  const env = wrapEnvelope(data as unknown as never, CACHE_ENVELOPE_VERSION);
  saveToStorage(SM_PROPHECY_KEY, env, storage);
};

const loadCache = (storage: StorageLike | null): PersistResult<Readonly<{ state: SigilMarketsProphecyState }>> => {
  const res = loadFromStorage(
    SM_PROPHECY_KEY,
    (raw) => decodeEnvelope(raw, CACHE_ENVELOPE_VERSION, decodeSerializedProphecyCache),
    storage,
  );
  if (!res.ok) return { ok: false, error: res.error };
  if (res.value === null) return { ok: true, value: { state: defaultProphecyState() } };

  const env = res.value;
  const cache = env.data;

  const propheciesById: Record<string, ProphecyRecord> = {};
  for (const [k, sv] of Object.entries(cache.propheciesById)) {
    const dp = decodeProphecy(sv);
    if (dp.ok) propheciesById[k] = dp.value;
  }

  const prophecyIdsFromCache = cache.prophecyIds
    .filter((id: string) => propheciesById[id] !== undefined)
    .map((id: string) => asProphecyId(id));

  const prophecyIds = prophecyIdsFromCache.length > 0 ? prophecyIdsFromCache : sortProphecyIds(propheciesById);

  return {
    ok: true,
    value: {
      state: {
        propheciesById,
        prophecyIds,
        status: "ready",
        lastUpdatedPulse: cache.lastUpdatedPulse,
        cacheSavedAtMs: nowMs(),
      },
    },
  };
};

/* ------------------------- store provider ------------------------- */

export type CreateProphecyInput = Readonly<{
  id?: ProphecyId;
  text: string;
  textEnc: ProphecySigilPayloadV1["textEnc"];
  category?: string;
  expirationPulse?: KaiPulse;
  escrowPhiMicro?: string;
  evidence?: EvidenceBundle;
  createdAt: KaiMoment;
  author: ProphecyAuthor;
  sigil?: ProphecySigilArtifact;
}>;

export type SigilMarketsProphecyActions = Readonly<{
  addProphecy: (input: CreateProphecyInput) => ProphecyRecord;
  removeProphecy: (id: ProphecyId) => void;
  attachProphecySigil: (id: ProphecyId, sigil: ProphecySigilArtifact, updatedPulse: KaiPulse) => PersistResult<ProphecyRecord>;
  upsertProphecies: (prophecies: readonly ProphecyRecord[], opts?: Readonly<{ lastUpdatedPulse?: KaiPulse }>) => void;
  reset: () => void;
  clearPersisted: () => void;
}>;

export type SigilMarketsProphecyStore = Readonly<{
  state: SigilMarketsProphecyState;
  actions: SigilMarketsProphecyActions;
}>;

const SigilMarketsProphecyContext = createContext<SigilMarketsProphecyStore | null>(null);

export const SigilMarketsProphecyProvider = (props: Readonly<{ children: ReactNode }>) => {
  const storage = useMemo(() => getDefaultStorage(), []);
  const [state, setState] = useState<SigilMarketsProphecyState>(() => {
    const cached = loadCache(storage);
    return cached.ok ? cached.value.state : defaultProphecyState();
  });

  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistedJsonRef = useRef<string>("");

  useEffect(() => {
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, []);

  const schedulePersist = useCallback(
    (next: SigilMarketsProphecyState) => {
      if (!storage) return;
      if (persistTimer.current) clearTimeout(persistTimer.current);

      persistTimer.current = setTimeout(() => {
        const json = JSON.stringify(next);
        if (json === lastPersistedJsonRef.current) return;
        lastPersistedJsonRef.current = json;
        persistCache(storage, next);
      }, 240);
    },
    [storage],
  );

  const setAndPersist = useCallback(
    (updater: (prev: SigilMarketsProphecyState) => SigilMarketsProphecyState) => {
      setState((prev) => {
        const next = updater(prev);
        schedulePersist(next);
        return next;
      });
    },
    [schedulePersist],
  );

  useEffect(() => {
    if (!storage || typeof window === "undefined") return;
    const onStorage = (e: StorageEvent): void => {
      if (e.key !== SM_PROPHECY_KEY) return;
      if (e.newValue === null) return;
      try {
        const parsed = JSON.parse(e.newValue) as unknown;
        const env = decodeEnvelope(parsed, CACHE_ENVELOPE_VERSION, decodeSerializedProphecyCache);
        if (!env.ok) return;
        setState((prev) => ({
          ...prev,
          propheciesById: Object.fromEntries(
            Object.entries(env.value.data.propheciesById).flatMap(([k, v]) => {
              const dp = decodeProphecy(v);
              return dp.ok ? [[k, dp.value]] : [];
            }),
          ),
          prophecyIds: env.value.data.prophecyIds.map((id) => asProphecyId(id)),
          lastUpdatedPulse: env.value.data.lastUpdatedPulse,
          cacheSavedAtMs: nowMs(),
        }));
      } catch {
        // ignore malformed storage events
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storage]);

  const actions: SigilMarketsProphecyActions = useMemo(() => {
    const addProphecy = (input: CreateProphecyInput): ProphecyRecord => {
      const id = input.id ?? asProphecyId(`prophecy_${nowMs()}_${Math.random().toString(16).slice(2)}`);
      const rec: ProphecyRecord = {
        id,
        kind: "prophecy",
        text: input.text,
        textEnc: input.textEnc,
        category: input.category,
        expirationPulse: input.expirationPulse,
        escrowPhiMicro: input.escrowPhiMicro,
        evidence: input.evidence,
        createdAt: input.createdAt,
        createdAtPulse: input.createdAt.pulse,
        author: input.author,
        sigil: input.sigil,
        updatedPulse: input.createdAt.pulse,
      };

      setAndPersist((prev) => {
        const byId: Record<string, ProphecyRecord> = { ...prev.propheciesById, [id as unknown as string]: rec };
        const prophecyIds = sortProphecyIds(byId);
        return { ...prev, propheciesById: byId, prophecyIds, lastUpdatedPulse: rec.updatedPulse };
      });

      return rec;
    };

    const removeProphecy = (id: ProphecyId): void => {
      const key = id as unknown as string;
      setAndPersist((prev) => {
        const byId = { ...prev.propheciesById };
        delete byId[key];
        const prophecyIds = prev.prophecyIds.filter((pid) => (pid as unknown as string) !== key);
        return { ...prev, propheciesById: byId, prophecyIds };
      });
    };

    const attachProphecySigil = (id: ProphecyId, sigil: ProphecySigilArtifact, updatedPulse: KaiPulse): PersistResult<ProphecyRecord> => {
      let out: ProphecyRecord | null = null;
      const key = id as unknown as string;
      setAndPersist((prev) => {
        const p = prev.propheciesById[key];
        if (!p) return prev;
        const next: ProphecyRecord = { ...p, sigil, updatedPulse: Math.max(p.updatedPulse, updatedPulse) };
        out = next;
        const byId: Record<string, ProphecyRecord> = { ...prev.propheciesById, [key]: next };
        const prophecyIds = sortProphecyIds(byId);
        return { ...prev, propheciesById: byId, prophecyIds, lastUpdatedPulse: Math.max(prev.lastUpdatedPulse ?? 0, updatedPulse) };
      });
      if (!out) return { ok: false, error: "prophecy not found" };
      return { ok: true, value: out };
    };

    const upsertProphecies = (prophecies: readonly ProphecyRecord[], opts?: Readonly<{ lastUpdatedPulse?: KaiPulse }>): void => {
      setAndPersist((prev) => {
        const byId: Record<string, ProphecyRecord> = { ...prev.propheciesById };
        for (const p of prophecies) byId[p.id as unknown as string] = p;
        const prophecyIds = sortProphecyIds(byId);
        const lastUpdatedPulse =
          typeof opts?.lastUpdatedPulse === "number" && Number.isFinite(opts.lastUpdatedPulse)
            ? Math.max(prev.lastUpdatedPulse ?? 0, Math.floor(opts.lastUpdatedPulse))
            : prev.lastUpdatedPulse;
        return { ...prev, propheciesById: byId, prophecyIds, lastUpdatedPulse };
      });
    };

    const reset = (): void => setAndPersist(() => defaultProphecyState());

    const clearPersisted = (): void => {
      if (storage) removeFromStorage(SM_PROPHECY_KEY, storage);
      setAndPersist(() => defaultProphecyState());
    };

    return { addProphecy, removeProphecy, attachProphecySigil, upsertProphecies, reset, clearPersisted };
  }, [setAndPersist, storage]);

  const store = useMemo(() => ({ state, actions }), [state, actions]);

  return (
    <SigilMarketsProphecyContext.Provider value={store}>
      {props.children}
    </SigilMarketsProphecyContext.Provider>
  );
};

export const useSigilMarketsProphecyStore = (): SigilMarketsProphecyStore => {
  const ctx = useContext(SigilMarketsProphecyContext);
  if (!ctx) throw new Error("SigilMarketsProphecyProvider missing");
  return ctx;
};

export const useProphecyList = (): readonly ProphecyRecord[] => {
  const { state } = useSigilMarketsProphecyStore();
  return useMemo(
    () =>
      state.prophecyIds
        .map((id) => state.propheciesById[id as unknown as string])
        .filter((p): p is ProphecyRecord => p !== undefined),
    [state.prophecyIds, state.propheciesById],
  );
};
