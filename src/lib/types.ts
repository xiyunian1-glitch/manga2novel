// ===== 核心类型定义 =====

/** 支持的 API 提供商 */
export type APIProvider = 'openrouter' | 'gemini';

/** API 配置 */
export interface APIConfig {
  provider: APIProvider;
  apiKey: string;
  model: string;
  /** 可选自定义 API URL / 透明代理地址 */
  baseUrl?: string;
}

/** 创作风格设置 */
export interface CreativeSettings {
  presetId: string;
  systemPrompt: string;
  temperature: number;
}

/** 风格预设 */
export interface CreativePreset {
  id: string;
  name: string;
  prompt: string;
}

/** 模型选项 */
export interface ModelOption {
  id: string;
  name: string;
}

/** 单张图片的状态 */
export interface ImageItem {
  id: string;
  file: File;
  /** 原始图片预览 URL (object URL) */
  previewUrl: string;
  /** 处理后的 base64 (WebP) */
  processedBase64?: string;
  /** 处理后的 MIME type */
  processedMime?: string;
  /** 处理状态 */
  status: 'pending' | 'processing' | 'ready' | 'error';
  /** 原始文件大小 */
  originalSize: number;
  /** 压缩后大小 */
  compressedSize?: number;
}

/** 分块的状态 */
export type ChunkStatus = 'pending' | 'processing' | 'success' | 'error' | 'skipped';

/** 单个分块 (一组图片) */
export interface ImageChunk {
  index: number;
  images: ImageItem[];
  status: ChunkStatus;
  /** 本块生成的小说文本 */
  novelText?: string;
  /** 本块的剧情摘要 (用于传递给下一块) */
  plotSummary?: string;
  /** 本块结尾细节 (用于传递给下一块) */
  endingDetail?: string;
  /** 错误信息 */
  error?: string;
  /** 重试次数 */
  retryCount: number;
}

/** 递归上下文状态 —— Memory Loop */
export interface MemoryState {
  /** 累积的全局剧情摘要 */
  globalSummary: string;
  /** 上一组的结尾细节 */
  previousEnding: string;
  /** 已处理的块索引 */
  completedChunks: number[];
}

/** 任务编排器的全局配置 */
export interface OrchestratorConfig {
  /** 每组图片数量，0 表示自动合并为单组 */
  chunkSize: number;
  /** 最大并发数 (建议 1，因为需要顺序维护上下文) */
  maxConcurrency: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 重试延迟 (ms) */
  retryDelay: number;
}

/** AI 返回的结构化结果 */
export interface AIResponse {
  /** 本组的小说内容 */
  novelText: string;
  /** 用于下一轮的剧情摘要 */
  plotSummary: string;
  /** 结尾细节过渡 */
  endingDetail: string;
}

/** 最近一次发给 AI 的请求快照 */
export interface LastAIRequest {
  provider: APIProvider;
  model: string;
  baseUrl?: string;
  chunkIndex: number;
  imageCount: number;
  imageNames: string[];
  systemPrompt: string;
  userPrompt: string;
  sentAt: string;
}

/** 整体任务状态 */
export interface TaskState {
  status: 'idle' | 'preparing' | 'running' | 'paused' | 'completed' | 'error';
  chunks: ImageChunk[];
  memory: MemoryState;
  config: OrchestratorConfig;
  creativeSettings: CreativeSettings;
  /** 当前处理到第几块 */
  currentChunkIndex: number;
  /** 最终输出的完整小说 */
  fullNovel: string;
  /** 最近一次实际发给 AI 的请求 */
  lastAIRequest?: LastAIRequest;
}

/** 默认配置 */
export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  chunkSize: 10,
  maxConcurrency: 1,
  maxRetries: 3,
  retryDelay: 2000,
};

export const DEFAULT_MEMORY_STATE: MemoryState = {
  globalSummary: '',
  previousEnding: '',
  completedChunks: [],
};

export const DEFAULT_CREATIVE_SETTINGS: CreativeSettings = {
  presetId: 'professional-manga-novelist',
  systemPrompt: '',
  temperature: 0.75,
};

/** 预置模型列表 */
export const OPENROUTER_MODELS: ModelOption[] = [
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
  { id: 'anthropic/claude-opus-4', name: 'Claude Opus 4' },
  { id: 'google/gemini-2.5-pro-preview', name: 'Gemini 2.5 Pro' },
  { id: 'google/gemini-2.5-flash-preview', name: 'Gemini 2.5 Flash' },
  { id: 'openai/gpt-4.1', name: 'GPT-4.1' },
];

export const GEMINI_MODELS: ModelOption[] = [
  { id: 'gemini-2.5-pro-preview-06-05', name: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
];
