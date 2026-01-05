import { loadSigil } from "./store.js";

const readId = (req) => {
  const host = req.headers?.host ?? "localhost";
  const url = new URL(req.url ?? "", `http://${host}`);
  const parts = url.pathname.split("/");
  const raw = parts[parts.length - 1] || "";
  return raw.endsWith(".svg") ? raw.slice(0, -4) : raw;
};

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "method not allowed" }));
    return;
  }

  const id = readId(req);
  if (!id) {
    res.statusCode = 400;
    res.end("bad request");
    return;
  }

  const entry = loadSigil(id);
  if (!entry) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.end(entry.svg);
}

export const config = {
  runtime: "nodejs",
};
