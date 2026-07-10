// Provider-agnostic LLM resolver. Default is GPT-5.5 via OpenAI; the escape
// hatch lets you point at Anthropic or ANY OpenAI-compatible endpoint
// (self-hosted Gemma via Ollama/vLLM, an enterprise gateway, Azure, etc.)
// purely through environment variables — no code change to rotate models.
//
//   APERTURE_LLM_PROVIDER   openai | anthropic | openai-compatible   (default: openai)
//   APERTURE_LLM_MODEL      model id                                  (default: gpt-5.5)
//   APERTURE_LLM_BASE_URL   override base URL (gateways / local)       (optional)
//   APERTURE_LLM_API_KEY    generic key; falls back to OPENAI_API_KEY / ANTHROPIC_API_KEY
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function llmConfig() {
  const provider = (process.env.APERTURE_LLM_PROVIDER || "openai").toLowerCase();
  const model = process.env.APERTURE_LLM_MODEL || "gpt-5.5";
  const baseURL = process.env.APERTURE_LLM_BASE_URL || undefined;
  const apiKey =
    process.env.APERTURE_LLM_API_KEY ||
    (provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY) ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY;
  return { provider, model, baseURL, apiKey };
}

/** True when generation can run. Local/compatible endpoints may need only a baseURL. */
export function isLlmConfigured() {
  const { provider, apiKey, baseURL } = llmConfig();
  if (provider === "openai-compatible") return Boolean(baseURL || apiKey);
  return Boolean(apiKey);
}

/** Reasoning effort for OpenAI reasoning models (Settings → Agent Preferences). */
export function reasoningEffort() {
  const v = (process.env.APERTURE_REASONING_EFFORT || "low").toLowerCase();
  return ["low", "medium", "high"].includes(v) ? v : "low";
}

export function resolveModel() {
  const { provider, model, baseURL, apiKey } = llmConfig();
  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey, baseURL })(model);
    case "openai-compatible":
      return createOpenAICompatible({ name: "aperture-llm", apiKey: apiKey ?? "", baseURL })(model);
    case "openai":
    default:
      return createOpenAI({ apiKey, baseURL })(model);
  }
}
