import { contextBridge, ipcRenderer, type IpcRendererEvent, webUtils } from "electron";
import type { Benchmarks, Edl, Meta, StyleProfile } from "@reel/edl";

export interface AppSettings {
  hwDecode: boolean;
  hwEncode: boolean;
  homeDir?: string;
  exportFps: "project" | "24" | "30" | "60";
  exportResolution: "project" | "1080" | "720";
  exportCompression: "social" | "high" | "max";
  agentModel: string;
  agentApiKey?: string;
  reasoningEffort: "low" | "medium" | "high";
  elevenLabsApiKey?: string;
  defaultVoiceId?: string;
}

export interface VoiceSummary {
  id: string;
  name: string;
  category: string;
}

export interface LoadProjectResult {
  ok: boolean;
  edl?: Edl;
  errors?: string[];
  slug?: string;
  dir?: string;
  promptText?: string;
  meta?: Meta;
}

export interface ExportResult {
  ok: boolean;
  output?: string;
  error?: string;
}

export interface SaveResult {
  ok: boolean;
  error?: string;
}

export interface ProjectSummary {
  slug: string;
  title: string;
  platform: string;
  status: string;
  durationSec: number;
  assetCount: number;
  updatedAt?: string;
}

export interface CreateProjectResult {
  ok: boolean;
  slug?: string;
  error?: string;
}

export interface ImportedAsset {
  id: string;
  kind: "video" | "audio" | "image";
  src: string;
  durationSec?: number;
}

export interface ImportResult {
  ok: boolean;
  assets: ImportedAsset[];
  error?: string;
}

export interface ImportFilesResult {
  ok: boolean;
  files: string[];
  error?: string;
}

export interface StyleSummary {
  id: string;
  name: string;
  clips: number;
  analyzed: boolean;
  updatedAt?: string;
}

export interface CreateStyleResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/**
 * The safe bridge between the sandboxed renderer and the Node-capable main
 * process. Privileged operations (read project, render, reveal files) are
 * exposed here; new milestones extend this surface.
 */
