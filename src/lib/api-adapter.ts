import type { AIResponse, APIConfig, ModelOption } from './types';
import {
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_COMPATIBLE_BASE_URL,
  GEMINI_ROOT_BASE_URL,
  LEGACY_OPENROUTER_BASE_URL,
  PROVIDER_DISPLAY_NAMES,
} from './types';

export interface ImagePayload {
  base64: string;
  mime: string;
  label?: string;
}

export interface GenerationOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxOutputTokens?: number;
  responseMimeType?: 'application/json' | 'text/plain';
  userPromptPlacement?: 'before-media' | 'after-media';
}

export interface LocalProxyStatus {
  isLocalSession: boolean;
  available: boolean;
  endpoint: string | null;
  port: number | null;
}

type CompatibleModelResponse = {
  data?: Array<{
    id?: string;
    name?: string;
  }>;
};

type CompatibleChatCompletionResponse = {
  error?: {
    message?: string;
    type?: string;
    code?: string | number | null;
  };
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  choices?: Array<{
    finish_reason?: string;
    text?: string;
    message?: {
      content?: string | Array<{
        type?: string;
        text?: string;
        content?: string;
      }>;
      reasoning_content?: string;
      refusal?: string;
    };
  }>;
};

type CompatibleMessageContent = NonNullable<
  NonNullable<NonNullable<CompatibleChatCompletionResponse['choices']>[number]['message']>['content']
>;

type CompatibleChoice = NonNullable<CompatibleChatCompletionResponse['choices']>[number];

type GeminiModelResponse = {
  models?: Array<{
    name?: string;
    displayName?: string;
    supportedGenerationMethods?: string[];
  }>;
};

const LOCAL_PROXY_HOST = '127.0.0.1';
const LOCAL_PROXY_PORT_START = 8787;
const LOCAL_PROXY_PORT_END = 8797;
const LOCAL_PROXY_STORAGE_KEY = 'm2n_local_proxy_endpoint';
let cachedLocalProxyEndpoint: string | null = null;

function getLocalProxyEndpoint(port: number): string {
  return `http://${LOCAL_PROXY_HOST}:${port}/proxy`;
}

function getLocalProxyHealthEndpoint(proxyEndpoint: string): string {
  return proxyEndpoint.replace(/\/proxy$/, '/health');
}

function getLocalProxyPortRangeLabel(): string {
  return `${LOCAL_PROXY_PORT_START}-${LOCAL_PROXY_PORT_END}`;
}

export function getLocalProxyStatusLabelRange(): string {
  return getLocalProxyPortRangeLabel();
}

function readRememberedLocalProxyEndpoint(): string | null {
  if (cachedLocalProxyEndpoint) {
    return cachedLocalProxyEndpoint;
  }

  if (typeof window === 'undefined') {
    return null;
  }

  const stored = window.localStorage.getItem(LOCAL_PROXY_STORAGE_KEY)?.trim() || '';
  if (!stored) {
    return null;
  }

  cachedLocalProxyEndpoint = stored;
  return stored;
}

function rememberLocalProxyEndpoint(proxyEndpoint: string): void {
  cachedLocalProxyEndpoint = proxyEndpoint;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(LOCAL_PROXY_STORAGE_KEY, proxyEndpoint);
  }
}

function clearRememberedLocalProxyEndpoint(proxyEndpoint?: string): void {
  if (!proxyEndpoint || cachedLocalProxyEndpoint === proxyEndpoint) {
    cachedLocalProxyEndpoint = null;
  }

  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(LOCAL_PROXY_STORAGE_KEY);
    if (!proxyEndpoint || stored === proxyEndpoint) {
      window.localStorage.removeItem(LOCAL_PROXY_STORAGE_KEY);
    }
  }
}

function getLocalProxyCandidateEndpoints(): string[] {
  const remembered = readRememberedLocalProxyEndpoint();
  const endpoints = [];

  if (remembered) {
    endpoints.push(remembered);
  }

  for (let port = LOCAL_PROXY_PORT_START; port <= LOCAL_PROXY_PORT_END; port += 1) {
    const endpoint = getLocalProxyEndpoint(port);
    if (endpoint !== remembered) {
      endpoints.push(endpoint);
    }
  }

  return endpoints;
}

