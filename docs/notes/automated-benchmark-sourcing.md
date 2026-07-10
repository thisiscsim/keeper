# Note: automating benchmark / reference sourcing (Exa, Parallel, platform APIs)

Status: thought experiment, not scheduled. Captured 2026-06-30 so we don't lose context.

## Question

Today the Style Library (reference videos) and the critique benchmarks (high-performing
videos) are **manually uploaded**. Could we instead auto-source the high-performing
videos via a web-search/research API like **Exa** or **Parallel** — assuming their
indexes already carry engagement rankings we could piggyback on?

## Verdict

Partially useful, but not the way the "embedded rankings" assumption implies.

- Exa and Parallel are **web-content search/research** APIs. Their "rankings" are
  **relevance rankings over web pages** (Exa = neural/embeddings search + find-similar;
  Parallel = agentic web research returning structured findings).
- They are **not social-video engagement indexes**. They do not carry TikTok/IG/YouTube
  view/like counts as first-class ranked fields. "High-performing" = engagement metrics,
  and that data lives behind the platforms, not in a general web index.
- Net: they help with the **discovery** slice ("where to look") and with **trend/insight
  text**, but not the hard parts (real engagement metrics + fetching the actual media +
  legality).

## What a realistic pipeline would require (3 steps; Exa/Parallel only cover step 1)

1. **Discovery** — Exa/Parallel find candidate video/post URLs and niche trend articles.
   Good fit.
2. **Engagement signal** — parse view/like metadata separately. YouTube pages/oEmbed
   expose view counts; TikTok/IG are JS-gated and hostile to scraping.
3. **Media bytes** — Exa/Parallel return page *text/content*, NOT the video file. Our
   analyzer (`analyze-collection.mjs` / `analyze-benchmarks.mjs`) needs frames + audio, so
   we'd still need `yt-dlp` or a platform API to fetch media (brittle + ToS-risky).

Then feed the downloaded media into the existing analyze pipeline -> `benchmarks.json`.

## Better-fit tools for the actual "high-performing" signal

- **YouTube Data API** — genuinely has rankings: `search?order=viewCount` + per-video
  `statistics` (views/likes). Authorized, structured. Best first spike.
- **TikTok Research/Display API**, **Instagram Graph API** — real metrics but gated
  (business accounts, approval, limited scope).
- **Specialized scrapers** (e.g., Apify actors) — purpose-built for social engagement.
- **Cleanest for "your own best posts":** OAuth into the creator's OWN account and pull
  their top videos + metrics directly. This is the true "automate the manual upload" path
  — authorized, accurate, no gray area — and matches the semantics we already chose
  (calibrate against *your* winners, not strangers').

## Where Exa/Parallel would actually shine here

As a **trend/insight text layer**, no downloading required:
- "What hooks / editing patterns are trending for [niche] short-form right now?" ->
  Parallel research task or Exa search -> distilled text that conditions generation and
  critique (feeds the style guide / rubric), the same way we inject `style.json` today.
- Cheap, low-risk, complementary to manual-upload benchmarks.

## Caveats

- **ToS/copyright**: downloading and analyzing *other people's* videos is a legal gray
  zone (platform ToS + copyright). Analyzing *your own* content or public metadata is much
  safer — this is why we chose manual upload initially.
- **Semantic shift**: scraping niche-viral videos = *competitor/trend* benchmarking, which
  is different from *personal* calibration ("you vs your best"). Both valid; decide which
  question we're answering before building.
- **Quality/determinism**: relevance-ranked results are noisy; without the metrics step
  you'd benchmark against what ranked for *search*, not for *the algorithm*.
- **Cost/complexity**: external API deps, rate limits, and a fragile media-download step.

## Recommendation if we ever pursue it

1. Spike the **YouTube Data API** path (real rankings + clean auth) to auto-populate
   benchmarks/references — start with the creator's own account via OAuth.
2. Layer **Exa/Parallel** as a trend-insight/discovery text layer that conditions
   generation and critique (no media download).
3. Avoid making "download strangers' viral videos" a core feature (ToS/copyright cost).
