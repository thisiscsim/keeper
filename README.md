# Keeper

> Scaffolded from the Aperture video studio. Docs below describe the inherited stack (Electron + Vite + React, design tokens + UI kit, EDL schema package, engine scripts, Vitest + CI) until Keeper's own docs replace them.

AI-assisted short-form video studio. Create a project, drop in your clips, write what you want, let it learn your aesthetic, generate a first cut, refine it on a timeline, critique it against your own best posts, auto-improve it, and export a vertical MP4.

Aperture is **local-first, not local-only**: your media, editing, transcription, and export all run on your machine, but the AI steps (generate, critique, auto-improve) call a configurable LLM API (OpenAI GPT-5.5 by default). If no model is configured, those steps fall back to fully-offline deterministic versions.

## The end-to-end flow

1. **Home** — a project dashboard. Create a project (name + prompt + platform) or open/delete an existing one (per-card ⋯ menu).
2. **Input** — upload clips (drag/drop), edit the prompt, attach music, and upload or record a voiceover (auto-transcribed to word-level captions; music ducks under voice).
3. **Learn aesthetic** (optional) — build a reusable **Style Library**: bulk-import a whole folder of your past videos once, and Aperture distills their palette, grade, pacing, hook, and text treatment into a profile (with a prose style guide + per-reference exemplars). Point any project at a library profile, or learn from a project's own references as an override. Built-in named style presets are also available.
4. **Generate** — produces a real first cut (hook, reordering, titles, transitions, palette + color grade) conditioned on your prompt and the active style profile. LLM-powered when configured; deterministic baseline otherwise.
5. **Refine** — a timeline editor with live Remotion preview. Every edit autosaves to `edl.json`; external writes live-reload.
6. **Critique** — score the cut, calibrated against your own uploaded high-performers ("you vs your best"). LLM critique or instant offline heuristic.
7. **Auto-improve** — a generate → critique → improve loop that iterates the edit and logs the score trajectory.
8. **Export** — render a vertical 1080×1920 MP4 locally via Remotion.

## Architecture

Three layers, bridged by one file per project:

- **Electron editor** (`app/`) — homepage + timeline UI + live preview (Remotion Player) + export (Remotion renderer).
- **Node scripts** (`app/scripts/`) — the engine: clip probing/assembly, transcription, frame/style/benchmark analysis, the LLM generate/critique/auto-improve calls, and rendering.
- **Agent skills** (`.claude/skills/`, `AGENTS.md`) — the richest path: skills run from a Claude/Cursor harness that read/write the same project files.

**The contract:** each video is a folder under `projects/<slug>/` whose `edl.json` (validated by the zod schema in `packages/edl`) is the single source of truth. Generators write it; the editor previews/edits/autosaves it; the renderer exports it.

Every "smart" step exists at three tiers and the app picks the best available: deterministic script (offline, free) → single LLM call (cost-predictable) → agent skill (richest).

```
aperture/
  app/
    src/                  Electron main + preload + React renderer
    scripts/              analyze, transcribe, render, extract-frames,
                          analyze-style, analyze-collection, analyze-benchmarks,
                          generate-llm, critique-llm, autotune(-llm), llm
    resources/            app icon, bundled music
  packages/edl/           Shared EDL + meta/style/benchmark schemas (zod)
  .claude/skills/         create-social-video, learn-aesthetic,
                          critique-video, auto-tune
  projects/<slug>/        meta.json, prompt.md, assets/, edl.json,
                          style.json, references/, benchmarks/,
                          benchmarks.json, transcripts/, critique.json, renders/
  styles/<id>/            Global Style Library (gitignored): profile.json,
                          style-guide.md, sources/, .frames/
  AGENTS.md               Agent operating manual
```

## Style Library

Rather than re-uploading references per project, build a creator-level look once and reuse it everywhere (Style tab):

- **Bulk import** a whole folder (or multi-select) via a native picker.
- **Analyze once** — samples frames and computes editing metrics, then (with a model configured) distills a prose style guide + per-reference exemplars the generator imitates in-context. Without a model it still writes a solid deterministic profile.
- **Reuse** — a project points at a library profile via `meta.styleProfileId`; a project's own `references/` override the library when present.
- **Faithful generation** — generation injects the style guide + top exemplars and then deterministically stamps the measurable look (palette, font, caption style, and a light color grade rendered as a CSS filter on your clips).

Scope note: this matches edit structure, captions, text, transitions, palette, and a light grade — not footage transformation (no LUT/effects/AI restyle of the source pixels).

## AI configuration

The AI steps use the Vercel AI SDK behind a provider-agnostic layer (`app/scripts/llm.mjs`). Configure it with a local, gitignored env file — copy `app/.env.local.example` to `app/.env.local`:

```bash
# app/.env.local  (default: OpenAI GPT-5.5)
OPENAI_API_KEY=sk-...
```

The main process loads this at startup, so spawned scripts inherit it (no shell exporting needed). Restart `npm run dev` after changing it.

Escape hatch — rotate models/providers with no code change:

```bash
APERTURE_LLM_PROVIDER=openai            # openai | anthropic | openai-compatible
APERTURE_LLM_MODEL=gpt-5.5
APERTURE_LLM_BASE_URL=                  # e.g. http://localhost:11434/v1 for a self-hosted model
APERTURE_LLM_API_KEY=                   # generic; overrides the provider-specific key
```

