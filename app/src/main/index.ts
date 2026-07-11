import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import {
  createReadStream,
  existsSync,
  type FSWatcher,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, normalize, sep } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, nativeImage, protocol, shell } from "electron";

// In dev (electron-vite) __dirname is <repo>/app/out/main, so the repo root is
// three levels up. Allow an override for packaged/other layouts.
const REPO_ROOT = process.env["KEEPER_ROOT"] ?? join(__dirname, "..", "..", "..");
const ICON_PATH = join(REPO_ROOT, "app", "resources", "icon.png");
const SCRIPTS_DIR = join(REPO_ROOT, "app", "scripts");
const IMPORT_SCRIPT = join(SCRIPTS_DIR, "import.mjs");
const REPROCESS_SCRIPT = join(SCRIPTS_DIR, "reprocess.mjs");
const JUDGE_SCRIPT = join(SCRIPTS_DIR, "judge-llm.mjs");
const EXPORT_SCRIPT = join(SCRIPTS_DIR, "export.mjs");
const CATALOG_SERVICE_SCRIPT = join(SCRIPTS_DIR, "catalog-service.mjs");

// Captured so dialogs can parent to the window.
let mainWindow: BrowserWindow | null = null;

// The macOS menu bar / dock tooltip / About panel use app.name, which defaults
// to "Electron" in dev. Set it before the default menu is built.
app.setName("Keeper");

// Load a local, gitignored env file (KEY=VALUE) so secrets like OPENAI_API_KEY
// can live on disk instead of being exported into the launching shell. Existing
// process env always wins. Runs at startup so spawned scripts inherit it.
function loadLocalEnv(): void {
  for (const file of [join(REPO_ROOT, "app", ".env.local"), join(REPO_ROOT, ".env.local")]) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m || line.trimStart().startsWith("#")) continue;
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = val;
    }
  }
}
loadLocalEnv();

// ---- Persistent app settings ------------------------------------------------
export type ReasoningEffort = "low" | "medium" | "high";
interface AppSettings {
  /** Hardware-accelerated video decode (Chromium switch; needs restart). */
  hwDecode: boolean;
  /** User-chosen library root (default ~/Pictures/Keeper). Applies on restart. */
  libraryDir?: string;
  /** AI preferences (env vars from .env.local always win). */
  agentModel: string;
  agentApiKey?: string;
  reasoningEffort: ReasoningEffort;
  /** Max items the LLM judge may analyze per run. */
  aiBudget: number;
  /** Run the LLM judge automatically after each import. */
  autoJudge: boolean;
}
const SETTINGS_PATH = join(app.getPath("userData"), "settings.json");
function readSettings(): AppSettings {
  let s: Record<string, unknown> = {};
  try {
    s = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
  } catch {
    // fresh install
  }
  const oneOf = <T extends string>(v: unknown, options: readonly T[], dflt: T): T =>
    typeof v === "string" && (options as readonly string[]).includes(v) ? (v as T) : dflt;
  return {
    hwDecode: Boolean(s.hwDecode),
    libraryDir: typeof s.libraryDir === "string" && s.libraryDir ? s.libraryDir : undefined,
    agentModel: typeof s.agentModel === "string" && s.agentModel ? s.agentModel : "gpt-5.5",
    agentApiKey: typeof s.agentApiKey === "string" && s.agentApiKey ? s.agentApiKey : undefined,
    reasoningEffort: oneOf(s.reasoningEffort, ["low", "medium", "high"] as const, "low"),
    aiBudget:
      typeof s.aiBudget === "number" && Number.isFinite(s.aiBudget) && s.aiBudget > 0
        ? Math.min(5000, Math.round(s.aiBudget))
        : 200,
    autoJudge: Boolean(s.autoJudge),
  };
}
function writeSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...readSettings(), ...patch };
  try {
    writeFileSync(SETTINGS_PATH, `${JSON.stringify(next, null, 2)}\n`);
  } catch {
    // best-effort
  }
  applyAgentEnv(next);
  return next;
}

