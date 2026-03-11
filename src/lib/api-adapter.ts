/**
 * APIAdapter —— 统一 API 集成层
 * 适配 OpenRouter 和 Google Gemini 官方 API
 * 
 * CORS 策略：
 *   - OpenRouter: 官方支持浏览器直接调用（Access-Control-Allow-Origin: *）
 *   - Gemini: generativelanguage.googleapis.com 支持浏览器 CORS
 */

import type { APIConfig, AIResponse, ModelOption } from './types';
import { buildUserPrompt } from './prompts';

interface ImagePayload {
  base64: string;
  mime: string;
}

function normalizeBaseUrl(baseUrl: string | undefined, fallback: string): string {
  const candidate = (baseUrl || fallback).trim();
  return candidate.replace(/\/+$/, '');
}

function getProviderBaseUrl(config: Pick<APIConfig, 'provider' | 'baseUrl'>): string {
  if (config.provider === 'openrouter') {
    return normalizeBaseUrl(config.baseUrl, 'https://openrouter.ai/api/v1');
  }
  return normalizeBaseUrl(config.baseUrl, 'https://generativelanguage.googleapis.com/v1beta');
}

type OpenRouterModelResponse = {
  data?: Array<{
    id?: string;
    name?: string;
  }>;
};

type GeminiModelResponse = {
  models?: Array<{
    name?: string;
    displayName?: string;
    supportedGenerationMethods?: string[];
  }>;
};

interface GenerationOptions {
  systemPrompt: string;
  temperature: number;
}

function dedupeModels(models: ModelOption[]): ModelOption[] {
  return Array.from(new Map(models.map((model) => [model.id, model])).values());
}

async function fetchOpenRouterModels(apiKey: string, baseUrl?: string): Promise<ModelOption[]> {
  if (!apiKey) {
    throw new Error('OpenRouter 需要先填写 API Key 才能获取模型列表');
  }

  const response = await fetch(`${normalizeBaseUrl(baseUrl, 'https://openrouter.ai/api/v1')}/models`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'Manga2Novel',
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenRouter 模型列表获取失败 (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as OpenRouterModelResponse;
  const models = Array.isArray(data.data)
    ? data.data
        .filter((item) => item?.id)
        .map((item) => ({
          id: String(item.id),
          name: String(item.name || item.id),
        }))
    : [];

  return dedupeModels(models);
}

async function fetchGeminiModels(apiKey: string, baseUrl?: string): Promise<ModelOption[]> {
  if (!apiKey) {
    throw new Error('Gemini 需要先填写 API Key 才能获取模型列表');
  }

  const response = await fetch(
    `${normalizeBaseUrl(baseUrl, 'https://generativelanguage.googleapis.com/v1beta')}/models?key=${apiKey}`,
    {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini 模型列表获取失败 (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as GeminiModelResponse;
  const models = Array.isArray(data.models)
    ? data.models
        .filter((item) => {
          const name = String(item?.name || '');
          const methods = Array.isArray(item?.supportedGenerationMethods)
            ? item.supportedGenerationMethods
            : [];
          return name.startsWith('models/') && methods.includes('generateContent');
        })
        .map((item) => {
          const id = String(item.name).replace(/^models\//, '');
          return {
            id,
            name: String(item.displayName || id),
          };
        })
    : [];

  return dedupeModels(models);
}

export async function fetchModels(config: Pick<APIConfig, 'provider' | 'apiKey' | 'baseUrl'>): Promise<ModelOption[]> {
  switch (config.provider) {
    case 'openrouter':
      return fetchOpenRouterModels(config.apiKey, config.baseUrl);
    case 'gemini':
      return fetchGeminiModels(config.apiKey, config.baseUrl);
    default:
      throw new Error(`不支持的 API 提供商: ${config.provider}`);
  }
}

/**
 * 从 AI 响应中解析结构化 JSON
 */
function parseAIResponse(rawText: string): AIResponse {
  // 尝试直接解析
  let text = rawText.trim();

  // 移除可能的 Markdown 代码块包裹
  const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    text = jsonBlockMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(text);
    if (!parsed.novelText || !parsed.plotSummary || !parsed.endingDetail) {
      throw new Error('JSON 缺少必要字段');
    }
    return {
      novelText: String(parsed.novelText),
      plotSummary: String(parsed.plotSummary),
      endingDetail: String(parsed.endingDetail),
    };
  } catch {
    // 兜底：如果 JSON 解析失败，将整段文本作为小说内容
    return {
      novelText: rawText,
      plotSummary: '（AI 未能返回结构化摘要，请检查模型输出）',
      endingDetail: '',
    };
  }
}

/**
 * 调用 OpenRouter API
 */
async function callOpenRouter(
  config: APIConfig,
  images: ImagePayload[],
  chunkIndex: number,
  globalSummary: string,
  previousEnding: string,
  options: GenerationOptions,
  signal?: AbortSignal
): Promise<AIResponse> {
  const userPrompt = buildUserPrompt(chunkIndex, globalSummary, previousEnding);

  const imageContents = images.map((img) => ({
    type: 'image_url' as const,
    image_url: { url: `data:${img.mime};base64,${img.base64}` },
  }));
  const baseUrl = getProviderBaseUrl(config);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'Manga2Novel',
    },
    signal,
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: options.systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            ...imageContents,
          ],
        },
      ],
      temperature: options.temperature,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenRouter API 错误 (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  const rawText = data.choices?.[0]?.message?.content;
  if (!rawText) throw new Error('OpenRouter 返回空内容');

  return parseAIResponse(rawText);
}

/**
 * 调用 Google Gemini API
 */
async function callGemini(
  config: APIConfig,
  images: ImagePayload[],
  chunkIndex: number,
  globalSummary: string,
  previousEnding: string,
  options: GenerationOptions,
  signal?: AbortSignal
): Promise<AIResponse> {
  const userPrompt = buildUserPrompt(chunkIndex, globalSummary, previousEnding);

  const imageParts = images.map((img) => ({
    inlineData: { mimeType: img.mime, data: img.base64 },
  }));

  const baseUrl = getProviderBaseUrl(config);
  const url = `${baseUrl}/models/${config.model}:generateContent?key=${config.apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: options.systemPrompt }] },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }, ...imageParts],
        },
      ],
      generationConfig: {
        temperature: options.temperature,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini API 错误 (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('Gemini 返回空内容');

  return parseAIResponse(rawText);
}

/**
 * 统一调用入口
 */
export async function callAI(
  config: APIConfig,
  images: ImagePayload[],
  chunkIndex: number,
  globalSummary: string,
  previousEnding: string,
  options: GenerationOptions,
  signal?: AbortSignal
): Promise<AIResponse> {
  switch (config.provider) {
    case 'openrouter':
      return callOpenRouter(config, images, chunkIndex, globalSummary, previousEnding, options, signal);
    case 'gemini':
      return callGemini(config, images, chunkIndex, globalSummary, previousEnding, options, signal);
    default:
      throw new Error(`不支持的 API 提供商: ${config.provider}`);
  }
}
