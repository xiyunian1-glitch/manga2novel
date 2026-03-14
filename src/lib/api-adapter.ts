import type { AIResponse, APIConfig, ModelOption } from './types';

export interface ImagePayload {
  base64: string;
  mime: string;
}

export interface GenerationOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxOutputTokens?: number;
  responseMimeType?: 'application/json' | 'text/plain';
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

const LOCAL_PROXY_ENDPOINT = 'http://127.0.0.1:8787/proxy';

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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function dedupeModels(models: ModelOption[]): ModelOption[] {
  return Array.from(new Map(models.map((model) => [model.id, model])).values());
}

function summarizeResponseBody(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'empty response';
  }
  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
}

function looksLikeHtml(text: string): boolean {
  return /<!doctype html|<html[\s>]/i.test(text);
}

function sanitizeUrlForDisplay(url: string): string {
  return url
    .replace(/([?&]key=)[^&]+/i, '$1***')
    .replace(/([?&]api[_-]?key=)[^&]+/i, '$1***');
}

function isRemoteBrowserSession(): boolean {
  return typeof window !== 'undefined' && !isLocalBrowserSession();
}

function isLocalBrowserSession(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const hostname = window.location.hostname;
  return hostname === '127.0.0.1' || hostname === 'localhost';
}

function shouldAttemptLocalProxy(url: string): boolean {
  if (!isLocalBrowserSession()) {
    return false;
  }

  try {
    const target = new URL(url);
    return target.origin !== LOCAL_PROXY_ENDPOINT.replace(/\/proxy$/, '')
      && target.hostname !== '127.0.0.1'
      && target.hostname !== 'localhost';
  } catch {
    return false;
  }
}

function formatFetchFailure(context: string, url: string, error: unknown): Error {
  const sanitizedUrl = sanitizeUrlForDisplay(url);
  const reason = error instanceof Error && error.message && error.message !== 'Failed to fetch'
    ? ` (${error.message})`
    : '';
  const remoteStaticHint = isRemoteBrowserSession()
    ? ' This app is running as a static browser build, so the request failed before it reached the upstream model. Use an endpoint that allows browser CORS, or place a server-side proxy in front of it.'
    : ' The request failed before it reached the upstream model.';

  return new Error(
    `${context}: network request could not reach ${sanitizedUrl}${reason}. `
    + 'Check whether the API URL / proxy is correct, the server is reachable from the browser, and CORS / HTTPS certificate settings allow this request.'
    + remoteStaticHint
  );
}

function formatProxyFetchFailure(context: string, url: string, directError: unknown, proxyError: unknown): Error {
  const sanitizedUrl = sanitizeUrlForDisplay(url);
  const directReason = directError instanceof Error && directError.message && directError.message !== 'Failed to fetch'
    ? ` (${directError.message})`
    : '';
  const proxyReason = proxyError instanceof Error && proxyError.message && proxyError.message !== 'Failed to fetch'
    ? ` (${proxyError.message})`
    : '';

  return new Error(
    `${context}: direct browser request could not reach ${sanitizedUrl}${directReason}. `
    + `A local fallback proxy at ${LOCAL_PROXY_ENDPOINT} was also unreachable${proxyReason}. `
    + 'The request never reached the upstream model. Start scripts/run-local-dev.cmd or scripts/run-local-preview.cmd to launch the built-in proxy, or check whether port 8787 is blocked.'
  );
}

function withLocalProxyHeaders(url: string, init: RequestInit): RequestInit {
  const headers = new Headers(init.headers);
  headers.set('X-Target-URL', url);
  return {
    ...init,
    headers,
  };
}

async function fetchWithDiagnostics(url: string, init: RequestInit, context: string): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (directError) {
    if (isAbortError(directError)) {
      throw directError;
    }

    if (shouldAttemptLocalProxy(url)) {
      try {
        return await fetch(LOCAL_PROXY_ENDPOINT, withLocalProxyHeaders(url, init));
      } catch (proxyError) {
        if (isAbortError(proxyError)) {
          throw proxyError;
        }

        throw formatProxyFetchFailure(context, url, directError, proxyError);
      }
    }

    throw formatFetchFailure(context, url, directError);
  }
}