const api = {
  ping: (): Promise<string> => ipcRenderer.invoke("ping"),
  listProjects: (): Promise<ProjectSummary[]> => ipcRenderer.invoke("projects:list"),
  createProject: (input: {
    title: string;
    prompt?: string;
    platform?: string;
    styleProfileId?: string;
  }): Promise<CreateProjectResult> => ipcRenderer.invoke("project:create", input),
  projectThumbnail: (slug: string): Promise<string | null> =>
    ipcRenderer.invoke("project:thumbnail", slug),
  deleteProject: (slug: string): Promise<SaveResult> => ipcRenderer.invoke("project:delete", slug),
  loadProject: (slug: string): Promise<LoadProjectResult> =>
    ipcRenderer.invoke("project:load", slug),
  watchProject: (slug: string): Promise<SaveResult> => ipcRenderer.invoke("project:watch", slug),
  saveEdl: (slug: string, edl: Edl): Promise<SaveResult> => ipcRenderer.invoke("edl:save", slug, edl),
  savePrompt: (slug: string, text: string): Promise<SaveResult> =>
    ipcRenderer.invoke("prompt:save", slug, text),
  loadMeta: (slug: string): Promise<Meta> => ipcRenderer.invoke("meta:load", slug),
  saveMeta: (slug: string, patch: Partial<Meta>): Promise<SaveResult> =>
    ipcRenderer.invoke("meta:save", slug, patch),
  // Electron 32+ removed File.path; resolve a dropped/selected File to its disk path.
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  importAssets: (slug: string, paths: string[]): Promise<ImportResult> =>
    ipcRenderer.invoke("asset:import", slug, paths),
  importAssetBuffer: (slug: string, filename: string, data: Uint8Array): Promise<ImportResult> =>
    ipcRenderer.invoke("asset:importBuffer", slug, filename, data),
  /** Fetch audio from a supported URL (SoundCloud, direct file) into assets/. */
  importAudioFromUrl: (slug: string, url: string): Promise<ImportResult> =>
    ipcRenderer.invoke("audio:fromUrl", slug, url),
  // ElevenLabs voiceover
  voicesStatus: (): Promise<{ configured: boolean; keyLocked: boolean }> => ipcRenderer.invoke("voices:status"),
  listVoices: (): Promise<{ ok: boolean; voices: VoiceSummary[]; error?: string }> =>
    ipcRenderer.invoke("voices:list"),
  cloneVoice: (input: {
    name: string;
    paths: string[];
    recording?: { name: string; data: Uint8Array };
    consent: boolean;
  }): Promise<{ ok: boolean; voiceId?: string; error?: string }> => ipcRenderer.invoke("voices:clone", input),
  deleteVoice: (id: string): Promise<SaveResult> => ipcRenderer.invoke("voices:delete", id),
  loadNarration: (slug: string): Promise<string> => ipcRenderer.invoke("narration:load", slug),
  saveNarration: (slug: string, text: string): Promise<SaveResult> => ipcRenderer.invoke("narration:save", slug, text),
  draftNarration: (slug: string): Promise<ExportResult> => ipcRenderer.invoke("narration:draft", slug),
  generateVoiceover: (slug: string, voiceId: string): Promise<ExportResult> =>
    ipcRenderer.invoke("tts:start", slug, voiceId),
  listBundledMusic: (): Promise<string[]> => ipcRenderer.invoke("music:listBundled"),
  importBundledMusic: (slug: string, name: string): Promise<ImportResult> =>
    ipcRenderer.invoke("music:importBundled", slug, name),
  importReferences: (slug: string, paths: string[]): Promise<ImportFilesResult> =>
    ipcRenderer.invoke("references:import", slug, paths),
  listReferences: (slug: string): Promise<string[]> => ipcRenderer.invoke("references:list", slug),
  removeReference: (slug: string, file: string): Promise<SaveResult> =>
    ipcRenderer.invoke("references:remove", slug, file),
  learnStyle: (slug: string): Promise<ExportResult> => ipcRenderer.invoke("style:learn", slug),
  loadStyle: (slug: string): Promise<StyleProfile | null> => ipcRenderer.invoke("style:load", slug),
  patchStyle: (slug: string, patch: Partial<StyleProfile>): Promise<SaveResult> =>
    ipcRenderer.invoke("style:patch", slug, patch),
  // Global style library
  listStyles: (): Promise<StyleSummary[]> => ipcRenderer.invoke("styles:list"),
  createStyle: (name: string): Promise<CreateStyleResult> => ipcRenderer.invoke("styles:create", name),
  newStyleFromDialog: (
    mode: "files" | "folder",
  ): Promise<{ ok: boolean; id?: string; name?: string; files?: string[]; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke("styles:newFromDialog", mode),
  addStyleSources: (id: string, mode: "files" | "folder"): Promise<ImportFilesResult> =>
    ipcRenderer.invoke("styles:addFromDialog", id, mode),
  analyzeStyle: (id: string): Promise<ExportResult> => ipcRenderer.invoke("styles:analyze", id),
  getStyle: (id: string): Promise<StyleProfile | null> => ipcRenderer.invoke("styles:get", id),
  deleteStyle: (id: string): Promise<SaveResult> => ipcRenderer.invoke("styles:delete", id),
  importBenchmarks: (slug: string, paths: string[]): Promise<ImportFilesResult> =>
    ipcRenderer.invoke("benchmark:import", slug, paths),
  listBenchmarks: (slug: string): Promise<{ file: string; views?: number; likes?: number }[]> =>
    ipcRenderer.invoke("benchmark:list", slug),
  saveBenchmarkMetrics: (
    slug: string,
    file: string,
    metrics: { views?: number; likes?: number },
  ): Promise<SaveResult> => ipcRenderer.invoke("benchmark:saveMetrics", slug, file, metrics),
  analyzeBenchmarks: (slug: string): Promise<ExportResult> => ipcRenderer.invoke("benchmarks:analyze", slug),
  loadBenchmarks: (slug: string): Promise<Benchmarks | null> => ipcRenderer.invoke("benchmarks:load", slug),
  autoTune: (slug: string): Promise<ExportResult> => ipcRenderer.invoke("autotune:start", slug),
  autoTuneResults: (slug: string): Promise<{ iter: number; score: number; delta: string; change: string }[]> =>
    ipcRenderer.invoke("autotune:results", slug),
  exportProject: (slug: string): Promise<ExportResult> => ipcRenderer.invoke("export:start", slug),
  generateProject: (slug: string): Promise<ExportResult> => ipcRenderer.invoke("generate:start", slug),
  generateMode: (): Promise<{
    mode: "llm" | "baseline";
    provider: string;
    model: string;
    modelLocked: boolean;
    keyLocked: boolean;
  }> => ipcRenderer.invoke("generate:mode"),
  transcribeProject: (slug: string): Promise<ExportResult> => ipcRenderer.invoke("transcribe:start", slug),
  loadCritique: (slug: string): Promise<unknown> => ipcRenderer.invoke("critique:load", slug),
  runCritique: (slug: string): Promise<ExportResult> => ipcRenderer.invoke("critique:run", slug),
  revealItem: (filePath: string): Promise<void> => ipcRenderer.invoke("shell:reveal", filePath),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke("settings:get"),
  setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke("settings:set", patch),
  getProjectsDir: (): Promise<string> => ipcRenderer.invoke("home:get"),
  revealProjectsDir: (): Promise<string> => ipcRenderer.invoke("home:reveal"),
  pickProjectsDir: (): Promise<{ ok: boolean; homeDir?: string; canceled?: boolean }> =>
    ipcRenderer.invoke("home:pick"),
  onExportProgress: (cb: (pct: number) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, pct: number) => cb(pct);
    ipcRenderer.on("export:progress", listener);
    return () => ipcRenderer.removeListener("export:progress", listener);
  },
  onExportPhase: (cb: (phase: string) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, phase: string) => cb(phase);
    ipcRenderer.on("export:phase", listener);
    return () => ipcRenderer.removeListener("export:phase", listener);
  },
  onProjectChanged: (cb: (slug: string) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, slug: string) => cb(slug);
    ipcRenderer.on("project:changed", listener);
    return () => ipcRenderer.removeListener("project:changed", listener);
  },
  // Generic streamed-progress subscriptions for any script channel prefix
  // (e.g. "style", "benchmarks", "autotune"). Mirrors the script PHASE/PROGRESS
  // protocol the main process parses.
  onProgress: (prefix: string, cb: (pct: number) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, pct: number) => cb(pct);
    ipcRenderer.on(`${prefix}:progress`, listener);
    return () => ipcRenderer.removeListener(`${prefix}:progress`, listener);
  },
  onPhase: (prefix: string, cb: (phase: string) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, phase: string) => cb(phase);
    ipcRenderer.on(`${prefix}:phase`, listener);
    return () => ipcRenderer.removeListener(`${prefix}:phase`, listener);
  },
};

contextBridge.exposeInMainWorld("api", api);

export type ReelApi = typeof api;
