import { describe, expect, it } from "vitest";
import { getSpec, splitUnits, unitStyle } from "./animations";

describe("getSpec", () => {
  it("falls back to soft-blur-in for unknown/undefined names", () => {
    expect(getSpec(undefined).target).toBe("per-character");
    expect(getSpec("does-not-exist")).toBe(getSpec("soft-blur-in"));
  });

  it("returns the requested spec", () => {
    expect(getSpec("typewriter").target).toBe("per-character");
  });
});

describe("splitUnits", () => {
  it("splits per target", () => {
    expect(splitUnits("ab", "per-character")).toEqual(["a", "b"]);
    expect(splitUnits("a b", "per-word")).toEqual(["a", " ", "b"]);
    expect(splitUnits("x\ny", "per-line")).toEqual(["x", "y"]);
    expect(splitUnits("hi", "whole")).toEqual(["hi"]);
  });
});

describe("unitStyle", () => {
  it("animates opacity from 0 toward 1 over time", () => {
    const spec = getSpec("per-character-rise"); // from.opacity 0
    const start = unitStyle(spec, 0, 30, 0).opacity as number;
    const end = unitStyle(spec, 120, 30, 0).opacity as number;
    expect(start).toBeLessThan(0.2);
    expect(end).toBeCloseTo(1, 1);
  });
});
