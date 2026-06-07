import { describe, it, expect } from 'vitest';
import { getModelMetadata, getModelMetadataSnake } from '../../lib/capabilities.js';

describe('model capability classifier', () => {
  it('classifies by family, not by hosting provider', () => {
    // Llama 3.3 70B has the same capabilities regardless of who serves it.
    const groq = getModelMetadata('groq', 'llama-3.3-70b-versatile');
    const sambanova = getModelMetadata('sambanova', 'Meta-Llama-3.3-70B-Instruct');
    const cf = getModelMetadata('cloudflare', '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    expect(groq.capabilities).toEqual(sambanova.capabilities);
    expect(groq.capabilities).toEqual(cf.capabilities);
    expect(groq.capabilities.toolCalling).toBe(true);
    expect(groq.capabilities.imageInput).toBe(false);
  });

  it('marks Claude as tool + vision capable on any provider', () => {
    for (const platform of ['meridian', 'cliproxyapi']) {
      const m = getModelMetadata(platform, 'claude-opus-4-7');
      expect(m.capabilities.toolCalling).toBe(true);
      expect(m.capabilities.imageInput).toBe(true);
      expect(m.inputModalities).toEqual(['text', 'image']);
      expect(m.features).toContain('vision');
      expect(m.features).toContain('reasoning');
    }
  });

  it('gives Gemini image + audio input', () => {
    const m = getModelMetadata('google', 'gemini-2.5-flash');
    expect(m.capabilities.imageInput).toBe(true);
    expect(m.capabilities.audioInput).toBe(true);
    expect(m.inputModalities).toEqual(['text', 'image', 'audio']);
  });

  it('treats Llama 4 as multimodal but Llama 3 as text-only', () => {
    expect(getModelMetadata('groq', 'meta-llama/llama-4-scout-17b-16e-instruct').capabilities.imageInput).toBe(true);
    expect(getModelMetadata('nvidia', 'meta/llama-3.1-70b-instruct').capabilities.imageInput).toBe(false);
  });

  it('recognizes tool calling on providers the old heuristic missed', () => {
    // zhipu, llm7, kilo, pollinations, cohere were previously false/unknown.
    expect(getModelMetadata('zhipu', 'glm-4.7-flash').capabilities.toolCalling).toBe(true);
    expect(getModelMetadata('cohere', 'command-a-03-2025').capabilities.toolCalling).toBe(true);
    expect(getModelMetadata('pollinations', 'openai-fast').capabilities.toolCalling).toBe(true);
  });

  it('flags GLM-V vision variants but not plain GLM', () => {
    expect(getModelMetadata('llm7', 'GLM-4.6V-Flash').capabilities.imageInput).toBe(true);
    expect(getModelMetadata('zhipu', 'glm-4.5-flash').capabilities.imageInput).toBe(false);
  });

  it('detects reasoning distills before their base family', () => {
    const m = getModelMetadata('cloudflare', '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b');
    expect(m.features).toContain('reasoning');
  });

  it('tags Gemma as vision-capable but without tool calling', () => {
    const m = getModelMetadata('openrouter', 'google/gemma-4-31b-it:free');
    expect(m.capabilities.toolCalling).toBe(false);
    expect(m.capabilities.imageInput).toBe(true);
  });

  it('tags Groq Compound as agentic', () => {
    const m = getModelMetadata('groq', 'groq/compound');
    expect(m.features).toContain('agentic');
    expect(m.features).toContain('web-search');
  });

  it('falls back to unknown tool calling for unrecognized models', () => {
    const m = getModelMetadata('mystery', 'some-brand-new-model-x1');
    expect(m.capabilities.toolCalling).toBe('unknown');
    expect(m.capabilities.text).toBe(true);
  });

  it('snake_case projection mirrors the camelCase metadata', () => {
    const snake = getModelMetadataSnake('google', 'gemini-2.5-pro');
    expect(snake.capabilities.tool_calling).toBe(true);
    expect(snake.capabilities.image_input).toBe(true);
    expect(snake.capabilities.audio_input).toBe(true);
    expect(snake.input_modalities).toEqual(['text', 'image', 'audio']);
    expect(snake).toHaveProperty('output_modalities');
    expect(snake).toHaveProperty('features');
  });
});
