export type APIProvider = 'openrouter' | 'gemini';
export type RequestStage = Exclude<PipelineStage, 'idle'>;

export const REQUEST_STAGES: RequestStage[] = [
  'analyze-pages',
  'synthesize-chunks',
  'synthesize-story',
  'write-sections',
];

export const REQUEST_STAGE_LABELS: Record<RequestStage, string> = {
  'analyze-pages': '逐页分析',
  'synthesize-chunks': '分块综合',
  'synthesize-story': '整书综合',
  'write-sections': '章节写作',
};

export type StageModelConfig = Record<RequestStage, string>;

export interface APIConfig {
  provider: APIProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  stageModels: StageModelConfig;
}

export interface CreativeSettings {
  presetId: string;
  systemPrompt: string;
  userPromptTemplate: string;
  temperature: number;
}

export interface CreativePreset {
  id: string;
  name: string;
  prompt: string;
}

export interface ModelOption {
  id: string;
  name: string;
}

export interface ImageItem {
  id: string;
  file: File;
  previewUrl: string;
  processedBase64?: string;
  processedMime?: string;
  status: 'pending' | 'processing' | 'ready' | 'error';
  originalSize: number;
  compressedSize?: number;
}

export type ChunkStatus = 'pending' | 'processing' | 'success' | 'error' | 'skipped';

export type PipelineStage =
  | 'idle'
  | 'analyze-pages'
  | 'synthesize-chunks'
  | 'synthesize-story'
  | 'write-sections';

export interface ImageChunk {
  index: number;
  images: ImageItem[];
  status: ChunkStatus;
  novelText?: string;
  plotSummary?: string;
  endingDetail?: string;
  error?: string;
  retryCount: number;
}

export interface CharacterCue {
  name: string;
  role: string;
  traits: string[];
  relationshipHints: string[];
  evidence: string[];
}

export interface DialogueLine {
  speaker: string;
  text: string;
  speakerEvidence?: string;
  speakerConfidence?: 'high' | 'medium' | 'low';
}

export interface PageAnalysis {
  index: number;
  pageNumber: number;
  chunkIndex: number;
  imageName: string;
  status: ChunkStatus;
  summary?: string;
  location?: string;
  timeHint?: string;
  keyEvents: string[];
  characters: CharacterCue[];
  dialogue: DialogueLine[];
  narrationText: string[];
  visualText: string[];
  error?: string;
  retryCount: number;
}

export interface ChunkSynthesis {
  index: number;
  pageNumbers: number[];
  status: ChunkStatus;
  title?: string;
  summary?: string;
  keyDevelopments: string[];
  continuitySummary?: string;
  error?: string;
  retryCount: number;
}

export interface ScenePlan {
  sceneId: string;
  title: string;
  summary: string;
  chunkIndexes: number[];
}

export interface StorySynthesis {
  status: ChunkStatus;
  storyOverview: string;
  worldGuide: string;
  characterGuide: string;
  sceneOutline: ScenePlan[];
  writingConstraints: string[];
  error?: string;
  retryCount: number;
}

export interface NovelSection {
  index: number;
  title: string;
  chunkIndexes: number[];
  status: ChunkStatus;
  markdownBody?: string;
  continuitySummary?: string;
  error?: string;
  retryCount: number;
}

export interface MemoryState {
  globalSummary: string;
  previousEnding: string;
  completedChunks: number[];
}

export interface OrchestratorConfig {
  chunkSize: number;
  maxConcurrency: number;
  maxRetries: number;
  retryDelay: number;
  autoSkipOnError: boolean;
}

export interface AIResponse {
  novelText: string;
  plotSummary: string;
  endingDetail: string;
}

export interface LastAIRequest {
  provider: APIProvider;
  model: string;
  baseUrl?: string;
  stage: PipelineStage;
  itemLabel: string;
  chunkIndex: number;
  imageCount: number;
  imageNames: string[];
  systemPrompt: string;
  userPrompt: string;
  sentAt: string;
}

export interface TaskState {
  status: 'idle' | 'preparing' | 'running' | 'paused' | 'completed' | 'error';
  currentStage: PipelineStage;
  chunks: ImageChunk[];
  pageAnalyses: PageAnalysis[];
  chunkSyntheses: ChunkSynthesis[];
  globalSynthesis: StorySynthesis;
  novelSections: NovelSection[];
  memory: MemoryState;
  config: OrchestratorConfig;
  creativeSettings: CreativeSettings;
  currentChunkIndex: number;
  fullNovel: string;
  lastAIRequest?: LastAIRequest;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  chunkSize: 10,
  maxConcurrency: 3,
  maxRetries: 3,
  retryDelay: 2000,
  autoSkipOnError: false,
};

export const DEFAULT_STAGE_MODELS: StageModelConfig = {
  'analyze-pages': '',
  'synthesize-chunks': '',
  'synthesize-story': '',
  'write-sections': '',
};

export const DEFAULT_MEMORY_STATE: MemoryState = {
  globalSummary: '',
  previousEnding: '',
  completedChunks: [],
};

export const DEFAULT_STORY_SYNTHESIS: StorySynthesis = {
  status: 'pending',
  storyOverview: '',
  worldGuide: '',
  characterGuide: '',
  sceneOutline: [],
  writingConstraints: [],
  retryCount: 0,
};

export const DEFAULT_CREATIVE_SETTINGS: CreativeSettings = {
  presetId: 'professional-manga-novelist',
  systemPrompt: '',
  userPromptTemplate: '',
  temperature: 0.75,
};

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