function normalizeBaseUrl(baseUrl: string | undefined, fallback: string): string {
  const candidate = (baseUrl || fallback).trim();
  return candidate.replace(/\/+$/, '');
}

function normalizeGeminiBaseUrl(baseUrl: string | undefined): string {
  const candidate = normalizeBaseUrl(baseUrl, DEFAULT_GEMINI_BASE_URL);

  try {
    const parsedUrl = new URL(candidate);
    const normalizedPath = parsedUrl.pathname.replace(/\/+$/, '');

    if (parsedUrl.origin.toLowerCase() === GEMINI_ROOT_BASE_URL && !normalizedPath) {
      return DEFAULT_GEMINI_BASE_URL;
    }
  } catch {
    if (candidate.toLowerCase() === GEMINI_ROOT_BASE_URL) {
      return DEFAULT_GEMINI_BASE_URL;
    }
  }

  return candidate;
}

function getProviderBaseUrl(config: Pick<APIConfig, 'provider' | 'baseUrl'>): string {
  if (config.provider === 'compatible') {
    return normalizeBaseUrl(config.baseUrl, DEFAULT_COMPATIBLE_BASE_URL);
  }
  return normalizeGeminiBaseUrl(config.baseUrl);
}

function getProviderDisplayName(config: Pick<APIConfig, 'provider' | 'providerLabel'>): string {
  return config.providerLabel?.trim() || PROVIDER_DISPLAY_NAMES[config.provider];
}

function isDeepSeekOfficialCompatibleConfig(config: Pick<APIConfig, 'provider' | 'baseUrl' | 'model' | 'providerLabel'>): boolean {
  if (config.provider !== 'compatible') {
    return false;
  }

  const normalizedBaseUrl = normalizeBaseUrl(config.baseUrl, DEFAULT_COMPATIBLE_BASE_URL).toLowerCase();
  const providerLabel = String(config.providerLabel || '').trim().toLowerCase();
  const model = String(config.model || '').trim().toLowerCase();

  return normalizedBaseUrl.includes('api.deepseek.com')
    || providerLabel === 'deepseek'
    || model === 'deepseek-chat'
    || model === 'deepseek-reasoner';
}

function buildDeepSeekImageUnsupportedError(config: Pick<APIConfig, 'model'>): Error {
  const modelLabel = config.model.trim() || '当前模型';
  return new Error(
    `DeepSeek 官方接口当前不支持图片消息：${modelLabel} 无法接收 image_url。`
    + ' 请把含图片的阶段改用支持视觉输入的模型'
    + '（例如 Gemini，或其它支持图片输入的兼容模型），'
    + ' DeepSeek 可以继续只用于后面的纯文本阶段。'
  );
}

