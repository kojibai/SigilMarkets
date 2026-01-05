// src/pages/SigilSvgRoute.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { SM_PROPHECY_SIGILS_KEY } from "../SigilMarkets/state/persistence";

const readSvgFromStorage = (sigilId: string): string | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SM_PROPHECY_SIGILS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      data?: {
        propheciesById?: Record<string, { sigil?: { sigilId?: string; svg?: string } }>;
      };
    };
    const byId = parsed?.data?.propheciesById;
    if (!byId) return null;

    for (const rec of Object.values(byId)) {
      const sigil = rec?.sigil;
      if (sigil?.sigilId === sigilId && typeof sigil.svg === "string") return sigil.svg;
    }
    return null;
  } catch {
    return null;
  }
};

export default function SigilSvgRoute(): JSX.Element {
  const params = useParams();
  const sigilId = params.id ?? "";
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    if (!sigilId) return;
    const stored = readSvgFromStorage(sigilId);
    setSvg(stored);
  }, [sigilId]);

  if (!sigilId) {
    return <div>Missing sigil id.</div>;
  }

  if (!svg) {
    return <div>Sigil not found.</div>;
  }

  return <div className="sm-sigil-raw" dangerouslySetInnerHTML={{ __html: svg }} />;
}
