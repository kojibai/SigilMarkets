// SigilMarkets/views/MarketRoom/MarketChart.tsx
"use client";

/**
 * MarketChart (MVP)
 *
 * A lightweight, addictive sparkline that feels live:
 * - No external chart libraries.
 * - Uses canvas for performance.
 * - In MVP, derives a pseudo-series from current price + pulse for "alive" motion
 *   when real historical series is not provided.
 *
 * Later, wire to your real KaiPriceChart/buildExchangeSeries style feed.
 */

import React, { useEffect, useMemo, useRef } from "react";
import type { KaiMoment, PriceMicro } from "../../types/marketTypes";
import { formatPriceMicro } from "../../utils/format";

export type MarketChartProps = Readonly<{
  now: KaiMoment;

  /** YES price is primary (NO derived). */
  yesPriceMicro: PriceMicro;

  /** Optional historical series of YES prices (micro), oldest -> newest. */
  seriesYesMicro?: readonly PriceMicro[];

  /** Height in px (default 160). */
  height?: number;
}>;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

const makeFallbackSeries = (nowPulse: number, yesPriceMicro: PriceMicro, points = 64): readonly number[] => {
  const p = Number(yesPriceMicro);
  const base = clamp01(p / 1_000_000);
  const out: number[] = [];

  // deterministic wobble based on pulse
  for (let i = 0; i < points; i += 1) {
    const t = (nowPulse - (points - 1 - i)) * 0.17;
    const wobble = Math.sin(t) * 0.02 + Math.sin(t * 0.47) * 0.01;
    const drift = Math.sin((nowPulse * 0.01 + i * 0.03)) * 0.005;
    out.push(clamp01(base + wobble + drift));
  }
  return out;
};

export const MarketChart = (props: MarketChartProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const height = props.height ?? 160;

  const series = useMemo(() => {
    if (props.seriesYesMicro && props.seriesYesMicro.length >= 8) {
      return props.seriesYesMicro.map((x) => clamp01(Number(x) / 1_000_000));
    }
    return makeFallbackSeries(props.now.pulse, props.yesPriceMicro, 72);
  }, [props.seriesYesMicro, props.now.pulse, props.yesPriceMicro]);

  const label = useMemo(() => formatPriceMicro(props.yesPriceMicro, { mode: "cents", decimals: 0 }), [props.yesPriceMicro]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;

    const dpr = typeof window !== "undefined" ? Math.max(1, Math.floor(window.devicePixelRatio || 1)) : 1;
    const w = c.clientWidth;
    const h = height;

    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);

    const ctx = c.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);

    // Clear (transparent; CSS handles background)
    ctx.clearRect(0, 0, w, h);

    // Track line
    ctx.beginPath();
    const n = series.length;

    const pad = 10;
    const innerW = w - pad * 2;
    const innerH = h - pad * 2;

    // min/max for normalization (zoom a bit to feel alive)
    const min = Math.max(0, Math.min(...series) - 0.02);
    const max = Math.min(1, Math.max(...series) + 0.02);
    const span = Math.max(0.0001, max - min);

    const xAt = (i: number): number => pad + (i / (n - 1)) * innerW;
    const yAt = (v: number): number => pad + (1 - (v - min) / span) * innerH;

    for (let i = 0; i < n; i += 1) {
      const x = xAt(i);
      const y = yAt(series[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    // Stroke style (no explicit colors; use white with alpha so theme drives it)
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.72)";
    ctx.stroke();

    // Glow pass
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(191,252,255,0.18)";
    ctx.stroke();

    // Current dot
    const lastX = xAt(n - 1);
    const lastY = yAt(series[n - 1]);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(191,252,255,0.85)";
    ctx.fill();

    // baseline
    ctx.beginPath();
    ctx.moveTo(pad, pad + innerH);
    ctx.lineTo(pad + innerW, pad + innerH);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.stroke();
  }, [series, height]);

  return (
    <div className="sm-chart" data-sm="chart">
      <div className="sm-chart-head">
        <div className="sm-chart-title">Live odds</div>
        <div className="sm-chart-right">
          <span className="sm-chart-pill">YES {label}</span>
          <span className="sm-chart-pill dim">pulse {props.now.pulse}</span>
        </div>
      </div>
      <div className="sm-chart-canvas-wrap">
        <canvas ref={canvasRef} className="sm-chart-canvas" style={{ height }} />
      </div>
    </div>
  );
};