// AI preferences flow to the LLM layer via the same env vars .env.local uses.
// Anything explicitly set in the environment (shell or .env.local) stays
// authoritative; settings only fill the gaps. `envLocked` is captured once at
// startup, before the first injection.
const envLocked = {
  provider: "KEEPER_LLM_PROVIDER" in process.env,
  model: "KEEPER_LLM_MODEL" in process.env,
  apiKey: Boolean(
    process.env["KEEPER_LLM_API_KEY"] || process.env["OPENAI_API_KEY"] || process.env["ANTHROPIC_API_KEY"],
  ),
  effort: "KEEPER_REASONING_EFFORT" in process.env,
};
function applyAgentEnv(s: AppSettings): void {
  if (!envLocked.model) {
    process.env["KEEPER_LLM_MODEL"] = s.agentModel;
    if (!envLocked.provider) {
      process.env["KEEPER_LLM_PROVIDER"] = s.agentModel.startsWith("claude") ? "anthropic" : "openai";
    }
  }
  if (!envLocked.apiKey) {
    if (s.agentApiKey) process.env["KEEPER_LLM_API_KEY"] = s.agentApiKey;
    else delete process.env["KEEPER_LLM_API_KEY"];
  }
  if (!envLocked.effort) process.env["KEEPER_REASONING_EFFORT"] = s.reasoningEffort;
  process.env["KEEPER_AI_BUDGET"] = String(s.aiBudget);
}
applyAgentEnv(readSettings());

// Provider-agnostic LLM config (mirrors app/scripts/llm.mjs) so the UI can show
// the active model and the judge can refuse cleanly when unconfigured.
function llmInfo(): { provider: string; model: string; configured: boolean } {
  const provider = (process.env["KEEPER_LLM_PROVIDER"] || "openai").toLowerCase();
  const model = process.env["KEEPER_LLM_MODEL"] || "gpt-5.5";
  const baseURL = process.env["KEEPER_LLM_BASE_URL"];
  const apiKey =
    process.env["KEEPER_LLM_API_KEY"] ||
    (provider === "anthropic" ? process.env["ANTHROPIC_API_KEY"] : process.env["OPENAI_API_KEY"]) ||
    process.env["OPENAI_API_KEY"] ||
    process.env["ANTHROPIC_API_KEY"];
  const configured = provider === "openai-compatible" ? Boolean(baseURL || apiKey) : Boolean(apiKey);
  return { provider, model, configured };
}

// User-owned storage: the library lives under the user's home folder, never the
// repo/app bundle. Resolution: env override (dev) -> user-picked folder
// (settings) -> ~/Pictures/Keeper. Resolved once at startup.
const LIBRARY_HOME =
  process.env["KEEPER_LIBRARY_DIR"] ?? readSettings().libraryDir ?? join(homedir(), "Pictures", "Keeper");
try {
  mkdirSync(join(LIBRARY_HOME, "library"), { recursive: true });
  mkdirSync(join(LIBRARY_HOME, ".keeper"), { recursive: true });
} catch {
  // directories are best-effort at startup
}
// Spawned scripts (import/judge/export/...) inherit this to find the same library.
process.env["KEEPER_LIBRARY_DIR"] = LIBRARY_HOME;

/** Resolve + guard a library-relative path so it can never escape the home. */
function safeHomePath(...rel: string[]): string {
  const base = normalize(LIBRARY_HOME);
  const file = normalize(join(base, ...rel));
  // Compare against root + separator so a sibling like "<root>-evil" can't pass.
  if (file !== base && !file.startsWith(base + sep)) throw new Error("path escapes library");
  return file;
}

// Hardware-accelerated video decode (playback) is a Chromium switch that must be
// set before the app is ready, so toggling it needs a restart.
if (readSettings().hwDecode) {
  app.commandLine.appendSwitch("ignore-gpu-blocklist");
  app.commandLine.appendSwitch("enable-features", "PlatformHEVCDecoderSupport");
}

