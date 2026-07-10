import type { CSSProperties } from "react";
import { Easing, interpolate } from "remotion";

/**
 * Port of the `animate-text` catalog (from Claudia). Each spec is an abstract,
 * stack-agnostic motion contract; `unitStyle` turns it into a Remotion style
 * for one animated unit (whole / character / word / line) at a given frame.
 *
 * Starter set for V1 — extend by adding entries here (or porting more of the
 * original JSON specs).
 */
export type AnimTarget = "whole" | "per-character" | "per-word" | "per-line";

export interface AnimSpec {
  target: AnimTarget;
  durationMs: number;
  staggerMs: number;
  easing: [number, number, number, number];
  from: { opacity?: number; y?: number; blur?: number; scale?: number };
}

const EASE_OUT_EXPO: [number, number, number, number] = [0.22, 1, 0.36, 1];
const EASE_OUT_CUBIC: [number, number, number, number] = [0.33, 1, 0.68, 1];
const EASE_OUT_BACK: [number, number, number, number] = [0.34, 1.56, 0.64, 1];

export const ANIM_SPECS: Record<string, AnimSpec> = {
  "soft-blur-in": {
    target: "per-character",
    durationMs: 900,
    staggerMs: 25,
    easing: EASE_OUT_EXPO,
    from: { opacity: 0, y: 16, blur: 12 },
  },
  "per-character-rise": {
    target: "per-character",
    durationMs: 600,
    staggerMs: 22,
    easing: EASE_OUT_CUBIC,
    from: { opacity: 0, y: 30 },
  },
  "per-word-crossfade": {
    target: "per-word",
    durationMs: 700,
    staggerMs: 120,
    easing: EASE_OUT_EXPO,
    from: { opacity: 0, y: 14 },
  },
  "spring-scale-in": {
    target: "per-word",
    durationMs: 650,
    staggerMs: 90,
    easing: EASE_OUT_BACK,
    from: { opacity: 0, scale: 0.7 },
  },
  "mask-reveal-up": {
    target: "per-line",
    durationMs: 700,
    staggerMs: 120,
    easing: EASE_OUT_EXPO,
    from: { opacity: 0, y: 40 },
  },
  "blur-out-up": {
    target: "per-word",
    durationMs: 600,
    staggerMs: 60,
    easing: EASE_OUT_EXPO,
    from: { opacity: 0, y: 10, blur: 6 },
  },
  "scale-down-fade": {
    target: "whole",
    durationMs: 700,
    staggerMs: 0,
    easing: EASE_OUT_EXPO,
    from: { opacity: 0, scale: 1.08 },
  },
  typewriter: {
    target: "per-character",
    durationMs: 1,
    staggerMs: 45,
    easing: EASE_OUT_CUBIC,
    from: { opacity: 0 },
  },
};

export function getSpec(name: string | undefined): AnimSpec {
  return (name && ANIM_SPECS[name]) || ANIM_SPECS["soft-blur-in"];
}

export function splitUnits(text: string, target: AnimTarget): string[] {
  switch (target) {
    case "per-character":
      return [...text];
    case "per-word":
      return text.split(/(\s+)/);
    case "per-line":
      return text.split("\n");
    default:
      return [text];
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function unitStyle(spec: AnimSpec, frame: number, fps: number, index: number): CSSProperties {
  const delay = (index * spec.staggerMs) / 1000 * fps;
  const dur = Math.max(1, (spec.durationMs / 1000) * fps);
  const p = interpolate(frame, [delay, delay + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(spec.easing[0], spec.easing[1], spec.easing[2], spec.easing[3]),
  });

  const opacity = lerp(spec.from.opacity ?? 1, 1, p);
  const y = lerp(spec.from.y ?? 0, 0, p);
  const blur = lerp(spec.from.blur ?? 0, 0, p);
  const scale = lerp(spec.from.scale ?? 1, 1, p);

  const style: CSSProperties = {
    opacity,
    transform: `translateY(${y}px) scale(${scale})`,
  };
  if (blur > 0.1) style.filter = `blur(${blur}px)`;
  return style;
}
