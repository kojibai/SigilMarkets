// SigilMarkets/views/MarketGrid/MarketHeat.tsx
"use client";

import { useMemo, type CSSProperties } from "react";

type HeatVariant = "dot" | "bar" | "pulse";

export type MarketHeatProps = Readonly<{
  /**
   * 0..1 heat (clamped). Higher = hotter / more active.
   */
  heat: number;

  /**
   * Optional accessible label. If provided, the indicator becomes announceable.
   * If omitted, it stays purely decorative (aria-hidden).
   */
  label?: string;

  /**
   * Visual variant hook for CSS (still renders a <span/>).
   */
  variant?: HeatVariant;

  /**
   * Optional size in px for variants that respect it via CSS vars.
   */
  sizePx?: number;

  /**
   * Adds a native tooltip (title) showing heat % + tier label.
   * Defaults to false to preserve “silent UI” behavior.
   */
  showTooltip?: boolean;

  /**
   * If you already computed reduced-motion upstream, pass it in to disable pulsing.
   */
  prefersReduce?: boolean;

  /**
   * Extra className for layout/styling.
   */
  className?: string;
}>;

type HeatTierKey = "hot" | "warm" | "live" | "dim";

type HeatTier = Readonly<{ key: HeatTierKey; cls: string; label: string }>;

type HeatA11y =
  | Readonly<{ role: "img"; "aria-label": string }>
  | Readonly<{ "aria-hidden": true }>;

// Allow CSS custom properties without `any`.
type HeatStyle = CSSProperties & Record<`--${string}`, string>;

const clamp01 = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
};

/**
 * Smoothstep easing: 0..1 -> 0..1, continuous slope at ends.
 */
const smoothstep01 = (t: number): number => t * t * (3 - 2 * t);

const tierForHeat = (h01: number): HeatTier => {
  // Keep legacy thresholds to avoid breaking existing CSS semantics.
  if (h01 > 0.82) return { key: "hot", cls: "sm-heat is-hot", label: "Hot" };
  if (h01 > 0.58) return { key: "warm", cls: "sm-heat is-warm", label: "Warm" };
  if (h01 > 0.30) return { key: "live", cls: "sm-heat is-live", label: "Live" };
  return { key: "dim", cls: "sm-heat is-dim", label: "Dim" };
};

export function MarketHeat(props: MarketHeatProps) {
  const model = useMemo(() => {
    const h = clamp01(props.heat);
    const eased = smoothstep01(h);
    const tier = tierForHeat(h);

    // Deterministic “temperature” mapping for CSS.
    // hue: 210 (cool) -> 15 (hot)
    const hue = Math.round(210 - 195 * eased);

    // Styling knobs (strings for CSS custom properties).
    const alpha = (0.10 + 0.90 * eased).toFixed(3);
    const glow = (0.20 + 1.80 * eased).toFixed(3);
    const scale = (0.92 + 0.18 * eased).toFixed(3);

    // Hotter = faster pulse (unless reduced motion).
    const pulseMs = props.prefersReduce ? 0 : Math.round(1400 - 900 * eased);

    const variant: HeatVariant = props.variant ?? "dot";

    const cls = [
      tier.cls,
      `is-${variant}`,
      props.prefersReduce ? "is-static" : "is-animated",
      props.className ?? "",
    ]
      .filter((v) => v.length > 0)
      .join(" ");

    const pct = Math.round(h * 100);
    const title = props.showTooltip ? `${tier.label} • ${pct}%` : undefined;

    const style: HeatStyle = {
      "--sm-heat": h.toFixed(6),
      "--sm-heat-tier": tier.key,
      "--sm-heat-hue": String(hue),
      "--sm-heat-alpha": alpha,
      "--sm-heat-glow": glow,
      "--sm-heat-scale": scale,
      "--sm-heat-pulse-ms": `${pulseMs}ms`,
      ...(props.sizePx ? { "--sm-heat-size": `${props.sizePx}px` } : {}),
    };

    const a11y: HeatA11y =
      props.label && props.label.trim().length > 0
        ? { role: "img", "aria-label": `${props.label} — ${tier.label} (${pct}%)` }
        : { "aria-hidden": true };

    return {
      cls,
      style,
      title,
      dataHeat: h.toFixed(6),
      dataTier: tier.key,
      dataPct: String(pct),
      a11y,
    };
  }, [
    props.heat,
    props.label,
    props.variant,
    props.sizePx,
    props.showTooltip,
    props.prefersReduce,
    props.className,
  ]);

  return (
    <span
      className={model.cls}
      style={model.style}
      title={model.title}
      data-heat={model.dataHeat}
      data-tier={model.dataTier}
      data-pct={model.dataPct}
      {...model.a11y}
    />
  );
}
