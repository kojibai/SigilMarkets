// SigilMarkets/views/Prophecy/ProphecyMintForm.tsx
"use client";

import { useMemo, useState } from "react";
import type { KaiMoment, KaiPulse } from "../../types/marketTypes";
import type { EvidenceItem } from "../../types/oracleTypes";
import { asEvidenceHash, asEvidenceUrl } from "../../types/oracleTypes";
import { useProphecyFeed } from "../../hooks/useProphecyFeed";
import { Button } from "../../ui/atoms/Button";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Divider } from "../../ui/atoms/Divider";
import { Chip } from "../../ui/atoms/Chip";
import { Icon } from "../../ui/atoms/Icon";
import { parsePhiToMicro } from "../../utils/format";
import { sha256Hex } from "../../../utils/sha256";

const DEFAULT_CATEGORIES = ["macro", "tech", "markets", "culture", "science", "other"] as const;

const toPulseNumber = (raw: string): KaiPulse | null => {
  const s = raw.trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
};

const fileHash = async (file: File): Promise<string> => {
  const buf = await file.arrayBuffer();
  return sha256Hex(new Uint8Array(buf));
};

export type ProphecyMintFormProps = Readonly<{
  now: KaiMoment;
  onMinted?: () => void;
  compact?: boolean;
}>;