function looksLikeSafetyRefusal(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
  return (
    normalized.includes('i cannot fulfill this request')
    && normalized.includes('helpful and harmless ai assistant')
  ) || (
    normalized.includes('sexually explicit')
    && normalized.includes('safety guidelines')
  );
}

function getWrappedProviderError(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }

  const wrappedMatch = normalized.match(/^\[(?:请求失败|request failed)\s*:\s*(.+)\]$/i);
  if (wrappedMatch?.[1]) {
    return wrappedMatch[1].trim();
  }

  if (/no capacity available for model/i.test(normalized)) {
    return normalized;
  }

  return null;
}

async function parseJsonResponse<T>(
  response: Response,
  context: string,
  invalidJsonHint: string
): Promise<T> {
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`${context} (${response.status}): ${summarizeResponseBody(responseText)}`);
  }

  try {
    return JSON.parse(responseText) as T;
  } catch {
    if (looksLikeHtml(responseText)) {
      throw new Error(`${context}: returned HTML; check API URL or proxy settings`);
    }
    throw new Error(`${context}: ${invalidJsonHint}`);
  }
}

function normalizeModelText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

function extractFencedCodeBlockContents(text: string): string[] {
  const normalized = normalizeModelText(text);
  const candidates: string[] = [];
  const fencePattern = /```+\s*([^\n`]*)\n([\s\S]*?)```+/g;

  for (const match of normalized.matchAll(fencePattern)) {
    const label = String(match[1] || '').trim().toLowerCase();
    const content = String(match[2] || '').trim();

    if (!content) {
      continue;
    }

    if (!label || /^(json|jsonc|javascript|js|typescript|ts)$/i.test(label) || /^[\[{]/.test(content)) {
      candidates.push(content);
    }
  }

  if (candidates.length === 0 && /^```+/m.test(normalized)) {
    const stripped = normalized
      .replace(/^```+[^\n]*\n?/, '')
      .replace(/\n?```+\s*$/, '')
      .trim();

    if (stripped) {
      candidates.push(stripped);
    }
  }

  return Array.from(new Set(candidates));
}

function unwrapJsonCodeBlock(text: string): string {
  const normalized = normalizeModelText(text);
  const [firstCandidate] = extractFencedCodeBlockContents(normalized);
  return firstCandidate ?? normalized;
}

function extractLikelyJsonText(text: string): string | null {
  const objectStart = text.indexOf('{');
  const arrayStart = text.indexOf('[');
  const startCandidates = [objectStart, arrayStart].filter((index) => index >= 0);
  if (startCandidates.length === 0) {
    return null;
  }

  const start = Math.min(...startCandidates);
  const objectEnd = text.lastIndexOf('}');
  const arrayEnd = text.lastIndexOf(']');
  const end = Math.max(objectEnd, arrayEnd);

  if (end <= start) {
    return null;
  }

  return text.slice(start, end + 1);
}

function escapeControlCharactersInJsonStrings(text: string): string {
  let result = '';
  let inString = false;
  let escaping = false;

  for (const char of text) {
    if (!inString) {
      result += char;
      if (char === '"') {
        inString = true;
      }
      continue;
    }

    if (escaping) {
      result += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      result += char;
      escaping = true;
      continue;
    }

    if (char === '"') {
      result += char;
      inString = false;
      continue;
    }

    if (char === '\n') {
      result += '\\n';
      continue;
    }

    if (char === '\r') {
      result += '\\r';
      continue;
    }

    if (char === '\t') {
      result += '\\t';
      continue;
    }

    if (char === '\b') {
      result += '\\b';
      continue;
    }

    if (char === '\f') {
      result += '\\f';
      continue;
    }

    const charCode = char.charCodeAt(0);
    if (charCode < 0x20) {
      result += `\\u${charCode.toString(16).padStart(4, '0')}`;
      continue;
    }

    result += char;
  }

  return result;
}

function repairCommonJsonIssues(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/}\s*(?=\{)/g, '},')
    .replace(/]\s*(?=\[)/g, '],')
    .replace(/"\s*(?=(?:\{|\[|"(?:[^"\\]|\\.)*"|-?\d|true|false|null))/g, '",');
}

