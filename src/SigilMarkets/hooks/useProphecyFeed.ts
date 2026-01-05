// SigilMarkets/hooks/useProphecyFeed.ts
"use client";

import { useCallback, useMemo } from "react";
import type { KaiMoment, KaiPulse } from "../types/marketTypes";
import type { EvidenceBundle } from "../types/oracleTypes";
import type { VaultRecord } from "../types/vaultTypes";
import { useActiveVault } from "../state/vaultStore";
import { useSigilMarketsUi } from "../state/uiStore";
import {
  useProphecyList,
  useSigilMarketsProphecyStore,
  type CreateProphecyInput,
} from "../state/prophecyStore";
import type {
  ProphecyAuthor,
  ProphecyId,
  ProphecyRecord,
  ProphecySigilArtifact,
  ProphecyTextEncoding,
} from "../types/prophecyTypes";
import { mintProphecySigil } from "../sigils/ProphecySigilMint";
import { prophecyWindowStatus } from "../utils/prophecySigil";

export type ActionResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: string }>;

export type ProphecyFeedQuery = Readonly<{
  authorPhiKey?: string;
  includeExpired?: boolean;
  nowPulse?: KaiPulse;
}>;

export type UseProphecyFeedResult = Readonly<{
  prophecies: readonly ProphecyRecord[];
  counts: Readonly<{
    total: number;
    open: number;
    closed: number;
  }>;

  activeVault: VaultRecord | null;

  actions: Readonly<{
    mintProphecy: (req: Readonly<{
      text: string;
      category?: string;
      expirationPulse?: KaiPulse;
      escrowPhiMicro?: string;
      evidence?: EvidenceBundle;
      createdAt: KaiMoment;
      textEnc?: ProphecyTextEncoding;
    }>) => Promise<ActionResult<ProphecyRecord>>;

    remove: (id: ProphecyId) => void;
    requireAuth: (reason: "auth" | "trade" | "vault") => void;
  }>;
}>;

const authorFromVault = (v: VaultRecord): ProphecyAuthor => ({
  userPhiKey: v.owner.userPhiKey,
  kaiSignature: v.owner.kaiSignature,
});

const filterProphecies = (items: readonly ProphecyRecord[], q?: ProphecyFeedQuery): readonly ProphecyRecord[] => {
  if (!q) return items;

  let out = items;
  if (q.authorPhiKey) {
    const key = q.authorPhiKey;
    out = out.filter((p) => String(p.author.userPhiKey) === key);
  }

  if (!q.includeExpired && typeof q.nowPulse === "number") {
    out = out.filter((p) => prophecyWindowStatus(p.expirationPulse, q.nowPulse) !== "closed");
  }

  return out;
};

const computeCounts = (items: readonly ProphecyRecord[], nowPulse?: KaiPulse): UseProphecyFeedResult["counts"] => {
  let open = 0;
  let closed = 0;

  for (const p of items) {
    const status = typeof nowPulse === "number" ? prophecyWindowStatus(p.expirationPulse, nowPulse) : "none";
    if (status === "closed") closed += 1;
    else open += 1;
  }

  return {
    total: items.length,
    open,
    closed,
  };
};

export const useProphecyFeed = (query?: ProphecyFeedQuery): UseProphecyFeedResult => {
  const list = useProphecyList();
  const activeVault = useActiveVault();
  const { actions: ui } = useSigilMarketsUi();
  const { actions: store } = useSigilMarketsProphecyStore();

  const prophecies = useMemo(
    () => filterProphecies(list, query),
    [list, query?.authorPhiKey, query?.includeExpired, query?.nowPulse],
  );

  const counts = useMemo(() => computeCounts(prophecies, query?.nowPulse), [prophecies, query?.nowPulse]);

  const requireAuth = useCallback(
    (reason: "auth" | "trade" | "vault") => {
      ui.pushSheet({ id: "inhale-glyph", reason });
    },
    [ui],
  );

  const mintProphecy = useCallback(
    async (req: Readonly<{
      text: string;
      category?: string;
      expirationPulse?: KaiPulse;
      escrowPhiMicro?: string;
      evidence?: EvidenceBundle;
      createdAt: KaiMoment;
      textEnc?: ProphecyTextEncoding;
    }>): Promise<ActionResult<ProphecyRecord>> => {
      if (!activeVault) {
        requireAuth("auth");
        return { ok: false, error: "not authenticated" };
      }

      const minted = await mintProphecySigil({
        text: req.text,
        category: req.category,
        expirationPulse: req.expirationPulse,
        escrowPhiMicro: req.escrowPhiMicro,
        evidence: req.evidence,
        now: req.createdAt,
        vault: activeVault,
      });

      if (!minted.ok) {
        ui.toast("error", "Mint failed", minted.error, { atPulse: req.createdAt.pulse });
        return { ok: false, error: minted.error };
      }

      const payload = minted.sigil.payload;

      const input: CreateProphecyInput = {
        id: payload.prophecyId,
        text: payload.text,
        textEnc: payload.textEnc,
        category: payload.category,
        expirationPulse: payload.expirationPulse,
        escrowPhiMicro: payload.escrowPhiMicro,
        evidence: payload.evidence,
        createdAt: payload.createdAt,
        author: authorFromVault(activeVault),
        sigil: minted.sigil as ProphecySigilArtifact,
      };

      const rec = store.addProphecy(input);
      ui.toast("success", "Prophecy sealed", undefined, { atPulse: req.createdAt.pulse });
      return { ok: true, value: rec };
    },
    [activeVault, requireAuth, store, ui],
  );

  const remove = useCallback(
    (id: ProphecyId) => {
      store.removeProphecy(id);
      ui.toast("info", "Removed", "Prophecy removed");
    },
    [store, ui],
  );

  return {
    prophecies,
    counts,
    activeVault,
    actions: {
      mintProphecy,
      remove,
      requireAuth,
    },
  };
};