// Serve library media to the sandboxed renderer (it can't read file:// from an
// http origin). keeper-asset://home/<relPath> -> <LIBRARY_HOME>/<relPath>
protocol.registerSchemesAsPrivileged([
  {
    scheme: "keeper-asset",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
  },
]);

function mimeFor(file: string): string {
  const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".mp4":
    case ".m4v":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    case ".mkv":
      return "video/x-matroska";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".heic":
    case ".heif":
      return "image/heic";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    default:
      return "application/octet-stream";
  }
}

// ---- Catalog service (child Node process owning the SQLite catalog) ----------
// Keeps the native-free main process out of DB concerns and heavy queries off
// the UI event loop. Line-delimited JSON-RPC over stdio; lazily (re)spawned.
interface ServiceRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

let service: ChildProcessWithoutNullStreams | null = null;
let serviceSeq = 0;
const servicePending = new Map<number, ServiceRequest>();
let quitting = false;

function startService(): ChildProcessWithoutNullStreams {
  const child = spawn("node", [CATALOG_SERVICE_SCRIPT, "--library", LIBRARY_HOME], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    let msg: { id?: number; ok?: boolean; result?: unknown; error?: string };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof msg.id !== "number") return; // readiness banner or notification
    const pending = servicePending.get(msg.id);
    if (!pending) return;
    servicePending.delete(msg.id);
    clearTimeout(pending.timer);
    if (msg.ok) pending.resolve(msg.result);
    else pending.reject(new Error(msg.error ?? "catalog service error"));
  });
  child.stderr.on("data", (chunk: Buffer) => {
    console.error(`[catalog-service] ${chunk.toString().trim()}`);
  });
  child.on("exit", () => {
    for (const [, pending] of servicePending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("catalog service exited"));
    }
    servicePending.clear();
    service = null;
  });
  return child;
}

function callService<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (quitting) return Promise.reject(new Error("shutting down"));
  if (!service) service = startService();
  const child = service;
  const id = ++serviceSeq;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      servicePending.delete(id);
      reject(new Error(`catalog service timeout (${method})`));
    }, 60_000);
    servicePending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}

/** Wrap a service call in the { ok, error? } IPC result shape. */
async function serviceResult<T>(method: string, params: Record<string, unknown> = {}): Promise<
  { ok: true; result: T } | { ok: false; error: string }
> {
  try {
    return { ok: true, result: await callService<T>(method, params) };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }
}

// ---- Engine script spawning ---------------------------------------------------
// Spawn a Node script, streaming its PHASE/PROGRESS/DONE protocol back to the
// renderer on `${channelPrefix}:*` channels.
function runScriptArgs(
  scriptPath: string,
  args: string[],
  event: IpcMainInvokeEvent,
  channelPrefix: string,
): Promise<{ ok: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn("node", [scriptPath, ...args], { cwd: REPO_ROOT, env: process.env });
    let output = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (event.sender.isDestroyed()) return;
      for (const line of chunk.toString().split("\n")) {
        const progress = line.match(/^PROGRESS (\d+)/);
        if (progress) event.sender.send(`${channelPrefix}:progress`, Number(progress[1]));
        const phase = line.match(/^PHASE (.+)/);
        if (phase) event.sender.send(`${channelPrefix}:phase`, phase[1].trim());
        const done = line.match(/^DONE (.+)/);
        if (done) output = done[1].trim();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("close", (code) => {
      if (code === 0) resolve({ ok: true, output });
      else resolve({ ok: false, error: stderr.trim() || `Process exited with code ${code}` });
    });
    child.on("error", (err) => resolve({ ok: false, error: String(err) }));
  });
}