function summarizeJsonParseFailure(text: string, error: unknown): string {
  if (!(error instanceof Error)) {
    return 'The model did not return valid JSON.';
  }

  const match = error.message.match(/position\s+(\d+)/i);
  if (!match) {
    return `The model returned malformed JSON: ${error.message}`;
  }

  const position = Number(match[1]);
  if (!Number.isFinite(position)) {
    return `The model returned malformed JSON: ${error.message}`;
  }

  const start = Math.max(0, position - 80);
  const end = Math.min(text.length, position + 80);
  const excerpt = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `The model returned malformed JSON near position ${position}: ${excerpt}`;
}

function tryParseJsonCandidate<T>(text: string): { ok: true; value: T } | { ok: false; error: unknown } {
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch (error) {
    return { ok: false, error };
  }
}

export function extractJsonValue<T>(rawText: string): T {
  const normalizedRawText = normalizeModelText(rawText);
  const fencedCandidates = extractFencedCodeBlockContents(normalizedRawText);
  const text = unwrapJsonCodeBlock(normalizedRawText);
  const wrappedProviderError = getWrappedProviderError(text);

  if (looksLikeSafetyRefusal(text)) {
    throw new Error('The model refused the request because the content triggered safety filtering.');
  }

  if (wrappedProviderError) {
    throw new Error(wrappedProviderError);
  }

  const candidateTexts = Array.from(new Set([
    normalizedRawText,
    text,
    ...fencedCandidates,
    extractLikelyJsonText(text),
    ...fencedCandidates.map((candidate) => extractLikelyJsonText(candidate)),
    escapeControlCharactersInJsonStrings(text),
    ...fencedCandidates.map((candidate) => escapeControlCharactersInJsonStrings(candidate)),
    repairCommonJsonIssues(text),
    ...fencedCandidates.map((candidate) => repairCommonJsonIssues(candidate)),
    repairCommonJsonIssues(escapeControlCharactersInJsonStrings(text)),
    ...fencedCandidates.map((candidate) => repairCommonJsonIssues(escapeControlCharactersInJsonStrings(candidate))),
    (() => {
      const extracted = extractLikelyJsonText(text);
      return extracted ? repairCommonJsonIssues(extracted) : null;
    })(),
    (() => {
      const extracted = extractLikelyJsonText(text);
      return extracted ? escapeControlCharactersInJsonStrings(extracted) : null;
    })(),
    (() => {
      const extracted = extractLikelyJsonText(text);
      return extracted ? repairCommonJsonIssues(escapeControlCharactersInJsonStrings(extracted)) : null;
    })(),
    ...fencedCandidates.map((candidate) => {
      const extracted = extractLikelyJsonText(candidate);
      return extracted ? repairCommonJsonIssues(extracted) : null;
    }),
    ...fencedCandidates.map((candidate) => {
      const extracted = extractLikelyJsonText(candidate);
      return extracted ? escapeControlCharactersInJsonStrings(extracted) : null;
    }),
    ...fencedCandidates.map((candidate) => {
      const extracted = extractLikelyJsonText(candidate);
      return extracted ? repairCommonJsonIssues(escapeControlCharactersInJsonStrings(extracted)) : null;
    }),
  ].filter((candidate): candidate is string => Boolean(candidate))));

  let lastError: unknown = null;

  for (const candidate of candidateTexts) {
    const parsed = tryParseJsonCandidate<T>(candidate);
    if (parsed.ok) {
      return parsed.value;
    }

    lastError = parsed.error;
  }

  throw new Error(summarizeJsonParseFailure(text, lastError));
}

function parseAIResponse(rawText: string): AIResponse {
  const parsed = extractJsonValue<Partial<AIResponse>>(rawText);

  if (!parsed.novelText || !parsed.plotSummary || !parsed.endingDetail) {
    throw new Error('The model returned JSON but omitted required novel fields.');
  }

  return {
    novelText: String(parsed.novelText),
    plotSummary: String(parsed.plotSummary),
    endingDetail: String(parsed.endingDetail),
  };
}

