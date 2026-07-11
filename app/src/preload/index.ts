import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AssetRecord, Group, ImportManifest, SearchResponse, TasteProfile, TasteRule } from "@keeper/schema";

// Result-shape mirrors for what main returns. Main and preload deliberately
// don't share a types module (only @keeper/schema types cross the boundary).
export interface AppSettings {
  hwDecode: boolean;
  libraryDir?: string;
  agentModel: string;
  agentApiKey?: string;
  reasoningEffort: "low" | "medium" | "high";
  aiBudget: number;
  autoJudge: boolean;
}

export interface OkResult {
  ok: boolean;
  error?: string;
}

export interface ServiceResult<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

export interface ScriptResult {
  ok: boolean;
  output?: string;
  error?: string;
}

export interface LibraryInfo {
  ok: boolean;
  home: string;
  exists: boolean;
}

export interface LibrarySummary {
  home: string;
  counts: {
    total: number;
    photos: number;
    videos: number;
    picks: number;
    rejects: number;
    unrated: number;
    suggested: number;
    bytes: number;
  };
  imports: ImportManifest[];
  embeddings: number;
  modelCached: boolean;
}

export interface DayBucket {
  day: string;
  count: number;
}

export interface ReviewQueues {
  "sure-reject": AssetRecord[];
  "sure-keep": AssetRecord[];
  "needs-eye": AssetRecord[];
}

export interface JudgeInfo {
  ok: boolean;
  provider: string;
  model: string;
  configured: boolean;
  budget: number;
  autoJudge: boolean;
  modelLocked: boolean;
  keyLocked: boolean;
}

export interface RejectsSummary {
  count: number;
  bytes: number;
  ids: string[];
}

export interface VerdictBefore {
  before: { id: string; user: { flag: "pick" | "reject" | "unrated"; rating: number; at?: string } }[];
}

export interface ListAssetParams {
  flag?: "pick" | "reject" | "unrated";
  mediaType?: "photo" | "video";
  minRating?: number;
  importId?: string;
  groupId?: string;
  day?: string;
  ids?: string[];
  hasAi?: boolean;
  limit?: number;
  offset?: number;
  order?: "captured_desc" | "captured_asc";
}

