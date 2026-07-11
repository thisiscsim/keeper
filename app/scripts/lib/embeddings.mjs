// Local CLIP embeddings via transformers.js (onnxruntime under the hood).
// One image vector per asset (thumbs are already normalized JPEGs), plus the
// matching text tower for natural-language search. The model downloads once
// into <library>/.keeper/models and everything runs offline afterwards.
import fs from "node:fs";
import path from "node:path";
import { modelsDir } from "./paths.mjs";

export const EMBED_MODEL_ID = "Xenova/clip-vit-base-patch32";

let transformersPromise = null;
let visionPromise = null;
let textPromise = null;

async function loadTransformers(home) {
  if (!transformersPromise) {
    transformersPromise = import("@huggingface/transformers").then((mod) => {
      mod.env.cacheDir = modelsDir(home);
      mod.env.allowLocalModels = true;
      return mod;
    });
  }
  return transformersPromise;
}

/** True once the model files exist locally (no network needed anymore). */
export function modelCached(home) {
  try {
    // transformers.js lays the cache out as <cacheDir>/<org>/<model>/...
    const dir = path.join(modelsDir(home), ...EMBED_MODEL_ID.split("/"));
    return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

async function loadVision(home) {
  if (!visionPromise) {
    visionPromise = (async () => {
      const { AutoProcessor, CLIPVisionModelWithProjection } = await loadTransformers(home);
      const processor = await AutoProcessor.from_pretrained(EMBED_MODEL_ID);
      const model = await CLIPVisionModelWithProjection.from_pretrained(EMBED_MODEL_ID, {
        dtype: "q8",
      });
      return { processor, model };
    })();
  }
  return visionPromise;
}

async function loadText(home) {
  if (!textPromise) {
    textPromise = (async () => {
      const { AutoTokenizer, CLIPTextModelWithProjection } = await loadTransformers(home);
      const tokenizer = await AutoTokenizer.from_pretrained(EMBED_MODEL_ID);
      const model = await CLIPTextModelWithProjection.from_pretrained(EMBED_MODEL_ID, {
        dtype: "q8",
      });
      return { tokenizer, model };
    })();
  }
  return textPromise;
}

function l2Normalize(vec) {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (v) => v / norm);
}

/** Embed one image file (thumb/poster JPEG). Returns a unit-norm number[]. */
export async function embedImage(home, absImagePath) {
  const { RawImage } = await loadTransformers(home);
  const { processor, model } = await loadVision(home);
  const image = await RawImage.read(absImagePath);
  const inputs = await processor(image);
  const { image_embeds } = await model(inputs);
  return l2Normalize(image_embeds.data);
}

/** Embed a search query with the text tower. Unit-norm number[]. */
export async function embedText(home, query) {
  const { tokenizer, model } = await loadText(home);
  const inputs = tokenizer([query], { padding: true, truncation: true });
  const { text_embeds } = await model(inputs);
  return l2Normalize(text_embeds.data);
}

/** Cosine similarity of two unit-norm vectors = dot product. */
export function cosine(a, b) {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

/** Rank catalog embeddings against a query vector. Returns top-k [{id, score}]. */
export function rankBySimilarity(queryVec, embeddings, k = 60) {
  const scored = embeddings.map(({ id, vec }) => ({ id, score: cosine(queryVec, vec) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