export const ProphecyMintForm = (props: ProphecyMintFormProps) => {
  const { actions, activeVault } = useProphecyFeed({ nowPulse: props.now.pulse });

  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  const [expirationPulseInput, setExpirationPulseInput] = useState("");
  const [escrowInput, setEscrowInput] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [zkStatus, setZkStatus] = useState<"idle" | "busy" | "ready">("idle");
  const [error, setError] = useState<string | null>(null);

  const sealLabel = useMemo(
    () => `Seal p${props.now.pulse} · b${props.now.beat} · s${props.now.stepIndex}`,
    [props.now.beat, props.now.pulse, props.now.stepIndex],
  );

  const canSubmit = useMemo(() => text.trim().length > 0 && !!activeVault, [activeVault, text]);

  const addEvidenceUrl = () => {
    const raw = evidenceUrl.trim();
    if (!raw) return;
    setEvidenceItems((prev) => [...prev, { kind: "url", url: asEvidenceUrl(raw) }]);
    setEvidenceUrl("");
  };

  const removeEvidence = (idx: number) => {
    setEvidenceItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const onFileChange = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    const hash = await fileHash(file);
    setEvidenceItems((prev) => [...prev, { kind: "hash", hash: asEvidenceHash(hash), label: file.name }]);
  };

  const submit = async () => {
    setError(null);
    const trimmed = text.trim();
    if (!trimmed) {
      setError("Prophecy text is required.");
      return;
    }
    if (!activeVault) {
      actions.requireAuth("auth");
      return;
    }

    const expirationPulse = toPulseNumber(expirationPulseInput);
    if (expirationPulse != null && expirationPulse < props.now.pulse) {
      setError("Expiration pulse must be >= current pulse.");
      return;
    }

    let escrowPhiMicro: string | undefined;
    if (escrowInput.trim()) {
      const parsed = parsePhiToMicro(escrowInput);
      if (!parsed.ok) {
        setError(`Escrow amount invalid: ${parsed.error}`);
        return;
      }
      escrowPhiMicro = parsed.micro.toString(10);
    }

    setBusy(true);
    setZkStatus("busy");

    const res = await actions.mintProphecy({
      text: trimmed,
      category: category.trim() || undefined,
      expirationPulse: expirationPulse ?? undefined,
      escrowPhiMicro,
      evidence: evidenceItems.length > 0 ? { items: evidenceItems } : undefined,
      createdAt: props.now,
    });

    setBusy(false);

    if (!res.ok) {
      setError(res.error);
      setZkStatus("idle");
      return;
    }

    setZkStatus("ready");
    setText("");
    setCategory("");
    setExpirationPulseInput("");
    setEscrowInput("");
    setEvidenceItems([]);
    if (props.onMinted) props.onMinted();
  };

  return (
    <Card variant={props.compact ? "glass2" : "glass"}>
      <CardContent>
        <div className="sm-title" style={{ fontSize: props.compact ? 14 : 16 }}>
          Prophecy Sigil
        </div>
        <div className="sm-subtitle" style={{ marginTop: 6 }}>
          Seal a time-locked claim. Portable, offline-verifiable, and ZK-bound.
        </div>

        <Divider />

        <div className="sm-seal-field">
          <div className="sm-seal-label">Prophecy text</div>
          <textarea
            className="sm-textarea"
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="State your prophecy before the outcome arrives."
          />
          <div className="sm-small">Keep it clear — the text is sealed into the SVG.</div>
        </div>

        <Divider />

        <div className="sm-seal-field">
          <div className="sm-seal-label">Category (optional)</div>
          <input
            className="sm-input"
            list="prophecy-categories"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Category or tag"
          />
          <datalist id="prophecy-categories">
            {DEFAULT_CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <Divider />

        <div className="sm-seal-grid">
          <div className="sm-seal-field">
            <div className="sm-seal-label">Expiration pulse (optional)</div>
            <input
              className="sm-input"
              type="number"
              min={props.now.pulse}
              value={expirationPulseInput}
              onChange={(e) => setExpirationPulseInput(e.target.value)}
              placeholder={`>= ${props.now.pulse}`}
            />
          </div>

          <div className="sm-seal-field">
            <div className="sm-seal-label">Escrow Φ (optional)</div>
            <input
              className="sm-input"
              value={escrowInput}
              onChange={(e) => setEscrowInput(e.target.value)}
              placeholder="e.g. 1.25"
            />
          </div>
        </div>

        <Divider />

        <div className="sm-seal-field">
          <div className="sm-seal-label">Evidence (optional)</div>
          <div className="sm-evidence-row">
            <input
              className="sm-input"
              value={evidenceUrl}
              onChange={(e) => setEvidenceUrl(e.target.value)}
              placeholder="Evidence URL"
            />
            <Button variant="ghost" size="sm" onClick={addEvidenceUrl}>
              Add URL
            </Button>
          </div>
          <div className="sm-evidence-row">
            <input
              className="sm-input"
              type="file"
              onChange={(e) => void onFileChange(e.target.files)}
            />
          </div>
          {evidenceItems.length > 0 ? (
            <div className="sm-evidence-list">
              {evidenceItems.map((item, idx) => (
                <div key={`${item.kind}-${idx}`} className="sm-evidence-item">
                  <span className="sm-small">
                    {item.kind === "url" ? item.url : `hash:${item.hash}`}
                  </span>
                  <button type="button" className="sm-evidence-remove" onClick={() => removeEvidence(idx)}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <Divider />

        <div className="sm-seal-field">
          <div className="sm-seal-label">Proof strength</div>
          <div className="sm-proof-row">
            <Chip size="sm" selected={false} tone={activeVault ? "success" : "default"}>
              Signature {activeVault ? "✓" : "—"}
            </Chip>
            <Chip size="sm" selected={false} tone={zkStatus === "ready" ? "success" : zkStatus === "busy" ? "gold" : "default"}>
              ZK {zkStatus === "ready" ? "✓" : zkStatus === "busy" ? "…" : "—"}
            </Chip>
            <Chip size="sm" selected={false} variant="outline">
              ZK ON
            </Chip>
          </div>
          <div className="sm-small">
            Private proof: reveals nothing, proves authorship.
          </div>
        </div>

        <Divider />

        <div className="sm-seal-footer">
          <div className="sm-small">{sealLabel}</div>
          {!activeVault ? (
            <Button
              variant="ghost"
              onClick={() => actions.requireAuth("auth")}
              leftIcon={<Icon name="scan" size={14} tone="cyan" />}
            >
              Inhale glyph
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => void submit()}
              loading={busy}
              disabled={!canSubmit}
              leftIcon={<Icon name="spark" size={14} tone="gold" />}
            >
              Mint Prophecy Sigil
            </Button>
          )}
        </div>

        {error ? <div className="sm-error" style={{ marginTop: 10 }}>{error}</div> : null}
      </CardContent>
    </Card>
  );
};
