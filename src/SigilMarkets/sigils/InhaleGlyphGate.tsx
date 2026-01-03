"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * InhaleGlyphGate
 *
 * UX:
 * - User uploads/selects their Identity Sigil (SVG)
 * - We extract: userPhiKey + kaiSignature + svgHash
 * - We derive vaultId deterministically and activate it in vaultStore
 *
 * Notes:
 * - MVP supports SVG best. (PNG support comes with SigilExport embedding + scanner.)
 * - This component is designed to be rendered inside a Sheet by a future SheetHost.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { KaiMoment, MarketId, VaultId } from "../types/marketTypes";
import { Sheet } from "../ui/atoms/Sheet";
import { Button } from "../ui/atoms/Button";
import { Divider } from "../ui/atoms/Divider";
import { Icon } from "../ui/atoms/Icon";
import { Chip } from "../ui/atoms/Chip";
import { parsePhiToMicro, shortHash } from "../utils/format";

import { deriveVaultId, sha256Hex } from "../utils/ids";
import { useSigilMarketsUi } from "../state/uiStore";
import { useSigilMarketsVaultStore } from "../state/vaultStore";

import type { CanonicalHash, KaiSignature, SvgHash, UserPhiKey } from "../types/vaultTypes";
import { asCanonicalHash, asKaiSignature, asSvgHash, asUserPhiKey } from "../types/vaultTypes";

import type { PhiMicro } from "../types/marketTypes";
import { computeIntrinsicUnsigned, type SigilMetadataLite } from "../../utils/valuation";
import { extractEmbeddedMetaFromSvg, extractProofBundleMetaFromSvg } from "../../utils/sigilMetadata";
import { resolveGlyphPhi } from "../../utils/glyphValue";
import { validateMeta as verifierValidateMeta } from "../../verifier/validator";
import { ETERNAL_STEPS_PER_BEAT } from "../../SovereignSolar";
import { makeSigilUrlLoose, type SigilSharePayloadLoose } from "../../utils/sigilUrl";
import { registerSigilUrl } from "../../utils/sigilRegistry";
import { enqueueInhaleKrystal, flushInhaleQueue } from "../../components/SigilExplorer/inhaleQueue";

type InhaleReason = "auth" | "trade" | "vault";

export type InhaleGlyphGateProps = Readonly<{
  open: boolean;
  onClose: () => void;

  now: KaiMoment;

  reason: InhaleReason;
  marketId?: MarketId;

  /**
   * Optional: initial deposit when first creating a vault (local MVP).
   * Default: 0.
   */
  initialSpendableMicro?: PhiMicro;
}>;

type ParsedIdentity = Readonly<{
  rawSvg: string;
  svgHash: SvgHash;
  userPhiKey: UserPhiKey;
  kaiSignature: KaiSignature;

  pulse?: number;
  chakraDay?: SigilSharePayloadLoose["chakraDay"];

  /** Branded canonical hash (preferred stable identity key). */
  canonicalHash?: CanonicalHash;

  sigilMeta?: SigilMetadataLite;
  sigilPayload?: SigilSharePayloadLoose;
  sigilUrl?: string;
  valuePhi?: number;
}>;

const isString = (v: unknown): v is string => typeof v === "string";
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

type ChakraDayName = SigilSharePayloadLoose["chakraDay"];

const isChakraDayName = (v: string): v is ChakraDayName =>
  v === "Root" ||
  v === "Sacral" ||
  v === "Solar Plexus" ||
  v === "Heart" ||
  v === "Throat" ||
  v === "Third Eye" ||
  v === "Crown";

const normalizeChakraDayName = (v: unknown): ChakraDayName | undefined => {
  if (!isString(v)) return undefined;
  const t = v.trim();
  if (!t) return undefined;

  if (isChakraDayName(t)) return t;

  const k = t.toLowerCase().replace(/\s+/g, " ").trim();
  if (k === "root") return "Root";
  if (k === "sacral") return "Sacral";
  if (k === "solar plexus" || k === "solarplexus") return "Solar Plexus";
  if (k === "heart") return "Heart";
  if (k === "throat") return "Throat";
  if (k === "third eye" || k === "thirdeye") return "Third Eye";
  if (k === "crown") return "Crown";

  return undefined;
};

const readFileText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(new Error("Failed to read file"));
    r.readAsText(file);
  });

const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(new Error("Failed to read file"));
    r.readAsArrayBuffer(file);
  });

const bytesToHex = (bytes: Uint8Array): string => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, "0");
  return out;
};

