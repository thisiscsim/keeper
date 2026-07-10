import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// A default window.api stub so renderer components/stores don't blow up on
// window.api?.* calls. Functions are memoized per name so tests can assert on
// stable references (e.g. expect(window.api.saveEdl).toHaveBeenCalled()).
const ARRAY_RETURNING = new Set([
  "listProjects",
  "listBundledMusic",
  "listReferences",
  "listStyles",
  "listBenchmarks",
  "autoTuneResults",
]);
const SUBSCRIPTIONS = new Set([
  "onProgress",
  "onPhase",
  "onProjectChanged",
  "onExportProgress",
  "onExportPhase",
]);

function makeFn(prop: string) {
  if (prop === "getPathForFile") return vi.fn(() => "");
  if (SUBSCRIPTIONS.has(prop)) return vi.fn(() => () => {});
  if (prop === "generateMode")
    return vi.fn(async () => ({ mode: "baseline", provider: "openai", model: "gpt-5.5" }));
  if (prop === "loadMeta") return vi.fn(async () => ({}));
  if (ARRAY_RETURNING.has(prop)) return vi.fn(async () => []);
  return vi.fn(async () => null);
}

const cache = new Map<string, unknown>();
const apiStub = new Proxy(
  {},
  {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      if (!cache.has(prop)) cache.set(prop, makeFn(prop));
      return cache.get(prop);
    },
  },
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window.api = apiStub;