With no key set, Generate falls back to the deterministic baseline assembly and the Critique panel uses the offline heuristic; Auto-improve uses the deterministic fix loop.

### Voiceover (ElevenLabs)

Generated voiceovers (left rail → Audio → Generate voiceover) and in-app voice cloning use ElevenLabs. Add a key to the same env file (or paste it under Settings → Voices — the env var wins when both are set):

```bash
ELEVENLABS_API_KEY=sk_...
```

When creating the key in the ElevenLabs dashboard, scope it minimally — Aperture only needs:

| Scope | Level | Used for |
| --- | --- | --- |
| Text to Speech | Access | Narration synthesis (also returns the word timings used for captions) |
| Voices | Read | Listing your voices in the picker |
| Voices | Write | Only if you clone/delete voices in-app |

Everything else (Dubbing, Projects, Voice Generation, Forced Alignment, Speech to Text, …) can stay on No Access. Voice *cloning* requires a paid ElevenLabs plan and the consent of the person being cloned; without a key, recorded voiceovers and whisper captions still work fully offline.

### What leaves your machine

Generation, critique, and auto-improve send **text** — the `edl.json` edit plan, your `prompt.md`, the resolved style profile, and benchmark feature stats — never your clips. The one exception is **Style Library analysis**, which sends *sampled still frames* of your reference videos to the model (once per profile) so it can see the aesthetic; your source video/audio files themselves are never uploaded. Clip probing, frame sampling, transcription (whisper.cpp), preview, and export all run locally. With no model configured, nothing leaves your machine.

## Where your work is stored

Projects and the style library are **user data**, not part of the repo. By default they live in **`~/Documents/Aperture/`** (`projects/` and `styles/`), so they're never committed or bundled into the app. You can change the location in Settings (gear icon → Projects folder); a restart applies it. Dev overrides: `APERTURE_HOME` (root), `REEL_PROJECTS_DIR`, `APERTURE_STYLES_DIR`. A sample project for development lives in `fixtures/sample-project/`.

## Develop

```bash
npm install        # install workspaces
npm run dev        # launch the Electron editor (electron-vite)
npm run typecheck  # type-check all workspaces
npm run build      # production build
```

## Status

V1. The full creator pipeline (homepage → input → aesthetic learning → generate → refine → benchmark critique → auto-improve → export) is implemented, with deterministic offline fallbacks and an LLM path for generation, critique, and auto-improvement.

## Changelog

This project is pre-release; all notable changes are grouped below until we start tagging versions. Newest first.

### Unreleased

**Style Library + faithful generation**
- Global, reusable **Style Library** (`styles/<id>/`): bulk-import a folder (native picker), analyze once, reuse across projects; per-project `references/` still override.
- Rich multimodal style capture (`analyze-collection.mjs`): frame sampling + editing metrics distilled by the LLM into a prose style guide + per-reference exemplars (with a deterministic fallback).
- Style-faithful generation: `generate-llm.mjs` injects the style guide + top exemplars and deterministically stamps palette, font, caption style, and color grade.
- Color grade: `theme.grade` (brightness/contrast/saturation/temperature/vignette) rendered as a CSS filter on clips in preview and export.

**LLM everywhere (with offline fallbacks)**
- Provider-agnostic LLM layer on the Vercel AI SDK (`llm.mjs`), default OpenAI GPT-5.5, env-configurable provider/model/base-URL.
- LLM-backed **Generate** (`generate-llm.mjs`), **Critique** (`critique-llm.mjs`), and **Auto-improve** (`autotune-llm.mjs`, a critique-in-the-loop optimizer), each falling back to deterministic scripts when no model is set.
- Local, gitignored `app/.env.local` loading at startup; graceful, surfaced errors (toasts) instead of silent fallback.

**Creator pipeline (front + back of the journey)**
- Project **homepage/dashboard**: create, open, delete (per-card ⋯ menu), thumbnails, view routing.
- **Creator input**: clip upload (drag/drop), editable prompt (`prompt.md`), attach music (upload + bundled library), voiceover upload or in-app recording with auto-transcribed captions and music ducking under voice.
- **Aesthetic learning** (per-project) + named visual-style presets.
- **Benchmark-aware critique**: upload your high-performers, analyze features, and score "you vs your best".

**Editor & platform**
- `edl.json` autosave + file-watch live reload (editor ↔ agent round-trip).
- Root React error boundary (no more blank-screen crashes); empty-project preview placeholder.
- Light/dark theme toggle (system-aware, persisted).
- Rebrand **Reel Studio → Aperture**: window title, macOS app/dock name, app icon, and docs.

**EDL package**
- New `meta`, `style`, and `benchmark` zod schemas; audio-clip `role` (music/voiceover/sfx); `theme.stylePreset` and `theme.grade`.
- Fixed the ESM build so the schema imports cleanly from Node scripts.

### Initial commit
- Scaffold: Electron + Vite + React editor, shared `packages/edl` schema, Remotion preview/export spine, and the `create-social-video` / `critique-video` Claude Code skills.