// ---- Stamp watcher: CLI/agent writes -> renderer refresh ----------------------
// Pipeline scripts and agent CLIs touch <home>/.keeper/.stamp after writes; the
// app's own service never does (it would loop). Debounced push to the renderer.
let stampWatcher: FSWatcher | null = null;
function watchStamp(): void {
  const stampFile = join(LIBRARY_HOME, ".keeper", ".stamp");
  try {
    if (!existsSync(stampFile)) writeFileSync(stampFile, "0");
  } catch {
    return;
  }
  let timer: NodeJS.Timeout | null = null;
  try {
    stampWatcher = watch(stampFile, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void callService("refreshEmbeddings").catch(() => undefined);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("library:changed");
        }
      }, 500);
    });
  } catch {
    // stamp watching is best-effort
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#111013",
    title: "Keeper",
    icon: ICON_PATH,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  mainWindow = win;
  win.on("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// ---- Dialog helpers ------------------------------------------------------------
async function pickPaths(mode: "files" | "folder"): Promise<string[]> {
  const win = mainWindow ?? BrowserWindow.getFocusedWindow();
  const opts: Electron.OpenDialogOptions = {
    title: mode === "folder" ? "Choose a folder to import" : "Choose photos and videos",
    properties:
      mode === "folder" ? ["openDirectory"] : ["openFile", "multiSelections", "treatPackageAsDirectory"],
    filters:
      mode === "files"
        ? [
            {
              name: "Media",
              extensions: [
                "jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "tif", "tiff",
                "cr2", "cr3", "nef", "nrw", "arw", "dng", "orf", "rw2", "raf", "srw", "pef",
                "mp4", "m4v", "mov", "avi", "mkv", "webm",
              ],
            },
          ]
        : undefined,
  };
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return result.canceled ? [] : result.filePaths;
}

const FLAGS = new Set(["pick", "reject", "unrated"]);

app.whenReady().then(() => {
  // macOS ignores the BrowserWindow `icon`; set the dock icon so the app shows
  // its own icon instead of the default Electron one (matters most in dev).
  if (process.platform === "darwin" && app.dock) {
    const dockIcon = nativeImage.createFromPath(ICON_PATH);
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
  }

  protocol.handle("keeper-asset", (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "home") return new Response("Forbidden", { status: 403 });
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    let file: string;
    try {
      file = safeHomePath(rel);
    } catch {
      return new Response("Forbidden", { status: 403 });
    }

    let size: number;
    try {
      size = statSync(file).size;
    } catch {
      return new Response("Not found", { status: 404 });
    }

    const mime = mimeFor(file);
    const range = request.headers.get("Range");

    // Stream from disk with byte-range support so <video> can seek without the
    // main process ever buffering whole files.
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = Math.min(match?.[1] ? Number.parseInt(match[1], 10) : 0, Math.max(0, size - 1));
      const end = Math.min(match?.[2] ? Number.parseInt(match[2], 10) : size - 1, size - 1);
      const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
      return new Response(body, {
        status: 206,
        headers: {
          "Content-Type": mime,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(end - start + 1),
        },
      });
    }

    const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": mime, "Accept-Ranges": "bytes", "Content-Length": String(size) },
    });
  });

  // ---- health / library -------------------------------------------------------
  ipcMain.handle("ping", () => "pong");

  ipcMain.handle("library:get", () => ({
    ok: true,
    home: LIBRARY_HOME,
    exists: existsSync(join(LIBRARY_HOME, "library")),
  }));

  ipcMain.handle("library:summary", () => serviceResult("librarySummary"));

  ipcMain.handle("library:days", (_event, params: { flag?: string; mediaType?: string }) =>
    serviceResult("listDays", {
      flag: params?.flag && FLAGS.has(params.flag) ? params.flag : undefined,
      mediaType: params?.mediaType === "photo" || params?.mediaType === "video" ? params.mediaType : undefined,
    }),
  );

  ipcMain.handle("library:assets", (_event, params: Record<string, unknown>) =>
    serviceResult("listAssets", sanitizeListParams(params)),
  );

  ipcMain.handle("library:assetsById", (_event, ids: string[]) =>
    serviceResult("getAssets", { ids: sanitizeIds(ids) }),
  );

  ipcMain.handle("library:reveal", () => {
    void shell.openPath(LIBRARY_HOME);
    return { ok: true };
  });

  ipcMain.handle("library:pick", async () => {
    const win = mainWindow ?? BrowserWindow.getFocusedWindow();
    const opts: Electron.OpenDialogOptions = {
      title: "Choose where Keeper stores your library",
      properties: ["openDirectory", "createDirectory"],
    };
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return { ok: true, canceled: true };
    const dir = result.filePaths[0];
    writeSettings({ libraryDir: dir });
    return { ok: true, dir, restartRequired: true };
  });

  // ---- import / pipeline --------------------------------------------------------
  ipcMain.handle("import:pick", async (_event, mode: "files" | "folder") =>
    pickPaths(mode === "folder" ? "folder" : "files").then((paths) => ({ ok: true, paths })),
  );

  ipcMain.handle("import:start", async (event, sources: string[]) => {
    if (!Array.isArray(sources) || sources.length === 0) return { ok: false, error: "nothing to import" };
    const cleaned = sources.filter((s) => typeof s === "string" && s.length > 0).slice(0, 64);
    const args = cleaned.flatMap((s) => ["--source", s]);
    const result = await runScriptArgs(IMPORT_SCRIPT, args, event, "import");
    await callService("refreshEmbeddings").catch(() => undefined);
    if (result.ok && readSettings().autoJudge && llmInfo().configured) {
      // Fire-and-forget: the judge streams its own progress under judge:*.
      void runScriptArgs(JUDGE_SCRIPT, ["--budget", String(readSettings().aiBudget)], event, "judge").then(
        () => {
          if (!event.sender.isDestroyed()) event.sender.send("library:changed");
        },
      );
    }
    return result;
  });

  ipcMain.handle("reprocess:start", (event, stage?: string) => {
    const valid = ["derive", "cv", "group", "embed", "all"];
    const args = ["--stage", valid.includes(stage ?? "") ? (stage as string) : "all"];
    return runScriptArgs(REPROCESS_SCRIPT, args, event, "reprocess");
  });

  // ---- verdicts / review ----------------------------------------------------------
  ipcMain.handle(
    "verdict:set",
    (_event, params: { ids: string[]; flag?: string; rating?: number; recordTaste?: boolean }) => {
      const ids = sanitizeIds(params?.ids);
      if (ids.length === 0) return { ok: false, error: "no assets" };
      const flag = params.flag !== undefined && FLAGS.has(params.flag) ? params.flag : undefined;
      const rating =
        typeof params.rating === "number" && Number.isInteger(params.rating) && params.rating >= 0 && params.rating <= 5
          ? params.rating
          : undefined;
      if (flag === undefined && rating === undefined) return { ok: false, error: "no verdict" };
      return serviceResult("setVerdict", { ids, flag, rating, recordTaste: params.recordTaste });
    },
  );

  ipcMain.handle("verdict:restore", (_event, entries: { id: string; user: { flag: string; rating: number } }[]) => {
    const cleaned = (Array.isArray(entries) ? entries : [])
      .filter((e) => e && typeof e.id === "string" && e.user && FLAGS.has(e.user.flag))
      .slice(0, 5000)
      .map((e) => ({
        id: e.id,
        user: { flag: e.user.flag, rating: clampRating(e.user.rating) },
      }));
    if (cleaned.length === 0) return { ok: false, error: "nothing to restore" };
    return serviceResult("restoreVerdicts", { entries: cleaned });
  });

  ipcMain.handle("group:get", (_event, id: string) =>
    typeof id === "string" ? serviceResult("getGroup", { id }) : { ok: false, error: "bad group id" },
  );

  ipcMain.handle("group:pick", (_event, params: { groupId: string; assetId: string }) => {
    if (typeof params?.groupId !== "string" || typeof params?.assetId !== "string") {
      return { ok: false, error: "bad params" };
    }
    return serviceResult("setGroupPick", { groupId: params.groupId, assetId: params.assetId });
  });

  ipcMain.handle("review:queues", () => serviceResult("reviewQueues"));

  // ---- search --------------------------------------------------------------------
  ipcMain.handle("search:query", (_event, params: { query: string; limit?: number }) => {
    const query = typeof params?.query === "string" ? params.query.slice(0, 500) : "";
    if (!query.trim()) return { ok: false, error: "empty query" };
    const limit = typeof params.limit === "number" ? Math.min(300, Math.max(1, params.limit)) : 80;
    return serviceResult("search", { query, limit });
  });

  // ---- taste ---------------------------------------------------------------------
  ipcMain.handle("taste:get", () => serviceResult("taste"));

  ipcMain.handle("taste:addRule", (_event, text: string) => {
    if (typeof text !== "string" || !text.trim()) return { ok: false, error: "empty rule" };
    return serviceResult("addTasteRule", { text: text.trim().slice(0, 500) });
  });

  ipcMain.handle("taste:removeRule", (_event, id: string) =>
    typeof id === "string" ? serviceResult("removeTasteRule", { id }) : { ok: false, error: "bad id" },
  );

  // ---- LLM judge -----------------------------------------------------------------
  ipcMain.handle("judge:info", () => {
    const info = llmInfo();
    const settings = readSettings();
    return {
      ok: true,
      ...info,
      budget: settings.aiBudget,
      autoJudge: settings.autoJudge,
      modelLocked: envLocked.model,
      keyLocked: envLocked.apiKey,
    };
  });

  ipcMain.handle("judge:start", async (event, params?: { budget?: number }) => {
    if (!llmInfo().configured) {
      return { ok: false, error: "No model configured. Add an API key in Settings → AI." };
    }
    const budget =
      typeof params?.budget === "number" && params.budget > 0
        ? Math.min(5000, Math.round(params.budget))
        : readSettings().aiBudget;
    return runScriptArgs(JUDGE_SCRIPT, ["--budget", String(budget)], event, "judge");
  });

  // ---- export / trash --------------------------------------------------------------
  ipcMain.handle("export:pickDest", async () => {
    const win = mainWindow ?? BrowserWindow.getFocusedWindow();
    const opts: Electron.OpenDialogOptions = {
      title: "Export selects to…",
      properties: ["openDirectory", "createDirectory"],
    };
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return { ok: true, canceled: true };
    return { ok: true, dest: result.filePaths[0] };
  });

  ipcMain.handle(
    "export:run",
    (event, params: { dest?: string; ids?: string[]; xmp?: boolean; inPlace?: boolean }) => {
      const args: string[] = [];
      if (params?.inPlace) {
        args.push("--in-place-xmp");
      } else {
        if (typeof params?.dest !== "string" || !params.dest) return { ok: false, error: "no destination" };
        args.push("--dest", params.dest);
        if (params.xmp !== false) args.push("--xmp");
      }
      const ids = sanitizeIds(params?.ids ?? []);
      if (ids.length > 0) args.push("--ids", ids.join(","));
      return runScriptArgs(EXPORT_SCRIPT, args, event, "export");
    },
  );

  ipcMain.handle("export:openDest", (_event, dest: string) => {
    if (typeof dest !== "string" || !dest) return { ok: false, error: "bad path" };
    void shell.openPath(dest);
    return { ok: true };
  });

  ipcMain.handle("asset:reveal", async (_event, id: string) => {
    if (typeof id !== "string") return { ok: false, error: "bad id" };
    try {
      const assets = await callService<{ relPath: string }[]>("getAssets", { ids: [id] });
      if (assets.length === 0) return { ok: false, error: "not found" };
      shell.showItemInFolder(safeHomePath(assets[0].relPath));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err instanceof Error ? err.message : err) };
    }
  });

  ipcMain.handle("rejects:summary", () => serviceResult("rejectsSummary"));

  // The only destructive operation in the app: move user-rejected originals to
  // the OS trash (recoverable), then forget the rows + derived files. Two-step
  // confirmation lives in the UI; the AI can never reach this path.
  ipcMain.handle("rejects:empty", async (_event, ids: string[]) => {
    const cleaned = sanitizeIds(ids, 100_000);
    if (cleaned.length === 0) return { ok: false, error: "nothing to delete" };
    try {
      const paths = await callService<{ id: string; relPath: string }[]>("assetPaths", { ids: cleaned });
      let trashed = 0;
      for (const entry of paths) {
        try {
          const abs = safeHomePath(entry.relPath);
          if (existsSync(abs)) {
            await shell.trashItem(abs);
            trashed++;
          }
          const sidecar = abs.replace(/\.[^./\\]+$/, ".xmp");
          if (sidecar !== abs && existsSync(sidecar)) await shell.trashItem(sidecar);
        } catch (err) {
          console.error(`trash failed for ${entry.relPath}: ${String(err)}`);
        }
      }
      await callService("forgetAssets", { ids: cleaned });
      return { ok: true, trashed };
    } catch (err) {
      return { ok: false, error: String(err instanceof Error ? err.message : err) };
    }
  });

  // ---- settings ---------------------------------------------------------------------
  ipcMain.handle("settings:get", () => ({ ok: true, settings: readSettings() }));
  ipcMain.handle("settings:set", (_event, patch: Partial<AppSettings>) => {
    const clean: Partial<AppSettings> = {};
    if (typeof patch?.hwDecode === "boolean") clean.hwDecode = patch.hwDecode;
    if (typeof patch?.agentModel === "string") clean.agentModel = patch.agentModel.slice(0, 128);
    if (typeof patch?.agentApiKey === "string") clean.agentApiKey = patch.agentApiKey.slice(0, 256) || undefined;
    if (patch?.agentApiKey === "") clean.agentApiKey = undefined;
    if (patch?.reasoningEffort === "low" || patch?.reasoningEffort === "medium" || patch?.reasoningEffort === "high") {
      clean.reasoningEffort = patch.reasoningEffort;
    }
    if (typeof patch?.aiBudget === "number" && Number.isFinite(patch.aiBudget)) {
      clean.aiBudget = Math.min(5000, Math.max(1, Math.round(patch.aiBudget)));
    }
    if (typeof patch?.autoJudge === "boolean") clean.autoJudge = patch.autoJudge;
    return { ok: true, settings: writeSettings(clean) };
  });

  watchStamp();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function sanitizeIds(ids: unknown, cap = 5000): string[] {
  if (!Array.isArray(ids)) return [];
  return ids
    .filter((id): id is string => typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id))
    .slice(0, cap);
}