const api = {
  ping: (): Promise<string> => ipcRenderer.invoke("ping"),

  // Electron 32+ removed File.path; this resolves the real path of a dropped file.
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  // -- library ------------------------------------------------------------------
  getLibrary: (): Promise<LibraryInfo> => ipcRenderer.invoke("library:get"),
  librarySummary: (): Promise<ServiceResult<LibrarySummary>> => ipcRenderer.invoke("library:summary"),
  listDays: (params?: { flag?: string; mediaType?: string }): Promise<ServiceResult<DayBucket[]>> =>
    ipcRenderer.invoke("library:days", params ?? {}),
  listAssets: (params?: ListAssetParams): Promise<ServiceResult<AssetRecord[]>> =>
    ipcRenderer.invoke("library:assets", params ?? {}),
  getAssets: (ids: string[]): Promise<ServiceResult<AssetRecord[]>> =>
    ipcRenderer.invoke("library:assetsById", ids),
  revealLibrary: (): Promise<OkResult> => ipcRenderer.invoke("library:reveal"),
  pickLibrary: (): Promise<OkResult & { dir?: string; canceled?: boolean; restartRequired?: boolean }> =>
    ipcRenderer.invoke("library:pick"),

  // -- import / pipeline -----------------------------------------------------------
  pickImportPaths: (mode: "files" | "folder"): Promise<OkResult & { paths?: string[] }> =>
    ipcRenderer.invoke("import:pick", mode),
  startImport: (sources: string[]): Promise<ScriptResult> => ipcRenderer.invoke("import:start", sources),
  startReprocess: (stage?: string): Promise<ScriptResult> => ipcRenderer.invoke("reprocess:start", stage),

  // -- verdicts / review -------------------------------------------------------------
  setVerdict: (params: {
    ids: string[];
    flag?: "pick" | "reject" | "unrated";
    rating?: number;
    recordTaste?: boolean;
  }): Promise<ServiceResult<VerdictBefore>> => ipcRenderer.invoke("verdict:set", params),
  restoreVerdicts: (
    entries: { id: string; user: { flag: "pick" | "reject" | "unrated"; rating: number } }[],
  ): Promise<ServiceResult<{ restored: number }>> => ipcRenderer.invoke("verdict:restore", entries),
  getGroup: (id: string): Promise<ServiceResult<Group | null>> => ipcRenderer.invoke("group:get", id),
  setGroupPick: (params: { groupId: string; assetId: string }): Promise<ServiceResult<{ ok: boolean }>> =>
    ipcRenderer.invoke("group:pick", params),
  reviewQueues: (): Promise<ServiceResult<ReviewQueues>> => ipcRenderer.invoke("review:queues"),

  // -- search ------------------------------------------------------------------------
  search: (params: { query: string; limit?: number }): Promise<ServiceResult<SearchResponse>> =>
    ipcRenderer.invoke("search:query", params),

  // -- taste -------------------------------------------------------------------------
  getTaste: (): Promise<ServiceResult<TasteProfile>> => ipcRenderer.invoke("taste:get"),
  addTasteRule: (text: string): Promise<ServiceResult<TasteRule>> => ipcRenderer.invoke("taste:addRule", text),
  removeTasteRule: (id: string): Promise<ServiceResult<{ ok: boolean }>> =>
    ipcRenderer.invoke("taste:removeRule", id),

  // -- LLM judge -----------------------------------------------------------------------
  judgeInfo: (): Promise<JudgeInfo> => ipcRenderer.invoke("judge:info"),
  startJudge: (params?: { budget?: number }): Promise<ScriptResult> =>
    ipcRenderer.invoke("judge:start", params ?? {}),

  // -- export / trash --------------------------------------------------------------------
  pickExportDest: (): Promise<OkResult & { dest?: string; canceled?: boolean }> =>
    ipcRenderer.invoke("export:pickDest"),
  runExport: (params: { dest?: string; ids?: string[]; xmp?: boolean; inPlace?: boolean }): Promise<ScriptResult> =>
    ipcRenderer.invoke("export:run", params),
  openExportDest: (dest: string): Promise<OkResult> => ipcRenderer.invoke("export:openDest", dest),
  revealAsset: (id: string): Promise<OkResult> => ipcRenderer.invoke("asset:reveal", id),
  rejectsSummary: (): Promise<ServiceResult<RejectsSummary>> => ipcRenderer.invoke("rejects:summary"),
  emptyRejects: (ids: string[]): Promise<OkResult & { trashed?: number }> =>
    ipcRenderer.invoke("rejects:empty", ids),

  // -- settings ----------------------------------------------------------------------------
  getSettings: (): Promise<OkResult & { settings?: AppSettings }> => ipcRenderer.invoke("settings:get"),
  setSettings: (patch: Partial<AppSettings>): Promise<OkResult & { settings?: AppSettings }> =>
    ipcRenderer.invoke("settings:set", patch),

  // -- events ------------------------------------------------------------------------------
  onLibraryChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb();
    ipcRenderer.on("library:changed", listener);
    return () => ipcRenderer.removeListener("library:changed", listener);
  },
  onProgress: (prefix: string, cb: (pct: number) => void): (() => void) => {
    const listener = (_e: unknown, pct: number): void => cb(pct);
    ipcRenderer.on(`${prefix}:progress`, listener);
    return () => ipcRenderer.removeListener(`${prefix}:progress`, listener);
  },
  onPhase: (prefix: string, cb: (phase: string) => void): (() => void) => {
    const listener = (_e: unknown, phase: string): void => cb(phase);
    ipcRenderer.on(`${prefix}:phase`, listener);
    return () => ipcRenderer.removeListener(`${prefix}:phase`, listener);
  },
};

contextBridge.exposeInMainWorld("api", api);

export type KeeperApi = typeof api;
