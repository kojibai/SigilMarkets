import crypto from "node:crypto";
import { saveSigil } from "./store.js";

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const safeCdata = (raw) => {
  const safe = raw.replace(/]]>/g, "]]]]><![CDATA[>");
  return `<![CDATA[${safe}]]>`;
};

const base64Encode = (text) => Buffer.from(String(text), "utf8").toString("base64");

const encodeProphecyText = (text, enc) =>
  enc === "b64" ? base64Encode(text) : encodeURIComponent(text);

const readJsonBody = async (req) => {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const textSnippet = (text) => {
  const t = String(text ?? "").trim().replace(/\s+/g, " ");
  if (t.length <= 80) return t;
  return `${t.slice(0, 78)}…`;
};

const buildProphecySvg = (payload) => {
  const textEnc = payload.textEnc === "b64" ? "b64" : "uri";
  const encodedText = encodeProphecyText(payload.text, textEnc);

  const evidenceUrls = Array.isArray(payload.evidence?.items)
    ? payload.evidence.items
        .filter((it) => it && it.kind === "url")
        .map((it) => String(it.url))
    : [];

  const zk = payload.zk ?? null;
  const zkProofJson = zk?.proof ? JSON.stringify(zk.proof) : "";
  const zkPublicJson = zk?.publicInputs ? JSON.stringify(zk.publicInputs) : "";

  const zkProofB64 = zkProofJson ? base64Encode(zkProofJson) : "";
  const zkPublicB64 = zkPublicJson ? base64Encode(zkPublicJson) : "";

  const metaJson = JSON.stringify({ ...payload, textEncoded: encodedText, textEnc });
  const zkMetaJson = JSON.stringify({
    scheme: zk?.scheme ?? "",
    proof: zk?.proof ?? null,
    publicInputs: zk?.publicInputs ?? null,
    poseidonHash: zk?.poseidonHash ?? null,
  });

  const desc = textSnippet(payload.text);
  const title = `Prophecy Sigil • p${payload.pulse}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 1000 1000"
  width="1000" height="1000"
  role="img"
  aria-label="${esc(title)}"
  data-kind="prophecy"
  data-v="${esc(payload.v)}"
  data-prophecy-id="${esc(payload.prophecyId)}"
  data-text="${esc(encodedText)}"
  data-text-enc="${esc(textEnc)}"
  data-category="${esc(payload.category ?? "")}"
  data-expiration="${esc(payload.expirationPulse ?? "")}"
  data-phikey="${esc(payload.userPhiKey ?? "")}"
  data-phi-key="${esc(payload.userPhiKey ?? "")}"
  data-kai-signature="${esc(payload.kaiSignature ?? "")}"
  data-pulse="${esc(payload.pulse ?? "")}"
  data-beat="${esc(payload.beat ?? "")}"
  data-step-index="${esc(payload.stepIndex ?? "")}"
  data-step-pct="${esc(payload.stepPct ?? "")}"
  data-canonical-hash="${esc(payload.canonicalHash ?? "")}"
  data-evidence-hash="${esc(payload.evidence?.bundleHash ?? "")}"
  data-evidence-urls="${esc(evidenceUrls.length ? encodeURIComponent(JSON.stringify(evidenceUrls)) : "")}"
  data-evidence-urls-enc="uri"
  data-phi-escrow-micro="${esc(payload.escrowPhiMicro ?? "")}"
  data-zk-scheme="${esc(zk?.scheme ?? "")}"
  data-zk-proof="${esc(zkProofB64)}"
  data-zk-proof-enc="b64"
  data-zk-public="${esc(zkPublicB64)}"
  data-zk-public-enc="b64"
  data-zk-poseidon-hash="${esc(zk?.poseidonHash ?? "")}">
  <title>${esc(title)}</title>
  <desc>${esc(desc)}</desc>
  <metadata id="sm-prophecy">${safeCdata(metaJson)}</metadata>
  <metadata id="sm-zk">${safeCdata(zkMetaJson)}</metadata>

  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="70%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.10)"/>
      <stop offset="60%" stop-color="rgba(0,0,0,0.00)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.22)"/>
    </radialGradient>
  </defs>

  <rect x="0" y="0" width="1000" height="1000" fill="rgba(8,10,18,1)"/>
  <rect x="0" y="0" width="1000" height="1000" fill="url(#bg)"/>

  <circle cx="500" cy="500" r="420" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="6"/>
  <circle cx="500" cy="500" r="300" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="3"/>
  <circle cx="500" cy="500" r="180" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="2"/>

  <g font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
     fill="rgba(255,255,255,0.80)" font-size="18">
    <text x="70" y="90">SM-PROPHECY-1</text>
    <text x="70" y="125">PULSE: ${esc(payload.pulse ?? "")}</text>
    <text x="70" y="160">Φ-KEY: ${esc(String(payload.userPhiKey ?? "").slice(0, 18))}</text>
    <text x="70" y="195">ZK: ${esc(zk?.scheme ?? "groth16-poseidon")}</text>
  </g>

  <g font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
     fill="rgba(255,255,255,0.92)" font-size="20">
    <text x="70" y="930">${esc(textSnippet(payload.text))}</text>
  </g>
</svg>`;
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "method not allowed" }));
    return;
  }

  try {
    const body = await readJsonBody(req);
    const payload = body?.payload;
    if (!payload || typeof payload !== "object") {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "payload required" }));
      return;
    }

    if (payload.kind !== "prophecy") {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "kind must be prophecy" }));
      return;
    }

    if (!payload.text || !payload.userPhiKey || !payload.kaiSignature || !payload.canonicalHash) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "missing required fields" }));
      return;
    }

    if (!payload.zk || !payload.zk.proof || !payload.zk.publicInputs) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "missing zk bundle" }));
      return;
    }

    const svg = buildProphecySvg(payload);
    const svgHash = crypto.createHash("sha256").update(svg).digest("hex");

    const sigilId = payload.prophecyId || `prophecy_${svgHash.slice(0, 32)}`;
    const url = `/sigils/${sigilId}.svg`;

    saveSigil(sigilId, { svg, svgHash, payload, createdAt: Date.now() });

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ sigilId, svg, svgHash, canonicalHash: payload.canonicalHash, url }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "seal failed";
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: message }));
  }
}

export const config = {
  runtime: "nodejs",
};
