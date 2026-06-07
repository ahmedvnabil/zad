// Model capability classifier.
//
// The catalog stores no per-model capability columns, so we infer them. The
// previous approach keyed almost everything off the *provider* (e.g. "all
// cerebras models support tools, everything else is unknown"), which was both
// wrong (zhipu / llm7 / kilo / nvidia / cohere all support tool calling) and
// noisy (Claude, Llama-4, GLM-V, Gemma are vision-capable but were marked
// text-only). The same model served through a different provider (Llama-3.3
// via groq vs sambanova vs cloudflare) has identical capabilities, so the
// honest signal is the model *family*, not who is hosting it.
//
// This module classifies by family (a regex over the normalized model id),
// platform-agnostic, with conservative `'unknown'` only where a family is
// genuinely ambiguous. It is the single source of truth for both the
// `/api/fallback` UI and the OpenAI-compatible `/v1/models` endpoint.

export type CapabilityValue = boolean | 'unknown';

export interface ModelCapabilities {
  text: CapabilityValue;
  toolCalling: CapabilityValue;
  imageInput: CapabilityValue;
  imageOutput: CapabilityValue;
  audioInput: CapabilityValue;
  audioOutput: CapabilityValue;
}

export interface ModelMetadata {
  inputModalities: string[];
  outputModalities: string[];
  capabilities: ModelCapabilities;
  features: string[];
}

// Snake_case projection for the OpenAI-compatible `/v1/models` response.
export interface ModelMetadataSnake {
  input_modalities: string[];
  output_modalities: string[];
  capabilities: {
    text: CapabilityValue;
    tool_calling: CapabilityValue;
    image_input: CapabilityValue;
    image_output: CapabilityValue;
    audio_input: CapabilityValue;
    audio_output: CapabilityValue;
  };
  features: string[];
}

interface FamilyTraits {
  tools?: CapabilityValue;   // default 'unknown'
  vision?: CapabilityValue;  // image input; default false
  audio?: CapabilityValue;   // audio input; default false
  reasoning?: boolean;       // surfaced as a `reasoning` feature, not a pill
  agentic?: boolean;         // built-in tools (web search / code execution)
  code?: boolean;            // coding-specialist model
}

interface FamilyRule {
  test: RegExp;
  traits: FamilyTraits;
}

// Ordered most-specific → most-general; the first matching rule wins. Tested
// against the normalized (lowercased) model id with the provider prefix kept
// (e.g. `meta-llama/llama-4-scout...`), so `llama-4` must precede `llama-3`,
// and reasoning distills (`...-r1-distill-qwen...`) must precede `qwen`.
const FAMILY_RULES: FamilyRule[] = [
  // Anthropic Claude — tools + vision, extended thinking.
  { test: /claude/, traits: { tools: true, vision: true, reasoning: true } },

  // Google Gemini — tools + vision + audio input, thinking on 2.5/3.x.
  { test: /gemini/, traits: { tools: true, vision: true, audio: true, reasoning: true } },

  // OpenAI GPT-4o / GPT-4.1 (incl. `openai-gpt-4o`, `gpt-4o-mini`) — tools +
  // vision. Audio is a separate realtime API, not chat-completions → false.
  { test: /gpt-4o|gpt-4\.1/, traits: { tools: true, vision: true } },

  // GPT-OSS family (and Pollinations' `openai-fast` alias) — tools, reasoning
  // effort, text only.
  { test: /gpt-oss|openai-fast/, traits: { tools: true, reasoning: true } },

  // Reasoning distills must be matched before their base family (qwen/llama).
  { test: /r1-distill|deepseek-r1|\bqwq\b/, traits: { tools: 'unknown', reasoning: true } },

  // Meta Llama 4 (Scout / Maverick) — natively multimodal, tools + vision.
  { test: /llama-?4/, traits: { tools: true, vision: true } },

  // Meta Llama 3.x — tools, text only.
  { test: /llama-?3/, traits: { tools: true } },

  // DeepSeek V3/V4 (non-reasoning) — tools, text only.
  { test: /deepseek/, traits: { tools: true } },

  // Qwen 3 family (coder / 235b / 32b / next / 30b / 4b) — tools, text only.
  // `coder` variants get the `code` tag via the refinement in matchFamily().
  { test: /qwen-?3/, traits: { tools: true } },

  // Mistral families. Magistral is reasoning-tuned; codestral/devstral are code.
  { test: /magistral/, traits: { tools: true, reasoning: true } },
  { test: /codestral|devstral/, traits: { tools: true, code: true } },
  { test: /mistral|ministral|mixtral/, traits: { tools: true } },

  // Zhipu / Z.ai GLM. The "V" variants (GLM-4.6V) are vision; the rest text.
  { test: /glm[-\d.]*v/, traits: { tools: true, vision: true } },
  { test: /glm/, traits: { tools: true } },

  // Cohere Command (R+ / A) — tools, text.
  { test: /command-/, traits: { tools: true } },

  // NVIDIA Nemotron. The `omni` variant is multimodal; `reasoning` is reasoning.
  { test: /nemotron.*omni/, traits: { tools: true, vision: true, audio: true, reasoning: true } },
  { test: /nemotron/, traits: { tools: true } },

  // MiniMax M2.x — tools, text.
  { test: /minimax/, traits: { tools: true } },

  // Moonshot Kimi — tools; `thinking` variant adds reasoning.
  { test: /kimi/, traits: { tools: true } },

  // Google Gemma 3/4 — multimodal (image in) but no native function calling.
  { test: /gemma/, traits: { tools: false, vision: true } },

  // IBM Granite — supports function calling.
  { test: /granite/, traits: { tools: true } },

  // Deep Cogito — hybrid reasoning + tools.
  { test: /cogito/, traits: { tools: true, reasoning: true } },

  // Groq Compound — agentic system with built-in web search + code execution.
  { test: /compound/, traits: { tools: true, agentic: true } },

  // Poolside Laguna — coding models; tool support not documented.
  { test: /laguna|poolside/, traits: { tools: 'unknown', code: true } },

  // Liquid LFM — tiny edge models; no tool calling. `thinking` adds reasoning.
  { test: /lfm|liquid/, traits: { tools: false } },

  // Tencent Hunyuan / inclusionAI Ling — tool support not verified.
  { test: /hy3|hunyuan/, traits: { tools: 'unknown' } },
  { test: /\bling-/, traits: { tools: 'unknown' } },
];