const sha256HexBytes = async (buf: ArrayBuffer): Promise<string> => {
  try {
    if (typeof crypto !== "undefined" && crypto.subtle && typeof crypto.subtle.digest === "function") {
      const digest = await crypto.subtle.digest("SHA-256", buf);
      return bytesToHex(new Uint8Array(digest));
    }
  } catch {
    // ignore
  }
  const bytes = new Uint8Array(buf);
  return sha256Hex(bytesToHex(bytes));
};

const tryJson = (s: string): unknown | null => {
  const t = s.trim();
  if (!t) return null;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return null;
  }
};

const extractFirstString = (obj: unknown, paths: readonly string[]): string | null => {
  if (!isRecord(obj)) return null;

  for (const p of paths) {
    const parts = p.split(".");
    let cur: unknown = obj;
    let ok = true;

    for (const key of parts) {
      if (!isRecord(cur) || !(key in cur)) {
        ok = false;
        break;
      }
      cur = (cur as Record<string, unknown>)[key];
    }

    if (ok && isString(cur) && cur.trim().length > 0) return cur.trim();
  }

  return null;
};

const extractAttr = (el: Element, names: readonly string[]): string | null => {
  for (const n of names) {
    const v = el.getAttribute(n);
    if (v && v.trim().length > 0) return v.trim();
  }
  return null;
};

const parseIdentityFromSvg = async (rawSvg: string, precomputedSvgHash?: SvgHash): Promise<ParsedIdentity> => {
  const svgHash: SvgHash =
    precomputedSvgHash ?? asSvgHash(await sha256HexBytes(new TextEncoder().encode(rawSvg).buffer));

  const parser = new DOMParser();
  const doc = parser.parseFromString(rawSvg, "image/svg+xml");
  const svg = doc.documentElement;

  if (!svg || svg.nodeName.toLowerCase() !== "svg") {
    throw new Error("Not a valid SVG file");
  }

  const userPhiKey =
    extractAttr(svg, [
      "data-phikey",
      "data-phi-key",
      "data-user-phikey",
      "data-user-phi-key",
      "data-phiKey",
      "data-userPhiKey",
    ]) ?? "";
  const kaiSignature =
    extractAttr(svg, ["data-kai-signature", "data-kaisignature", "data-kaiSignature", "data-kaisig", "data-kai-sig"]) ??
    "";

  const pulseStr = extractAttr(svg, ["data-pulse", "data-kai-pulse", "data-kaipulse"]);
  const chakraDayRaw = extractAttr(svg, ["data-chakra-day", "data-chakraDay", "data-chakraday"]);
  const chakraDay = normalizeChakraDayName(chakraDayRaw);

  let pulse: number | undefined;
  if (pulseStr && /^\d+$/.test(pulseStr)) {
    const n = Number(pulseStr);
    if (Number.isFinite(n)) pulse = Math.max(0, Math.floor(n));
  }

  let userPhiKey2 = userPhiKey;
  let kaiSignature2 = kaiSignature;

  if (!userPhiKey2 || !kaiSignature2) {
    const metaEl = doc.getElementsByTagName("metadata")?.[0] ?? null;
    const descEl = doc.getElementsByTagName("desc")?.[0] ?? null;

    const metaText = metaEl?.textContent ?? "";
    const descText = descEl?.textContent ?? "";

    const metaJson = tryJson(metaText);
    const descJson = tryJson(descText);

    const candidates = [metaJson, descJson].filter((x) => x !== null);

    for (const cand of candidates) {
      if (!userPhiKey2) {
        const k =
          extractFirstString(cand, [
            "userPhiKey",
            "phiKey",
            "phikey",
            "proofCapsule.phiKey",
            "proofCapsule.userPhiKey",
            "capsule.userPhiKey",
          ]) ?? "";
        if (k) userPhiKey2 = k;
      }
      if (!kaiSignature2) {
        const s =
          extractFirstString(cand, ["kaiSignature", "kaiSig", "proofCapsule.kaiSignature", "capsule.kaiSignature"]) ??
          "";
        if (s) kaiSignature2 = s;
      }
    }
  }

  if (!userPhiKey2) throw new Error("Missing userPhiKey / phiKey in glyph");
  if (!kaiSignature2) throw new Error("Missing kaiSignature in glyph");

  return {
    rawSvg,
    svgHash,
    userPhiKey: asUserPhiKey(userPhiKey2),
    kaiSignature: asKaiSignature(kaiSignature2),
    pulse,
    chakraDay,
  };
};

const toPhiMicro = (valuePhi?: number): PhiMicro | undefined => {
  if (valuePhi === undefined || !Number.isFinite(valuePhi)) return undefined;
  const parsed = parsePhiToMicro(valuePhi.toFixed(6));
  return parsed.ok ? (parsed.micro as PhiMicro) : undefined;
};

