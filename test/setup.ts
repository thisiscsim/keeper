import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// A default window.api stub so renderer components/stores don't blow up on
// window.api?.* calls. Functions are memoized per name so tests can assert on
// stable references (e.g. expect(window.api.setVerdict).toHaveBeenCalled()).
const SERVICE_LIST_RETURNING = new Set(["listDays", "listAssets", "getAssets"]);
const SUBSCRIPTIONS = new Set(["onProgress", "onPhase", "onLibraryChanged"]);

function makeFn(prop: string) {
  if (prop === "getPathForFile") return vi.fn(() => "");
  if (SUBSCRIPTIONS.has(prop)) return vi.fn(() => () => {});
  if (SERVICE_LIST_RETURNING.has(prop)) return vi.fn(async () => ({ ok: true, result: [] }));
  if (prop === "getLibrary") return vi.fn(async () => ({ ok: true, home: "/tmp/keeper", exists: true }));
  if (prop === "librarySummary")
    return vi.fn(async () => ({
      ok: true,
      result: {
        home: "/tmp/keeper",
        counts: { total: 0, photos: 0, videos: 0, picks: 0, rejects: 0, unrated: 0, suggested: 0, bytes: 0 },
        imports: [],
        embeddings: 0,
        modelCached: false,
      },
    }));
  if (prop === "reviewQueues")
    return vi.fn(async () => ({
      ok: true,
      result: { "sure-reject": [], "sure-keep": [], "needs-eye": [] },
    }));
  if (prop === "search")
    return vi.fn(async () => ({ ok: true, result: { query: "", mode: "metadata", results: [] } }));
  if (prop === "setVerdict") return vi.fn(async () => ({ ok: true, result: { before: [] } }));
  if (prop === "restoreVerdicts") return vi.fn(async () => ({ ok: true, result: { restored: 0 } }));
  if (prop === "judgeInfo")
    return vi.fn(async () => ({
      ok: true,
      provider: "openai",
      model: "gpt-5.5",
      configured: false,
      budget: 200,
      autoJudge: false,
      modelLocked: false,
      keyLocked: false,
    }));
  if (prop === "getSettings")
    return vi.fn(async () => ({
      ok: true,
      settings: { hwDecode: false, agentModel: "gpt-5.5", reasoningEffort: "low", aiBudget: 200, autoJudge: false },
    }));
  if (prop === "getTaste")
    return vi.fn(async () => ({
      ok: true,
      result: { version: 1, thresholds: {}, rules: [], exemplars: [], stats: {} },
    }));
  return vi.fn(async () => ({ ok: true }));
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