function rewriteCompatibleRequestError(config: APIConfig, error: unknown): Error {
  if (error instanceof Error) {
    if (
      isDeepSeekOfficialCompatibleConfig(config)
      && /unknown variant [`"]image_url[`"]|expected [`"]text[`"]|image_url/i.test(error.message)
    ) {
      return buildDeepSeekImageUnsupportedError(config);
    }

    return error;
  }

  return new Error(String(error));
}

function usesOpenRouterHeaders(url: string): boolean {
  try {
    return new URL(url).origin === new URL(LEGACY_OPENROUTER_BASE_URL).origin;
  } catch {
    return false;
  }
}

function getCompatibleHeaders(apiKey: string, url: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  if (typeof window !== 'undefined' && usesOpenRouterHeaders(url)) {
    headers['HTTP-Referer'] = window.location.origin;
    headers['X-Title'] = 'Manga2Novel';
  }

  return headers;
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
  if (looksLikeHtml(normalized)) {
    return 'returned an HTML error page';
  }
  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
}

function formatRetryAfterHeaderValue(headerValue: string): string | null {
  const normalized = headerValue.trim();
  if (!normalized) {
    return null;
  }

  if (/^\d+(?:\.\d+)?$/i.test(normalized)) {
    return `${normalized}s`;
  }

  const parsedDate = Date.parse(normalized);
  if (Number.isFinite(parsedDate)) {
    const retryAfterMs = parsedDate - Date.now();
    if (retryAfterMs > 0) {
      return `${Math.max(1, Math.ceil(retryAfterMs / 1000))}s`;
    }
  }

  return normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized;
}

function getRetryAfterErrorHint(response: Response): string {
  const retryAfter = formatRetryAfterHeaderValue(response.headers.get('Retry-After') || '');
  if (retryAfter) {
    return ` retry after ${retryAfter}`;
  }

  const retryAfterMs = response.headers.get('Retry-After-Ms')?.trim() || '';
  if (/^\d+(?:\.\d+)?$/i.test(retryAfterMs)) {
    return ` retry after ${retryAfterMs}ms`;
  }

  return '';
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

function canUseLocalProxyInBrowser(): boolean {
  return typeof window !== 'undefined';
}

function isLocalBrowserSession(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const hostname = window.location.hostname;
  return hostname === '127.0.0.1' || hostname === 'localhost';
}

function shouldAttemptLocalProxy(url: string): boolean {
  if (!canUseLocalProxyInBrowser()) {
    return false;
  }

  try {
    const target = new URL(url);
    return target.hostname !== LOCAL_PROXY_HOST
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
    + `A local fallback proxy in the port range ${LOCAL_PROXY_HOST}:${getLocalProxyPortRangeLabel()} was also unreachable${proxyReason}. `
    + `The request never reached the upstream model. Start scripts/run-local-dev.cmd or scripts/run-local-preview.cmd to launch the built-in proxy, or check whether local ports ${getLocalProxyPortRangeLabel()} are blocked.`
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

async function isAvailableLocalProxyEndpoint(proxyEndpoint: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), 500);

  try {
    const response = await fetch(getLocalProxyHealthEndpoint(proxyEndpoint), {
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      return false;
    }

    if (response.headers.get('X-Manga2Novel-Proxy') === '1') {
      return true;
    }

    // Some browsers hide custom response headers across origins unless they are explicitly exposed.
    const payload = await response.json().catch(() => null) as { ok?: boolean } | null;
    return payload?.ok === true;
  } catch {
    return false;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function extractPortFromProxyEndpoint(proxyEndpoint: string | null): number | null {
  if (!proxyEndpoint) {
    return null;
  }

  try {
    return Number(new URL(proxyEndpoint).port);
  } catch {
    return null;
  }
}

export async function detectLocalProxyStatus(): Promise<LocalProxyStatus> {
  if (!canUseLocalProxyInBrowser()) {
    return {
      isLocalSession: false,
      available: false,
      endpoint: null,
      port: null,
    };
  }

  for (const proxyEndpoint of getLocalProxyCandidateEndpoints()) {
    const isAvailable = await isAvailableLocalProxyEndpoint(proxyEndpoint);
    if (!isAvailable) {
      clearRememberedLocalProxyEndpoint(proxyEndpoint);
      continue;
    }

    rememberLocalProxyEndpoint(proxyEndpoint);
    return {
      isLocalSession: true,
      available: true,
      endpoint: proxyEndpoint,
      port: extractPortFromProxyEndpoint(proxyEndpoint),
    };
  }

  return {
    isLocalSession: true,
    available: false,
    endpoint: null,
    port: null,
  };
}

async function tryFetchViaLocalProxy(url: string, init: RequestInit): Promise<Response | null> {
  for (const proxyEndpoint of getLocalProxyCandidateEndpoints()) {
    const isAvailable = await isAvailableLocalProxyEndpoint(proxyEndpoint);
    if (!isAvailable) {
      clearRememberedLocalProxyEndpoint(proxyEndpoint);
      continue;
    }

    try {
      const response = await fetch(proxyEndpoint, withLocalProxyHeaders(url, init));
      rememberLocalProxyEndpoint(proxyEndpoint);
      return response;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      clearRememberedLocalProxyEndpoint(proxyEndpoint);
    }
  }

  return null;
}

async function fetchWithDiagnostics(url: string, init: RequestInit, context: string): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (directError) {
    if (isAbortError(directError)) {
      throw directError;
    }

    if (shouldAttemptLocalProxy(url)) {
      let lastProxyError: Error | null = null;

      try {
        const proxiedResponse = await tryFetchViaLocalProxy(url, init);
        if (proxiedResponse) {
          return proxiedResponse;
        }
      } catch (proxyError) {
        if (isAbortError(proxyError)) {
          throw proxyError;
        }

        lastProxyError = proxyError instanceof Error ? proxyError : new Error(String(proxyError));
      }

      throw formatProxyFetchFailure(context, url, directError, lastProxyError);
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

function isLengthTruncatedCompletion(finishReason: string | undefined): boolean {
  return String(finishReason || '').trim().toLowerCase() === 'length';
}

function extractCompatibleContentText(content: CompatibleMessageContent | undefined): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (!part || typeof part !== 'object') {
        return '';
      }

      if (typeof part.text === 'string' && part.text.trim()) {
        return part.text.trim();
      }

      if (typeof part.content === 'string' && part.content.trim()) {
        return part.content.trim();
      }

      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractCompatibleChoiceText(choice: CompatibleChoice | undefined): string {
  const messageContent = extractCompatibleContentText(choice?.message?.content);
  if (messageContent) {
    return messageContent;
  }

  if (typeof choice?.text === 'string' && choice.text.trim()) {
    return choice.text.trim();
  }

  if (typeof choice?.message?.refusal === 'string' && choice.message.refusal.trim()) {
    return choice.message.refusal.trim();
  }

  return '';
}

function buildCompatibleEmptyCompletionError(
  providerDisplayName: string,
  data: CompatibleChatCompletionResponse,
  options: GenerationOptions,
  extraDiagnostics: string[] = []
): Error {
  const choice = data.choices?.[0];
  const finishReason = String(choice?.finish_reason || '').trim() || 'unknown';
  const promptTokens = data.usage?.prompt_tokens;
  const completionTokens = data.usage?.completion_tokens;
  const diagnostics = [`finish_reason=${finishReason}`, ...extraDiagnostics];

  if (typeof promptTokens === 'number' && Number.isFinite(promptTokens)) {
    diagnostics.push(`prompt_tokens=${promptTokens}`);
  }

  if (typeof completionTokens === 'number' && Number.isFinite(completionTokens)) {
    diagnostics.push(`completion_tokens=${completionTokens}`);
  }

  if (typeof choice?.message?.reasoning_content === 'string' && choice.message.reasoning_content.trim()) {
    diagnostics.push(`reasoning_content_length=${choice.message.reasoning_content.length}`);
  }

  const likelyBlockedHint = finishReason === 'stop' && completionTokens === 0
    ? ' The upstream model may have blocked or discarded the response.'
    : '';

  return new Error(
    `${providerDisplayName} returned an empty completion (${diagnostics.join(', ')}) at max_tokens=${options.maxOutputTokens ?? 4096}.${likelyBlockedHint}`
  );
}

function isMarkdownFenceOnlyPlaceholder(text: string): boolean {
  const normalized = normalizeModelText(text).toLowerCase();

  if (!normalized) {
    return false;
  }

  return /^```+(?:\s*(?:json|jsonc|javascript|js|typescript|ts)?)?\s*$/.test(normalized)
    || /^```+(?:\s*(?:json|jsonc|javascript|js|typescript|ts)?)?\s*```+\s*$/.test(normalized);
}

type CompatibleUserContentPart =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'image_url';
      image_url: {
        url: string;
      };
    };

type GeminiUserPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

function buildCompatibleUserContent(
  images: ImagePayload[],
  options: GenerationOptions
): CompatibleUserContentPart[] {
  const mediaParts = images.flatMap<CompatibleUserContentPart>((image) => {
    const parts: CompatibleUserContentPart[] = [];
    const label = String(image.label || '').trim();

    if (label) {
      parts.push({ type: 'text', text: label });
    }

    parts.push({
      type: 'image_url',
      image_url: { url: `data:${image.mime};base64,${image.base64}` },
    });

    return parts;
  });

  const promptPart: CompatibleUserContentPart = {
    type: 'text',
    text: options.userPrompt,
  };

  return options.userPromptPlacement === 'after-media'
    ? [...mediaParts, promptPart]
    : [promptPart, ...mediaParts];
}

function buildGeminiUserParts(
  images: ImagePayload[],
  options: GenerationOptions
): GeminiUserPart[] {
  const mediaParts = images.flatMap((image): GeminiUserPart[] => {
    const parts: GeminiUserPart[] = [];
    const label = String(image.label || '').trim();

    if (label) {
      parts.push({ text: label });
    }

    parts.push({
      inlineData: { mimeType: image.mime, data: image.base64 },
    });

    return parts;
  });

  const promptPart = { text: options.userPrompt };
  return options.userPromptPlacement === 'after-media'
    ? [...mediaParts, promptPart]
    : [promptPart, ...mediaParts];
}

function buildCompatibleChatCompletionRequestBody(
  config: APIConfig,
  userContent: CompatibleUserContentPart[],
  options: GenerationOptions,
  includeResponseFormat: boolean
): string {
  return JSON.stringify({
    model: config.model,
    messages: [
      { role: 'system', content: options.systemPrompt },
      {
        role: 'user',
        content: userContent,
      },
    ],
    temperature: options.temperature,
    max_tokens: options.maxOutputTokens ?? 4096,
    ...(includeResponseFormat && options.responseMimeType === 'application/json'
      ? {
          response_format: { type: 'json_object' },
        }
      : {}),
  });
}

async function requestCompatibleChatCompletion(
  config: APIConfig,
  userContent: CompatibleUserContentPart[],
  options: GenerationOptions,
  signal: AbortSignal | undefined,
  includeResponseFormat: boolean
): Promise<CompatibleChatCompletionResponse> {
  const providerDisplayName = getProviderDisplayName(config);
  const url = `${getProviderBaseUrl(config)}/chat/completions`;
  const response = await fetchWithDiagnostics(url, {
    method: 'POST',
    headers: getCompatibleHeaders(config.apiKey, url),
    signal,
    body: buildCompatibleChatCompletionRequestBody(config, userContent, options, includeResponseFormat),
  }, `${providerDisplayName} request failed`);

  return parseJsonResponse<CompatibleChatCompletionResponse>(
    response,
    `${providerDisplayName} request failed`,
    'response was not valid JSON'
  );
}

async function parseJsonResponse<T>(
  response: Response,
  context: string,
  invalidJsonHint: string
): Promise<T> {
  const responseText = await response.text();

  if (!response.ok) {
    if (looksLikeHtml(responseText)) {
      if (response.status === 524) {
        throw new Error(`${context} (524): upstream gateway timed out and returned an HTML error page`);
      }
      throw new Error(`${context} (${response.status}): returned an HTML error page; check API URL, proxy, or upstream gateway`);
    }
    const retryAfterHint = getRetryAfterErrorHint(response);
    throw new Error(`${context} (${response.status}): ${summarizeResponseBody(responseText)}${retryAfterHint}`);
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

async function fetchCompatibleModels(
  apiKey: string,
  baseUrl?: string,
  providerLabel = PROVIDER_DISPLAY_NAMES.compatible
): Promise<ModelOption[]> {
  if (!apiKey) {
    throw new Error(`${providerLabel} requires an API key before fetching models.`);
  }

  const url = `${normalizeBaseUrl(baseUrl, DEFAULT_COMPATIBLE_BASE_URL)}/models`;
  const response = await fetchWithDiagnostics(url, {
    method: 'GET',
    headers: getCompatibleHeaders(apiKey, url),
  }, `Failed to fetch ${providerLabel} models`);

  const data = await parseJsonResponse<CompatibleModelResponse>(
    response,
    `Failed to fetch ${providerLabel} models`,
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

async function fetchGeminiModels(
  apiKey: string,
  baseUrl?: string,
  providerLabel = PROVIDER_DISPLAY_NAMES.gemini
): Promise<ModelOption[]> {
  if (!apiKey) {
    throw new Error(`${providerLabel} requires an API key before fetching models.`);
  }

  const url = `${normalizeGeminiBaseUrl(baseUrl)}/models?key=${apiKey}`;
  const response = await fetchWithDiagnostics(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  }, `Failed to fetch ${providerLabel} models`);

  const data = await parseJsonResponse<GeminiModelResponse>(
    response,
    `Failed to fetch ${providerLabel} models`,
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

export async function fetchModels(
  config: Pick<APIConfig, 'provider' | 'providerLabel' | 'apiKey' | 'baseUrl'>
): Promise<ModelOption[]> {
  switch (config.provider) {
    case 'compatible':
      return fetchCompatibleModels(config.apiKey, config.baseUrl, config.providerLabel);
    case 'gemini':
      return fetchGeminiModels(config.apiKey, config.baseUrl, config.providerLabel);
    default:
      throw new Error(`Unsupported provider: ${config.provider}`);
  }
}

async function callCompatibleText(
  config: APIConfig,
  images: ImagePayload[],
  options: GenerationOptions,
  signal?: AbortSignal
): Promise<string> {
  if (images.length > 0 && isDeepSeekOfficialCompatibleConfig(config)) {
    throw buildDeepSeekImageUnsupportedError(config);
  }

  const providerDisplayName = getProviderDisplayName(config);
  const userContent = buildCompatibleUserContent(images, options);

  const requestText = async (includeResponseFormat: boolean): Promise<string> => {
    const data = await requestCompatibleChatCompletion(
      config,
      userContent,
      options,
      signal,
      includeResponseFormat
    );

    if (typeof data.error?.message === 'string' && data.error.message.trim()) {
      const errorCode = (
        typeof data.error.code === 'string'
        || typeof data.error.code === 'number'
      )
        ? String(data.error.code).trim()
        : '';
      const codeSuffix = errorCode ? ` (code=${errorCode})` : '';
      throw new Error(`${data.error.message.trim()}${codeSuffix}`);
    }

    const choice = data.choices?.[0];
    const rawText = extractCompatibleChoiceText(choice);
    const canRetryWithoutResponseFormat = includeResponseFormat && options.responseMimeType === 'application/json';

    if (!rawText) {
      if (canRetryWithoutResponseFormat) {
        return requestText(false);
      }

      if (isLengthTruncatedCompletion(choice?.finish_reason)) {
        throw new Error(
          `${providerDisplayName} truncated the completion because finish_reason=length at max_tokens=${options.maxOutputTokens ?? 4096}.`
        );
      }
      throw buildCompatibleEmptyCompletionError(providerDisplayName, data, options);
    }

    if (isMarkdownFenceOnlyPlaceholder(rawText)) {
      if (canRetryWithoutResponseFormat) {
        return requestText(false);
      }

      throw buildCompatibleEmptyCompletionError(
        providerDisplayName,
        data,
        options,
        ['content=markdown_fence_only']
      );
    }

    const wrappedProviderError = getWrappedProviderError(rawText);
    if (wrappedProviderError) {
      throw new Error(wrappedProviderError);
    }

    if (isLengthTruncatedCompletion(choice?.finish_reason)) {
      throw new Error(
        `${providerDisplayName} truncated the completion because finish_reason=length at max_tokens=${options.maxOutputTokens ?? 4096}.`
      );
    }

    return rawText;
  };

  try {
    return await requestText(options.responseMimeType === 'application/json');
  } catch (error) {
    throw rewriteCompatibleRequestError(config, error);
  }
}

async function callGeminiText(
  config: APIConfig,
  images: ImagePayload[],
  options: GenerationOptions,
  signal?: AbortSignal
): Promise<string> {
  const providerDisplayName = getProviderDisplayName(config);
  const userParts = buildGeminiUserParts(images, options);

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
          parts: userParts,
        },
      ],
      generationConfig,
    }),
  }, `${providerDisplayName} request failed`);

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
    `${providerDisplayName} request failed`,
    'response was not valid JSON'
  );

  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error(`${providerDisplayName} returned an empty completion.`);
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
    case 'compatible':
      return callCompatibleText(config, images, options, signal);
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