function clampRating(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 5 ? v : 0;
}

function sanitizeListParams(params: Record<string, unknown> | undefined): Record<string, unknown> {
  const p = params ?? {};
  return {
    flag: typeof p.flag === "string" && FLAGS.has(p.flag) ? p.flag : undefined,
    mediaType: p.mediaType === "photo" || p.mediaType === "video" ? p.mediaType : undefined,
    minRating: typeof p.minRating === "number" ? clampRating(p.minRating) : undefined,
    importId: typeof p.importId === "string" ? p.importId.slice(0, 128) : undefined,
    groupId: typeof p.groupId === "string" ? p.groupId.slice(0, 128) : undefined,
    day: typeof p.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.day) ? p.day : undefined,
    ids: sanitizeIds(p.ids, 2000).length > 0 ? sanitizeIds(p.ids, 2000) : undefined,
    hasAi: typeof p.hasAi === "boolean" ? p.hasAi : undefined,
    limit: typeof p.limit === "number" ? Math.min(100_000, Math.max(1, Math.round(p.limit))) : undefined,
    offset: typeof p.offset === "number" ? Math.max(0, Math.round(p.offset)) : undefined,
    order: p.order === "captured_asc" ? "captured_asc" : "captured_desc",
  };
}

app.on("before-quit", () => {
  quitting = true;
  stampWatcher?.close();
  service?.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
