// SigilMarkets/hooks/useSfx.ts
"use client";

/**
 * SigilMarkets — useSfx
 *
 * UX goal:
 * - Micro-sounds that feel "alive" and Kai-bound.
 * - Never blast audio: respect user toggles, reduce-motion intent, and autoplay rules.
 *
 * Implementation:
 * - Uses WebAudio (AudioContext + oscillator envelopes).
 * - No external audio assets required.
 * - Callers should keep SFX sparse and meaningful.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSigilMarketsUi } from "../state/uiStore";

export type SfxKind =
  | "tap"
  | "toggle"
  | "tick"
  | "lock"
  | "mint"
  | "win"
  | "loss"
  | "resolve"
  | "error";

type AudioLike = AudioContext | null;

const getAudioContext = (): AudioLike => {
  try {
    const g = globalThis as unknown as Record<string, unknown>;
    const AC = (g["AudioContext"] ?? g["webkitAudioContext"]) as unknown;
    if (typeof AC !== "function") return null;
    return new (AC as { new (): AudioContext })();
  } catch {
    return null;
  }
};

type Env = Readonly<{
  freqHz: number;
  durMs: number;
  gain: number;
  type: OscillatorType;
  attackMs: number;
  releaseMs: number;
}>;

const envFor = (kind: SfxKind): readonly Env[] => {
  // Keep it subtle, short, and “breath-like”.
  switch (kind) {
    case "tap":
      return [{ freqHz: 420, durMs: 32, gain: 0.05, type: "sine", attackMs: 2, releaseMs: 18 }];
    case "toggle":
      return [{ freqHz: 520, durMs: 46, gain: 0.06, type: "triangle", attackMs: 3, releaseMs: 22 }];
    case "tick":
      return [{ freqHz: 880, durMs: 18, gain: 0.03, type: "sine", attackMs: 1, releaseMs: 10 }];
    case "lock":
      return [
        { freqHz: 392, durMs: 70, gain: 0.06, type: "sine", attackMs: 4, releaseMs: 35 },
        { freqHz: 588, durMs: 55, gain: 0.05, type: "sine", attackMs: 3, releaseMs: 30 },
      ];
    case "mint":
      return [
        { freqHz: 528, durMs: 80, gain: 0.06, type: "triangle", attackMs: 4, releaseMs: 42 },
        { freqHz: 792, durMs: 64, gain: 0.05, type: "sine", attackMs: 3, releaseMs: 34 },
      ];
    case "win":
      return [
        { freqHz: 528, durMs: 90, gain: 0.07, type: "sine", attackMs: 4, releaseMs: 48 },
        { freqHz: 660, durMs: 90, gain: 0.06, type: "sine", attackMs: 4, releaseMs: 48 },
        { freqHz: 792, durMs: 110, gain: 0.05, type: "sine", attackMs: 4, releaseMs: 58 },
      ];
    case "loss":
      return [
        { freqHz: 220, durMs: 120, gain: 0.06, type: "sine", attackMs: 6, releaseMs: 70 },
        { freqHz: 196, durMs: 120, gain: 0.05, type: "triangle", attackMs: 6, releaseMs: 70 },
      ];
    case "resolve":
      return [
        { freqHz: 440, durMs: 70, gain: 0.05, type: "sine", attackMs: 4, releaseMs: 35 },
        { freqHz: 660, durMs: 70, gain: 0.05, type: "sine", attackMs: 4, releaseMs: 35 },
      ];
    case "error":
      return [{ freqHz: 160, durMs: 140, gain: 0.07, type: "square", attackMs: 3, releaseMs: 90 }];
    default: {
      // exhaustive
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _never: never = kind;
      return [{ freqHz: 420, durMs: 32, gain: 0.05, type: "sine", attackMs: 2, releaseMs: 18 }];
    }
  }
};

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

export type UseSfx = Readonly<{
  supported: boolean;
  enabled: boolean;
  /** Ensure audio is unlocked (call on first user gesture). */
  unlock: () => void;
  play: (kind: SfxKind) => void;
}>;

export const useSfx = (): UseSfx => {
  const { state } = useSigilMarketsUi();
  const enabled = state.sfxEnabled && !state.motion.reduceMotion; // reduce-motion implies "less sensory"
  const ctxRef = useRef<AudioLike>(null);
  const unlockedRef = useRef<boolean>(false);

  const supported = useMemo(() => {
    const ctx = getAudioContext();
    if (!ctx) return false;
    // Close probe context to avoid leaks
    try {
      void ctx.close();
    } catch {
      // ignore
    }
    return true;
  }, []);

  const ensureCtx = useCallback((): AudioContext | null => {
    if (!supported) return null;
    if (ctxRef.current) return ctxRef.current;
    const ctx = getAudioContext();
    ctxRef.current = ctx;
    return ctx;
  }, [supported]);

  const unlock = useCallback(() => {
    const ctx = ensureCtx();
    if (!ctx) return;
    if (unlockedRef.current) return;

    // Resume context on user gesture (autoplay policy)
    try {
      if (ctx.state === "suspended") void ctx.resume();
      unlockedRef.current = true;
    } catch {
      // ignore
    }
  }, [ensureCtx]);

  const play = useCallback(
    (kind: SfxKind) => {
      if (!enabled) return;

      const ctx = ensureCtx();
      if (!ctx) return;

      // Best effort resume if suspended (still requires gesture in many browsers)
      try {
        if (ctx.state === "suspended") void ctx.resume();
      } catch {
        // ignore
      }

      const now = ctx.currentTime;
      const envs = envFor(kind);

      for (let i = 0; i < envs.length; i += 1) {
        const e = envs[i];

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = e.type;
        osc.frequency.setValueAtTime(e.freqHz, now);

        const g0 = 0.0001;
        const peak = clamp(e.gain, 0, 0.2);

        const attack = clamp(e.attackMs, 0, 200) / 1000;
        const release = clamp(e.releaseMs, 0, 500) / 1000;
        const dur = clamp(e.durMs, 8, 500) / 1000;

        gain.gain.setValueAtTime(g0, now);
        gain.gain.linearRampToValueAtTime(peak, now + attack);
        gain.gain.linearRampToValueAtTime(g0, now + attack + dur + release);

        osc.connect(gain);
        gain.connect(ctx.destination);

        try {
          osc.start(now);
          osc.stop(now + attack + dur + release + 0.02);
        } catch {
          // ignore
        }
      }
    },
    [enabled, ensureCtx],
  );

  // Cleanup
  useEffect(() => {
    return () => {
      const ctx = ctxRef.current;
      ctxRef.current = null;
      if (!ctx) return;
      try {
        void ctx.close();
      } catch {
        // ignore
      }
    };
  }, []);

  return { supported, enabled, unlock, play };
};