async function fetchOpenRouterModels(apiKey: string, baseUrl?: string): Promise<ModelOption[]> {
  if (!apiKey) {
    throw new Error('OpenRouter requires an API key before fetching models.');
  }

  const url = `${normalizeBaseUrl(baseUrl, 'https://openrouter.ai/api/v1')}/models`;
  const response = await fetchWithDiagnostics(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'Manga2Novel',
    },
  }, 'Failed to fetch OpenRouter models');

  const data = await parseJsonResponse<OpenRouterModelResponse>(
    response,
    'Failed to fetch OpenRouter models',
    'response was not valid JSON'
  );

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
    throw new Error('Gemini requires an API key before fetching models.');
  }

  const url = `${normalizeBaseUrl(baseUrl, 'https://generativelanguage.googleapis.com/v1beta')}/models?key=${apiKey}`;
  const response = await fetchWithDiagnostics(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  }, 'Failed to fetch Gemini models');

  const data = await parseJsonResponse<GeminiModelResponse>(
    response,
    'Failed to fetch Gemini models',
    'response was not valid JSON'
  );

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
      throw new Error(`Unsupported provider: ${config.provider}`);
  }
}

async function callOpenRouterText(
  config: APIConfig,
  images: ImagePayload[],
  options: GenerationOptions,
  signal?: AbortSignal
): Promise<string> {
  const imageContents = images.map((img) => ({
    type: 'image_url' as const,
    image_url: { url: `data:${img.mime};base64,${img.base64}` },
  }));

  const url = `${getProviderBaseUrl(config)}/chat/completions`;
  const response = await fetchWithDiagnostics(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
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
            { type: 'text', text: options.userPrompt },
            ...imageContents,
          ],
        },
      ],
      temperature: options.temperature,
      max_tokens: options.maxOutputTokens ?? 4096,
    }),
  }, 'OpenRouter request failed');

  const data = await parseJsonResponse<{
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  }>(
    response,
    'OpenRouter request failed',
    'response was not valid JSON'
  );

  const rawText = data.choices?.[0]?.message?.content;
  if (!rawText) {
    throw new Error('OpenRouter returned an empty completion.');
  }

  const wrappedProviderError = getWrappedProviderError(rawText);
  if (wrappedProviderError) {
    throw new Error(wrappedProviderError);
  }

  return rawText;
}

async function callGeminiText(
  config: APIConfig,
  images: ImagePayload[],
  options: GenerationOptions,
  signal?: AbortSignal
): Promise<string> {
  const imageParts = images.map((img) => ({
    inlineData: { mimeType: img.mime, data: img.base64 },
  }));

  const generationConfig: Record<string, unknown> = {
    temperature: options.temperature,
    maxOutputTokens: options.maxOutputTokens ?? 4096,
  };

  if (options.responseMimeType) {
    generationConfig.responseMimeType = options.responseMimeType;
  }

  const url = `${getProviderBaseUrl(config)}/models/${config.model}:generateContent?key=${config.apiKey}`;
  const response = await fetchWithDiagnostics(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: options.systemPrompt }] },
      contents: [
        {
          role: 'user',
          parts: [{ text: options.userPrompt }, ...imageParts],
        },
      ],
      generationConfig,
    }),
  }, 'Gemini request failed');

  const data = await parseJsonResponse<{
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
        }>;
      };
    }>;
  }>(
    response,
    'Gemini request failed',
    'response was not valid JSON'
  );

  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Gemini returned an empty completion.');
  }

  const wrappedProviderError = getWrappedProviderError(rawText);
  if (wrappedProviderError) {
    throw new Error(wrappedProviderError);
  }

  return rawText;
}

export async function callAIText(
  config: APIConfig,
  images: ImagePayload[],
  options: GenerationOptions,
  signal?: AbortSignal
): Promise<string> {
  switch (config.provider) {
    case 'openrouter':
      return callOpenRouterText(config, images, options, signal);
    case 'gemini':
      return callGeminiText(config, images, options, signal);
    default:
      throw new Error(`Unsupported provider: ${config.provider}`);
  }
}

export async function callAI(
  config: APIConfig,
  images: ImagePayload[],
  options: GenerationOptions,
  signal?: AbortSignal
): Promise<AIResponse> {
  const rawText = await callAIText(
    config,
    images,
    { ...options, responseMimeType: 'application/json' },
    signal
  );

  return parseAIResponse(rawText);
}