function matchFamily(modelId: string): FamilyTraits {
  for (const rule of FAMILY_RULES) {
    if (rule.test.test(modelId)) {
      const traits = { ...rule.traits };
      // Sub-variant refinements that depend on the concrete id.
      if (/coder|code/.test(modelId)) traits.code = true;
      if (/thinking|reasoning/.test(modelId)) traits.reasoning = true;
      return traits;
    }
  }
  return {};
}

/**
 * Classify a model into capability metadata from its family. Provider-agnostic:
 * the same model id yields the same capabilities regardless of which platform
 * hosts it.
 */
export function getModelMetadata(_platform: string, modelId: string): ModelMetadata {
  const id = modelId.toLowerCase();
  const t = matchFamily(id);

  const capabilities: ModelCapabilities = {
    text: true,
    toolCalling: t.tools ?? 'unknown',
    imageInput: t.vision ?? false,
    imageOutput: false,
    audioInput: t.audio ?? false,
    audioOutput: false,
  };

  const inputModalities = ['text'];
  if (capabilities.imageInput === true) inputModalities.push('image');
  if (capabilities.audioInput === true) inputModalities.push('audio');
  const outputModalities = ['text'];

  // `features` is the semantic tag list consumed by API clients (Hermes etc.).
  // It intentionally includes tags the UI also renders as pills (tool-calling,
  // vision, audio-input); the FallbackPage filters those out so its chips only
  // show the *extra* signal (reasoning / agentic / code).
  const features = ['chat-completions'];
  if (capabilities.toolCalling === true) features.push('tool-calling');
  if (capabilities.imageInput === true) features.push('vision');
  if (capabilities.audioInput === true) features.push('audio-input');
  if (t.reasoning) features.push('reasoning');
  if (t.agentic) features.push('agentic', 'web-search');
  if (t.code) features.push('code');

  return { inputModalities, outputModalities, capabilities, features };
}

/** Snake_case projection for the OpenAI-compatible `/v1/models` endpoint. */
export function getModelMetadataSnake(platform: string, modelId: string): ModelMetadataSnake {
  const m = getModelMetadata(platform, modelId);
  return {
    input_modalities: m.inputModalities,
    output_modalities: m.outputModalities,
    capabilities: {
      text: m.capabilities.text,
      tool_calling: m.capabilities.toolCalling,
      image_input: m.capabilities.imageInput,
      image_output: m.capabilities.imageOutput,
      audio_input: m.capabilities.audioInput,
      audio_output: m.capabilities.audioOutput,
    },
    features: m.features,
  };
}