export const InhaleGlyphGate = (props: InhaleGlyphGateProps) => {
  const { open, onClose, now, reason, initialSpendableMicro } = props;

  const { actions: ui } = useSigilMarketsUi();
  const { actions: vault } = useSigilMarketsVaultStore();

  const inputRef = useRef<HTMLInputElement | null>(null);

  const [fileName, setFileName] = useState<string>("");
  const [parsed, setParsed] = useState<ParsedIdentity | null>(null);
  const [vaultId, setVaultId] = useState<VaultId | null>(null);

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  const reset = useCallback((): void => {
    setFileName("");
    setParsed(null);
    setVaultId(null);
    setErr(null);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const close = useCallback((): void => {
    reset();
    onClose();
  }, [onClose, reset]);

  const onPick = useCallback(
    async (f: File): Promise<void> => {
      setErr(null);
      setBusy(true);
      setParsed(null);
      setVaultId(null);
      setFileName(f.name);

      try {
        const type = (f.type || "").toLowerCase();

        if (type.includes("svg") || f.name.toLowerCase().endsWith(".svg")) {
          const buf = await readFileAsArrayBuffer(f);
          const bytesHash = asSvgHash(await sha256HexBytes(buf));

          const raw = await readFileText(f);
          const p = await parseIdentityFromSvg(raw, bytesHash);
          const vid = await deriveVaultId({ userPhiKey: p.userPhiKey, identitySvgHash: p.svgHash });

          let sigilMeta: SigilMetadataLite | undefined;
          let canonicalHash: CanonicalHash | undefined;
          let sigilPayload: SigilSharePayloadLoose | undefined;
          let sigilUrl: string | undefined;
          let valuePhi: number | undefined;

          try {
            const res = await verifierValidateMeta(raw);
            if (res.ok) {
              sigilMeta = res.meta;
              canonicalHash = asCanonicalHash(String(res.canonical).toLowerCase());
            }
          } catch {
            // ignore validation errors for inhale flow
          }

          if (!sigilMeta) {
            sigilMeta = {
              pulse: p.pulse ?? now.pulse,
              kaiSignature: p.kaiSignature,
              userPhiKey: p.userPhiKey,
              chakraDay: p.chakraDay,
            };
          }

          if (sigilMeta) {
            const { unsigned } = computeIntrinsicUnsigned(sigilMeta, now.pulse);
            const embeddedMeta = extractEmbeddedMetaFromSvg(raw);
            const embeddedProof = extractProofBundleMetaFromSvg(raw);
            const resolved = resolveGlyphPhi([embeddedMeta.raw, embeddedProof?.raw], unsigned.valuePhi);
            valuePhi = resolved.valuePhi ?? undefined;

            const pulse =
              typeof sigilMeta.pulse === "number"
                ? sigilMeta.pulse
                : typeof (sigilMeta as { kaiPulse?: unknown }).kaiPulse === "number"
                ? ((sigilMeta as { kaiPulse?: unknown }).kaiPulse as number)
                : null;

            const beat =
              typeof (sigilMeta as { beat?: unknown }).beat === "number"
                ? ((sigilMeta as { beat?: unknown }).beat as number)
                : null;

            const stepIndex =
              typeof (sigilMeta as { stepIndex?: unknown }).stepIndex === "number"
                ? ((sigilMeta as { stepIndex?: unknown }).stepIndex as number)
                : null;

            const chakraDayTyped = normalizeChakraDayName((sigilMeta as { chakraDay?: unknown }).chakraDay);

            if (pulse != null && beat != null && stepIndex != null && chakraDayTyped && canonicalHash) {
              const exportedAtPulse = (sigilMeta as { exportedAtPulse?: unknown }).exportedAtPulse;

              const canonicalHashStr = String(canonicalHash);

              const payload: SigilSharePayloadLoose = {
                pulse,
                beat,
                stepIndex,
                chakraDay: chakraDayTyped,
                stepsPerBeat:
                  typeof (sigilMeta as { stepsPerBeat?: unknown }).stepsPerBeat === "number"
                    ? ((sigilMeta as { stepsPerBeat?: unknown }).stepsPerBeat as number)
                    : ETERNAL_STEPS_PER_BEAT,
                canonicalHash: canonicalHashStr,
                kaiSignature:
                  typeof (sigilMeta as { kaiSignature?: unknown }).kaiSignature === "string"
                    ? ((sigilMeta as { kaiSignature?: unknown }).kaiSignature as string)
                    : undefined,
                userPhiKey:
                  typeof (sigilMeta as { userPhiKey?: unknown }).userPhiKey === "string"
                    ? ((sigilMeta as { userPhiKey?: unknown }).userPhiKey as string)
                    : undefined,
                exportedAtPulse: typeof exportedAtPulse === "number" ? exportedAtPulse : undefined,
              };

              sigilPayload = payload;
              sigilUrl = makeSigilUrlLoose(canonicalHashStr, payload);
            }
          }

          setParsed({
            ...p,
            canonicalHash,
            sigilMeta,
            sigilPayload,
            sigilUrl,
            valuePhi,
          });
          setVaultId(vid);
          setBusy(false);
          return;
        }

        throw new Error("Please inhale an SVG glyph (PNG scanning wires next).");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to parse glyph";
        setErr(msg);
        setBusy(false);
      }
    },
    [now.pulse],
  );

  const onConfirm = useCallback((): void => {
    if (!parsed || !vaultId) return;
    const valuePhiMicro = toPhiMicro(parsed.valuePhi);

    vault.createOrActivateVault({
      vaultId,
      owner: {
        userPhiKey: parsed.userPhiKey,
        kaiSignature: parsed.kaiSignature,
        identitySigil: {
          svgHash: parsed.svgHash,
          url: parsed.sigilUrl,
          canonicalHash: parsed.canonicalHash,
          valuePhiMicro,
          availablePhiMicro: valuePhiMicro,
          lastValuedPulse: valuePhiMicro !== undefined ? now.pulse : undefined,
        },
      },
      initialSpendableMicro: initialSpendableMicro ?? (0n as PhiMicro),
      createdPulse: now.pulse,
    });

    vault.setActiveVault(vaultId);

    if (parsed.sigilUrl && parsed.sigilPayload) {
      registerSigilUrl(parsed.sigilUrl);
      enqueueInhaleKrystal(parsed.sigilUrl, parsed.sigilPayload);
      void flushInhaleQueue();
    }

    ui.toast("success", "Glyph inhaled", "Vault activated", { atPulse: now.pulse });
    close();
  }, [close, initialSpendableMicro, now.pulse, parsed, ui, vault, vaultId]);

  const subtitle = useMemo(() => {
    if (reason === "trade") return "Inhale your identity glyph to lock Φ into a position.";
    if (reason === "vault") return "Inhale your identity glyph to activate your Vault.";
    return "Inhale your identity glyph to enter Sigil Markets.";
  }, [reason]);

  const onChooseClick = useCallback((): void => {
    inputRef.current?.click();
  }, []);

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Inhale Glyph"
      subtitle={subtitle}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            disabled={!parsed || !vaultId || busy}
            leftIcon={<Icon name="check" size={14} tone="gold" />}
          >
            Activate
          </Button>
        </div>
      }
    >
      <div className="sm-inhale">
        <div className="sm-inhale-pick">
          <input
            ref={inputRef}
            type="file"
            accept=".svg,image/svg+xml"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPick(f);
            }}
            style={{ display: "none" }}
          />

          <Button
            variant="primary"
            onClick={onChooseClick}
            loading={busy}
            leftIcon={<Icon name="scan" size={14} tone="cyan" />}
          >
            Choose glyph (SVG)
          </Button>

          {fileName ? (
            <div className="sm-small">Selected: {fileName}</div>
          ) : (
            <div className="sm-small">Upload your KaiSigil SVG.</div>
          )}
        </div>

        {err ? (
          <div className="sm-inhale-err">
            <Icon name="warning" size={14} tone="danger" /> {err}
          </div>
        ) : null}

        {parsed && vaultId ? (
          <>
            <Divider />
            <div className="sm-inhale-proof sm-breathe-soft">
              <div className="sm-inhale-proof-top">
                <div className="sm-inhale-proof-title">
                  <Icon name="vault" size={14} tone="gold" /> Identity found
                </div>
                <Chip size="sm" selected={false} variant="outline" tone="gold">
                  pulse {now.pulse}
                </Chip>
              </div>

              <div className="sm-inhale-line">
                <span className="k">userPhiKey</span>
                <span className="v mono">{shortHash(String(parsed.userPhiKey), 12, 8)}</span>
              </div>
              <div className="sm-inhale-line">
                <span className="k">kaiSignature</span>
                <span className="v mono">{shortHash(String(parsed.kaiSignature), 12, 8)}</span>
              </div>
              <div className="sm-inhale-line">
                <span className="k">svgHash</span>
                <span className="v mono">{shortHash(String(parsed.svgHash), 12, 8)}</span>
              </div>
              <div className="sm-inhale-line">
                <span className="k">vaultId</span>
                <span className="v mono">{shortHash(String(vaultId), 14, 10)}</span>
              </div>

              {parsed.chakraDay ? (
                <div className="sm-inhale-line">
                  <span className="k">chakraDay</span>
                  <span className="v">{parsed.chakraDay}</span>
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        <Divider />

        <div className="sm-small">
          This binds your identity to a deterministic VaultId. Your identity glyph stays usable forever; positions are separate artifacts.
        </div>
      </div>
    </Sheet>
  );
};
