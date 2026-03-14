import type {
  APIConfig,
  ChunkSynthesis,
  CharacterCue,
  ChunkStatus,
  DialogueLine,
  CreativeSettings,
  ImageChunk,
  ImageItem,
  LastAIRequest,
  NovelSection,
  OrchestratorConfig,
  PageAnalysis,
  RequestStage,
  ScenePlan,
  StorySynthesis,
  TaskState,
} from './types';
import {
  DEFAULT_CREATIVE_SETTINGS,
  DEFAULT_MEMORY_STATE,
  DEFAULT_ORCHESTRATOR_CONFIG,
  DEFAULT_STORY_SYNTHESIS,
  GEMINI_MODELS,
  OPENROUTER_MODELS,
  REQUEST_STAGE_LABELS,
} from './types';
import { processImage } from './image-pipeline';
import { callAIText, extractJsonValue } from './api-adapter';
import {
  buildContextualChunkSynthesisPrompt,
  buildContextualGlobalSynthesisPrompt,
  buildPageAnalysisPrompt,
  buildSectionSystemPrompt,
  buildSectionUserPrompt,
} from './prompts';

export type TaskEventType =
  | 'state-change'
  | 'chunk-start'
  | 'chunk-success'
  | 'chunk-error'
  | 'chunk-skip'
  | 'image-processed'
  | 'completed'
  | 'paused';

export interface TaskEvent {
  type: TaskEventType;
  state: TaskState;
  chunkIndex?: number;
  error?: string;
}

type TaskListener = (event: TaskEvent) => void;

const PAGE_ANALYSIS_SYSTEM_PROMPT = `你是专业漫画内容标注员。你的职责是基于视觉证据，客观、中性地提取画面中的剧情、角色、场景与事件线索。

规则：
1. 严格中立：仅描述画面呈现的物理事实（如：动作、体位名称、服装状态），严禁使用色情、淫秽或感官刺激类形容词。
2. 结构化提取：重点在于角色互动关系、空间布局与视觉线索。
3. 安全边界：若涉及成人内容，请以生物学或解剖学中性词汇描述，侧重于剧情转折点而非生理细节。
4. 拒绝推测：仅记录清晰可见的像素证据，不脑补遮挡部分。
5. 如果画面中存在对白、旁白、标题、字幕、拟声词或其他可识别文字，必须单独提取。
6. dialogue.text、narrationText、visualText 应尽量保留原文，不要改写成摘要。
7. 如果一次收到多页图片，必须逐页输出，保持顺序一致，不得遗漏。
8. 唯一输出：只返回 JSON`;

const CHUNK_SYNTHESIS_SYSTEM_PROMPT = `你是漫画块级综合器。
你会收到多页分析结果，请整合成稳定的块级剧情摘要和承接摘要。
规则：
1. 只根据提供的逐页分析做归纳。
2. 不要新增原分析里没有证据支撑的关键事件。
3. continuitySummary 只保留下一块写作真正需要承接的信息。
4. 只返回 JSON。`;

const GLOBAL_SYNTHESIS_SYSTEM_PROMPT = `你是整书剧情综合器。
你会收到整部漫画的块级综合结果，请归纳全书层面的故事概览、人物关系、世界信息、场景大纲和写作约束。
规则：
1. sceneOutline 必须覆盖已给出的块，chunkIndexes 只能引用已有块编号。
2. 如果难以拆分复杂场景，可以一块对应一场。
3. 只保留会影响后续写作一致性的总结。
4. 只返回 JSON。`;

const PAGE_ANALYSIS_TEMPERATURE = 0.2;
const SYNTHESIS_TEMPERATURE = 0.2;
const PAGE_ANALYSIS_MAX_TOKENS = 1024;
const SYNTHESIS_MAX_TOKENS = 4096;
const WRITING_MAX_TOKENS = 2500;
const PAGE_ANALYSIS_BATCH_TIMEOUT_MS = 90_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }

  return [];
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === 'number' && Number.isFinite(item)) {
        return Math.trunc(item);
      }
      if (typeof item === 'string' && item.trim()) {
        const parsed = Number(item);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : Number.NaN;
      }
      return Number.NaN;
    })
    .filter((item) => Number.isFinite(item));
}

function normalizeChunkIndexes(indexes: number[], chunkCount: number): number[] {
  const maxIndex = Math.max(chunkCount - 1, 0);
  const normalized = indexes
    .filter((index) => index >= 0 && index <= maxIndex)
    .sort((left, right) => left - right);
  return Array.from(new Set(normalized));
}

function normalizeCharacterCue(value: unknown): CharacterCue {
  const record = isRecord(value) ? value : {};
  return {
    name: toString(record.name, '未知角色'),
    role: toString(record.role, '未说明'),
    traits: toStringArray(record.traits),
    relationshipHints: toStringArray(record.relationshipHints),
    evidence: toStringArray(record.evidence),
  };
}

function normalizeDialogueLine(value: unknown): DialogueLine {
  if (typeof value === 'string') {
    return {
      speaker: '未确认',
      text: value.trim(),
    };
  }

  const record = isRecord(value) ? value : {};
  const speakerConfidence = (() => {
    const rawValue = toString(record.speakerConfidence ?? record.speaker_confidence).toLowerCase();
    if (rawValue === 'high' || rawValue === 'medium' || rawValue === 'low') {
      return rawValue;
    }
    return undefined;
  })();

  return {
    speaker: toString(record.speaker, '未确认'),
    text: toString(record.text),
    speakerEvidence: toString(record.speakerEvidence ?? record.speaker_evidence),
    speakerConfidence,
  };
}

function sanitizeDialogueAssignments(
  dialogue: DialogueLine[],
  characters: CharacterCue[]
): DialogueLine[] {
  const namedCharacters = new Set(
    characters
      .map((character) => character.name.trim())
      .filter((name) => Boolean(name) && name !== '未知角色')
  );

  return dialogue.map((line) => {
    const speaker = line.speaker.trim();
    const isUnknownSpeaker = !speaker || /^(未知|未确认|不确定)$/u.test(speaker);
    const hasSpeakerEvidence = Boolean(line.speakerEvidence?.trim());

    if (line.speakerConfidence === 'low') {
      return {
        ...line,
        speaker: '未确认',
      };
    }

    if (!isUnknownSpeaker && namedCharacters.size > 0 && !namedCharacters.has(speaker)) {
      return {
        ...line,
        speaker: '未确认',
      };
    }

    if (!isUnknownSpeaker && namedCharacters.size > 1 && (!hasSpeakerEvidence || line.speakerConfidence !== 'high')) {
      return {
        ...line,
        speaker: '未确认',
      };
    }

    return line;
  });
}

type ParsedPageAnalysis = Pick<PageAnalysis, 'summary' | 'location' | 'timeHint' | 'keyEvents' | 'characters' | 'dialogue' | 'narrationText' | 'visualText'> & {
  pageNumber: number;
};

function normalizePageAnalysisResult(value: unknown, fallbackPageNumber: number): ParsedPageAnalysis {
  const parsed = isRecord(value) ? value : {};
  const pageNumberValue = parsed.pageNumber;
  const parsedPageNumber = typeof pageNumberValue === 'number'
    ? Math.trunc(pageNumberValue)
    : typeof pageNumberValue === 'string' && pageNumberValue.trim()
      ? Number(pageNumberValue)
      : Number.NaN;
  const normalizedCharacters = Array.isArray(parsed.characters)
    ? parsed.characters.map((character) => normalizeCharacterCue(character))
    : [];
  const normalizedDialogue = Array.isArray(parsed.dialogue)
    ? sanitizeDialogueAssignments(
        parsed.dialogue
          .map((line) => normalizeDialogueLine(line))
          .filter((line) => line.text),
        normalizedCharacters
      )
    : [];

  return {
    pageNumber: Number.isFinite(parsedPageNumber) ? Math.trunc(parsedPageNumber) : fallbackPageNumber,
    summary: toString(parsed.summary),
    location: toString(parsed.location, '未知'),
    timeHint: toString(parsed.timeHint, '未知'),
    keyEvents: toStringArray(parsed.keyEvents),
    characters: normalizedCharacters,
    dialogue: normalizedDialogue,
    narrationText: toStringArray(parsed.narrationText ?? parsed.narration_text),
    visualText: toStringArray(parsed.visualText ?? parsed.visual_text),
  };
}

function parseChunkPageAnalysisResult(rawText: string, expectedPages: PageAnalysis[]): ParsedPageAnalysis[] {
  const parsed = extractJsonValue<unknown>(rawText);
  const rawPages = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.pages)
      ? parsed.pages
      : null;

  if (!rawPages) {
    throw new Error('The page analyzer did not return a pages array.');
  }

  if (rawPages.length !== expectedPages.length) {
    throw new Error(`The page analyzer returned ${rawPages.length} pages, expected ${expectedPages.length}.`);
  }

  const normalizedPages = rawPages.map((page, index) => (
    normalizePageAnalysisResult(page, expectedPages[index]?.pageNumber ?? index + 1)
  ));
  const pageByNumber = new Map(normalizedPages.map((page) => [page.pageNumber, page]));

  return expectedPages.map((page, index) => (
    pageByNumber.get(page.pageNumber) ?? normalizedPages[index]
  ));
}

function parseChunkSynthesisResult(rawText: string): Pick<ChunkSynthesis, 'title' | 'summary' | 'keyDevelopments' | 'continuitySummary'> {
  const parsed = extractJsonValue<Record<string, unknown>>(rawText);

  return {
    title: toString(parsed.title),
    summary: toString(parsed.summary),
    keyDevelopments: toStringArray(parsed.keyDevelopments),
    continuitySummary: toString(parsed.continuitySummary),
  };
}

function parseStorySynthesisResult(rawText: string, chunkCount: number): Pick<StorySynthesis, 'storyOverview' | 'worldGuide' | 'characterGuide' | 'sceneOutline' | 'writingConstraints'> {
  const parsed = extractJsonValue<Record<string, unknown>>(rawText);
  const rawSceneOutline = Array.isArray(parsed.sceneOutline) ? parsed.sceneOutline : [];
  const sceneOutline = rawSceneOutline
    .map((item, index) => {
      const record = isRecord(item) ? item : {};
      const chunkIndexes = normalizeChunkIndexes(toNumberArray(record.chunkIndexes), chunkCount);

      return {
        sceneId: toString(record.sceneId, `scene-${index + 1}`),
        title: toString(record.title, `第 ${index + 1} 节`),
        summary: toString(record.summary),
        chunkIndexes,
      };
    })
    .filter((scene) => scene.chunkIndexes.length > 0);

  return {
    storyOverview: toString(parsed.storyOverview),
    worldGuide: toString(parsed.worldGuide),
    characterGuide: toString(parsed.characterGuide),
    sceneOutline,
    writingConstraints: toStringArray(parsed.writingConstraints),
  };
}

function parseSectionResult(rawText: string): { novelText: string; continuitySummary: string } {
  try {
    const parsed = extractJsonValue<Record<string, unknown>>(rawText);
    const novelText = toString(parsed.novelText);

    if (!novelText) {
      throw new Error('The section writer returned JSON without novelText.');
    }

    return {
      novelText,
      continuitySummary: toString(parsed.continuitySummary),
    };
  } catch {
    return {
      novelText: rawText.trim(),
      continuitySummary: '',
    };
  }
}

function createFallbackChunkSynthesis(index: number, pageAnalyses: PageAnalysis[]): Pick<ChunkSynthesis, 'title' | 'summary' | 'keyDevelopments' | 'continuitySummary'> {
  const summaries = pageAnalyses
    .map((page) => page.summary)
    .filter((summary): summary is string => Boolean(summary));
  const keyDevelopments = pageAnalyses.flatMap((page) => page.keyEvents).filter(Boolean);
  const summary = summaries.join(' ').trim();

  return {
    title: `第 ${index + 1} 块`,
    summary: summary || `第 ${index + 1} 块缺少足够的逐页分析数据。`,
    keyDevelopments: keyDevelopments.length > 0 ? keyDevelopments : ['缺少可靠事件提取'],
    continuitySummary: summary || '缺少可靠承接信息',
  };
}

function createFallbackStorySynthesis(chunkSyntheses: ChunkSynthesis[]): Pick<StorySynthesis, 'storyOverview' | 'worldGuide' | 'characterGuide' | 'sceneOutline' | 'writingConstraints'> {
  const availableChunks = chunkSyntheses.filter((chunk) => chunk.status === 'success' || chunk.status === 'skipped');
  const storyOverview = availableChunks
    .map((chunk) => chunk.summary)
    .filter((summary): summary is string => Boolean(summary))
    .join(' ')
    .trim();

  const sceneOutline = availableChunks.map((chunk) => ({
    sceneId: `scene-${chunk.index + 1}`,
    title: chunk.title || `第 ${chunk.index + 1} 节`,
    summary: chunk.summary || `第 ${chunk.index + 1} 块缺少稳定摘要。`,
    chunkIndexes: [chunk.index],
  }));

  return {
    storyOverview: storyOverview || '未能生成稳定的全书概览，将按块直接写作。',
    worldGuide: '未提取到稳定世界观信息。',
    characterGuide: '未提取到稳定人物关系信息。',
    sceneOutline,
    writingConstraints: ['严格依据已提取的块级资料写作，不补充无依据关键事件。'],
  };
}

function createSectionsFromSceneOutline(sceneOutline: ScenePlan[], chunkSyntheses: ChunkSynthesis[]): NovelSection[] {
  const fallbackSections = chunkSyntheses.map((chunk) => ({
    index: chunk.index,
    title: chunk.title || `第 ${chunk.index + 1} 节`,
    chunkIndexes: [chunk.index],
    status: 'pending' as ChunkStatus,
    retryCount: 0,
  }));

  if (sceneOutline.length === 0) {
    return fallbackSections;
  }

  return sceneOutline.map((scene, index) => ({
    index,
    title: scene.title || `第 ${index + 1} 节`,
    chunkIndexes: scene.chunkIndexes.length > 0 ? scene.chunkIndexes : fallbackSections[index]?.chunkIndexes || [index],
    status: 'pending',
    retryCount: 0,
  }));
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function cloneGlobalSynthesis(value: StorySynthesis): StorySynthesis {
  return {
    ...value,
    sceneOutline: value.sceneOutline.map((scene) => ({ ...scene, chunkIndexes: [...scene.chunkIndexes] })),
    writingConstraints: [...value.writingConstraints],
  };
}

interface ModelRequest {
  stage: RequestStage;
  itemLabel: string;
  chunkIndex: number;
  imageNames: string[];
  images: Array<{ base64: string; mime: string }>;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxOutputTokens: number;
}

interface RetryTarget {
  retryCount: number;
  error?: string;
}

function parseMaxTokenLimitError(message: string): { requestedTotal: number; maxSeqLen: number } | null {
  const match = message.match(/max_total_tokens\s*\((\d+)\)\s*must be less than or equal to max_seq_len\s*\((\d+)\)/i);
  if (!match) {
    return null;
  }

  const requestedTotal = Number(match[1]);
  const maxSeqLen = Number(match[2]);
  if (!Number.isFinite(requestedTotal) || !Number.isFinite(maxSeqLen)) {
    return null;
  }

  return { requestedTotal, maxSeqLen };
}

function isInputTokenLimitError(message: string): boolean {
  return /prompt_tokens\s*\(\d+\)\s*must be less than max_seq_len\s*\(\d+\)/i.test(message);
}

function isCapacityAvailabilityError(message: string): boolean {
  return /no capacity available for model|model .* is at capacity|currently at capacity|capacity unavailable|server is busy|overloaded/i.test(message);
}

function isRetryableModelAvailabilityError(message: string): boolean {
  return isCapacityAvailabilityError(message)
    || /model .* not found|unknown model|unsupported model|no such model|does not exist|model .* unavailable|not available on the server/i.test(message);
}

function normalizeModelIdentifier(model: string): string {
  return model.trim().toLowerCase().replace(/^models\//, '');
}

function stripVendorPrefix(model: string): string {
  return model.replace(/^[^/]+\//, '');
}

function normalizeComparableModelId(model: string): string {
  return normalizeModelIdentifier(stripVendorPrefix(model));
}

function getModelFamily(model: string): string {
  const comparableId = normalizeComparableModelId(model);
  const knownFamilies = ['gemini', 'claude', 'gpt', 'o1', 'o3', 'llama', 'qwen', 'deepseek', 'mistral'];
  return knownFamilies.find((family) => comparableId.includes(family))
    || comparableId.split(/[-_.:/]/).find(Boolean)
    || comparableId;
}

function hasModelTrait(model: string, trait: string): boolean {
  const comparableId = normalizeComparableModelId(model);
  return new RegExp(`(?:^|[-_.:/])${trait}(?:$|[-_.:/])`, 'i').test(comparableId);
}

function getProviderFallbackCatalog(provider: APIConfig['provider']): string[] {
  if (provider === 'gemini') {
    return GEMINI_MODELS.map((model) => model.id);
  }

  return OPENROUTER_MODELS.flatMap((model) => {
    const stripped = stripVendorPrefix(model.id);
    return stripped === model.id ? [model.id] : [model.id, stripped];
  });
}

function scoreFallbackCandidate(candidate: string, primary: string): number {
  const comparableCandidate = normalizeComparableModelId(candidate);
  const comparablePrimary = normalizeComparableModelId(primary);

  let score = 0;

  if (getModelFamily(candidate) === getModelFamily(primary)) {
    score += 100;
  }

  for (const trait of ['pro', 'flash', 'sonnet', 'opus', 'mini', 'nano']) {
    if (hasModelTrait(candidate, trait) && hasModelTrait(primary, trait)) {
      score += 18;
    }
  }

  if (hasModelTrait(candidate, 'preview') && hasModelTrait(primary, 'preview')) {
    score += 8;
  }

  if (candidate.includes('/') === primary.includes('/')) {
    score += 6;
  }

  if (comparableCandidate === comparablePrimary) {
    score += 40;
  }

  if (comparableCandidate.startsWith(getModelFamily(primary))) {
    score += 10;
  }

  return score;
}

function isPageAnalysisConnectionError(message: string): boolean {
  return /failed to fetch|network request could not reach|net::err_connection_closed|err_connection_closed|net::err_connection_reset|err_connection_reset|socket hang up|connection (?:closed|reset)|other side closed|unexpected eof|econnreset|econnaborted|deadline exceeded|timed? out|timeout/i.test(message);
}

function isBrowserReachabilityError(message: string): boolean {
  return /network request could not reach|direct browser request could not reach|local fallback proxy .* unreachable|request failed before it reached the upstream model|request never reached the upstream model/i.test(message);
}

function createRequestSignal(
  sourceSignal: AbortSignal | undefined,
  timeoutMs: number | null
): {
  signal: AbortSignal | undefined;
  cancel: () => void;
  didTimeout: () => boolean;
} {
  if ((!sourceSignal || sourceSignal.aborted === false) && (!timeoutMs || timeoutMs <= 0)) {
    return {
      signal: sourceSignal,
      cancel: () => {},
      didTimeout: () => false,
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const handleSourceAbort = () => controller.abort();

  if (sourceSignal) {
    if (sourceSignal.aborted) {
      controller.abort();
    } else {
      sourceSignal.addEventListener('abort', handleSourceAbort, { once: true });
    }
  }

  if (timeoutMs && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    cancel: () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      if (sourceSignal && !sourceSignal.aborted) {
        sourceSignal.removeEventListener('abort', handleSourceAbort);
      }
    },
    didTimeout: () => timedOut,
  };
}

function shouldSplitPageAnalysisBatch(message: string): boolean {
  return (
    /max_seq_len|prompt_tokens|context length|input (?:is )?too (?:long|large)|too many images?/i.test(message)
    || /malformed json|did not return valid json|did not return a pages array|returned \d+ pages, expected \d+/i.test(message)
    || (isPageAnalysisConnectionError(message) && !isBrowserReachabilityError(message))
  );
}

export class TaskOrchestrator {
  private state: TaskState;
  private apiConfig: APIConfig | null = null;
  private listeners: Set<TaskListener> = new Set();
  private abortController: AbortController | null = null;
  private isPaused = false;

  constructor(config?: Partial<OrchestratorConfig>) {
    this.state = {
      status: 'idle',
      currentStage: 'idle',
      chunks: [],
      pageAnalyses: [],
      chunkSyntheses: [],
      globalSynthesis: cloneGlobalSynthesis(DEFAULT_STORY_SYNTHESIS),
      novelSections: [],
      memory: { ...DEFAULT_MEMORY_STATE },
      config: { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config },
      creativeSettings: { ...DEFAULT_CREATIVE_SETTINGS },
      currentChunkIndex: -1,
      fullNovel: '',
      lastAIRequest: undefined,
    };
  }

  on(listener: TaskListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(type: TaskEventType, chunkIndex?: number, error?: string) {
    const event: TaskEvent = {
      type,
      state: this.getState(),
      chunkIndex,
      error,
    };

    this.listeners.forEach((listener) => listener(event));
  }

  getState(): TaskState {
    return {
      ...this.state,
      chunks: this.state.chunks.map((chunk) => ({ ...chunk, images: [...chunk.images] })),
      pageAnalyses: this.state.pageAnalyses.map((page) => ({
        ...page,
        keyEvents: [...page.keyEvents],
        dialogue: page.dialogue.map((line) => ({ ...line })),
        narrationText: [...page.narrationText],
        visualText: [...page.visualText],
        characters: page.characters.map((character) => ({
          ...character,
          traits: [...character.traits],
          relationshipHints: [...character.relationshipHints],
          evidence: [...character.evidence],
        })),
      })),
      chunkSyntheses: this.state.chunkSyntheses.map((chunk) => ({
        ...chunk,
        pageNumbers: [...chunk.pageNumbers],
        keyDevelopments: [...chunk.keyDevelopments],
      })),
      globalSynthesis: cloneGlobalSynthesis(this.state.globalSynthesis),
      novelSections: this.state.novelSections.map((section) => ({
        ...section,
        chunkIndexes: [...section.chunkIndexes],
      })),
      memory: { ...this.state.memory },
      config: { ...this.state.config },
      creativeSettings: { ...this.state.creativeSettings },
    };
  }

  setAPIConfig(config: APIConfig) {
    this.apiConfig = config;
  }

  updateConfig(config: Partial<OrchestratorConfig>) {
    this.state.config = { ...this.state.config, ...config };
  }

  updateCreativeSettings(settings: Partial<CreativeSettings>) {
    this.state.creativeSettings = {
      ...this.state.creativeSettings,
      ...settings,
    };
  }

  private getReadyImagesInOrder(): ImageItem[] {
    return this.state.chunks.flatMap((chunk) => chunk.images);
  }

  private refreshFullNovel() {
    this.state.fullNovel = this.state.novelSections
      .filter((section) => section.status === 'success' && section.markdownBody)
      .map((section) => section.markdownBody!.trim())
      .filter(Boolean)
      .join('\n\n');
  }

  private findPreviousContinuitySummary(sectionIndex: number): string {
    for (let index = sectionIndex - 1; index >= 0; index -= 1) {
      const section = this.state.novelSections[index];
      if (section?.continuitySummary) {
        return section.continuitySummary;
      }
    }
    return '';
  }

  private initializeSectionsFromGlobalSynthesis() {
    const sections = createSectionsFromSceneOutline(
      this.state.globalSynthesis.sceneOutline,
      this.state.chunkSyntheses
    );

    this.state.novelSections = sections.map((section, index) => {
      const existing = this.state.novelSections[index];
      if (!existing) {
        return section;
      }

      return {
        ...section,
        status: existing.status,
        markdownBody: existing.markdownBody,
        continuitySummary: existing.continuitySummary,
        error: existing.error,
        retryCount: existing.retryCount,
      };
    });

    this.refreshFullNovel();
  }

  private resolveModelForStage(stage: RequestStage): string {
    const stageModel = this.apiConfig?.stageModels[stage]?.trim() || '';
    const defaultModel = this.apiConfig?.model?.trim() || '';
    const resolvedModel = stageModel || defaultModel;

    if (!resolvedModel) {
      throw new Error(`Missing model for stage ${REQUEST_STAGE_LABELS[stage]}.`);
    }

    return resolvedModel;
  }

  private resolveModelCandidatesForStage(stage: RequestStage): string[] {
    const primaryModel = this.resolveModelForStage(stage);
    const defaultModel = this.apiConfig?.model?.trim() || '';
    const catalogCandidates = getProviderFallbackCatalog(this.apiConfig?.provider || 'openrouter')
      .filter((candidate) => normalizeModelIdentifier(candidate) !== normalizeModelIdentifier(primaryModel))
      .sort((left, right) => scoreFallbackCandidate(right, primaryModel) - scoreFallbackCandidate(left, primaryModel));

    const candidates = [
      primaryModel,
      ...(defaultModel ? [defaultModel] : []),
      ...catalogCandidates,
    ];

    const seen = new Set<string>();
    return candidates.filter((candidate) => {
      const normalized = normalizeModelIdentifier(candidate);
      if (!normalized || seen.has(normalized)) {
        return false;
      }

      seen.add(normalized);
      return true;
    });
  }

  private shouldAutoSkipOnError(): boolean {
    return this.state.config.autoSkipOnError;
  }

  private getMaxConcurrency(): number {
    const configured = Math.trunc(this.state.config.maxConcurrency);
    if (!Number.isFinite(configured)) {
      return 1;
    }

    return Math.max(1, configured);
  }

  private getPageAnalysisMaxTokens(pageCount: number): number {
    return Math.min(12288, Math.max(PAGE_ANALYSIS_MAX_TOKENS, 512 + pageCount * 384));
  }

  private getRequestTimeoutMs(request: ModelRequest): number | null {
    if (request.stage === 'analyze-pages' && request.imageNames.length > 1) {
      return PAGE_ANALYSIS_BATCH_TIMEOUT_MS;
    }

    return null;
  }

  private getPageAnalysesForChunk(chunkIndex: number): PageAnalysis[] {
    return this.state.pageAnalyses.filter((page) => page.chunkIndex === chunkIndex);
  }

  private getFirstPageAnalysisIndexForChunk(chunkIndex: number): number {
    return this.state.pageAnalyses.findIndex((page) => page.chunkIndex === chunkIndex);
  }

  private findNextPendingPageAnalysisChunkIndex(startChunkIndex = 0): number {
    for (let chunkIndex = Math.max(0, startChunkIndex); chunkIndex < this.state.chunks.length; chunkIndex += 1) {
      const pages = this.getPageAnalysesForChunk(chunkIndex);
      if (pages.some((page) => page.status !== 'success' && page.status !== 'skipped')) {
        return chunkIndex;
      }
    }

    return -1;
  }

  private resetProcessingPageAnalysesToPending() {
    this.state.pageAnalyses.forEach((pageAnalysis) => {
      if (pageAnalysis.status === 'processing') {
        pageAnalysis.status = 'pending';
      }
    });
  }

  private applySkippedPageAnalysisChunk(chunkIndex: number, errorMessage: string) {
    const pageAnalyses = this.getPageAnalysesForChunk(chunkIndex);
    if (pageAnalyses.length === 0) {
      return;
    }

    pageAnalyses.forEach((pageAnalysis) => {
      pageAnalysis.status = 'skipped';
      pageAnalysis.error = errorMessage;
    });

    this.emit('chunk-error', chunkIndex, errorMessage);
    this.emit('chunk-skip', chunkIndex);
  }

  private async analyzePageBatch(
    chunkIndex: number,
    pageBatch: PageAnalysis[],
    readyImages: ImageItem[]
  ): Promise<void> {
    const chunkImages = pageBatch.map((pageAnalysis) => {
      const image = readyImages[pageAnalysis.index];
      return {
        pageNumber: pageAnalysis.pageNumber,
        image,
      };
    });
    const missingImage = chunkImages.find((item) => !item.image?.processedBase64 || !item.image?.processedMime);

    if (missingImage) {
      throw new Error(`Missing processed image data for page ${missingImage.pageNumber}.`);
    }

    const retryTarget: RetryTarget = {
      retryCount: pageBatch.reduce((maxRetryCount, pageAnalysis) => (
        Math.max(maxRetryCount, pageAnalysis.retryCount)
      ), 0),
    };
    const firstPageNumber = pageBatch[0]?.pageNumber ?? 1;
    const lastPageNumber = pageBatch[pageBatch.length - 1]?.pageNumber ?? firstPageNumber;

    try {
      const results = await this.requestStructuredData(
        retryTarget,
        {
          stage: 'analyze-pages',
          itemLabel: `第 ${chunkIndex + 1} 块（第 ${firstPageNumber}-${lastPageNumber} 页）`,
          chunkIndex,
          imageNames: pageBatch.map((pageAnalysis) => pageAnalysis.imageName),
          images: chunkImages.map((item) => ({
            base64: item.image!.processedBase64!,
            mime: item.image!.processedMime!,
          })),
          systemPrompt: PAGE_ANALYSIS_SYSTEM_PROMPT,
          userPrompt: buildPageAnalysisPrompt(chunkIndex, pageBatch, this.state.pageAnalyses.length),
          temperature: PAGE_ANALYSIS_TEMPERATURE,
          maxOutputTokens: this.getPageAnalysisMaxTokens(pageBatch.length),
        },
        (rawText) => parseChunkPageAnalysisResult(rawText, pageBatch)
      );

      pageBatch.forEach((pageAnalysis, index) => {
        const result = results[index];
        pageAnalysis.summary = result.summary;
        pageAnalysis.location = result.location;
        pageAnalysis.timeHint = result.timeHint;
        pageAnalysis.keyEvents = result.keyEvents;
        pageAnalysis.characters = result.characters;
        pageAnalysis.dialogue = result.dialogue;
        pageAnalysis.narrationText = result.narrationText;
        pageAnalysis.visualText = result.visualText;
        pageAnalysis.status = 'success';
        pageAnalysis.retryCount = retryTarget.retryCount;
        pageAnalysis.error = undefined;
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      if (pageBatch.length > 1 && shouldSplitPageAnalysisBatch(errorMessage)) {
        const midpoint = Math.ceil(pageBatch.length / 2);
        await this.analyzePageBatch(chunkIndex, pageBatch.slice(0, midpoint), readyImages);
        await this.analyzePageBatch(chunkIndex, pageBatch.slice(midpoint), readyImages);
        return;
      }

      pageBatch.forEach((pageAnalysis) => {
        pageAnalysis.status = 'error';
        pageAnalysis.error = errorMessage;
        pageAnalysis.retryCount = retryTarget.retryCount;
      });
      throw error;
    }
  }

  private applySkippedChunkSynthesis(index: number, errorMessage: string) {
    const chunkSynthesis = this.state.chunkSyntheses[index];
    if (!chunkSynthesis) {
      return;
    }

    const fallback = createFallbackChunkSynthesis(
      chunkSynthesis.index,
      this.state.pageAnalyses.filter((page) => page.chunkIndex === chunkSynthesis.index)
    );

    chunkSynthesis.title = fallback.title;
    chunkSynthesis.summary = fallback.summary;
    chunkSynthesis.keyDevelopments = fallback.keyDevelopments;
    chunkSynthesis.continuitySummary = fallback.continuitySummary;
    chunkSynthesis.status = 'skipped';
    chunkSynthesis.error = errorMessage;
    this.state.chunks[index].status = 'skipped';
    this.state.chunks[index].plotSummary = fallback.summary;
    this.state.chunks[index].endingDetail = fallback.continuitySummary;
    this.state.chunks[index].error = errorMessage;
    this.emit('chunk-error', index, errorMessage);
    this.emit('chunk-skip', index);
  }

  private applySkippedStorySynthesis(errorMessage: string) {
    const fallback = createFallbackStorySynthesis(this.state.chunkSyntheses);
    this.state.globalSynthesis = {
      ...this.state.globalSynthesis,
      ...fallback,
      status: 'skipped',
      error: errorMessage,
    };
    this.state.memory.globalSummary = fallback.storyOverview;
    this.initializeSectionsFromGlobalSynthesis();
    this.emit('chunk-error', 0, errorMessage);
    this.emit('chunk-skip', 0);
  }

  private applySkippedSection(index: number, errorMessage: string) {
    const section = this.state.novelSections[index];
    if (!section) {
      return;
    }

    section.status = 'skipped';
    section.error = errorMessage;
    this.refreshFullNovel();
    this.emit('chunk-error', index, errorMessage);
    this.emit('chunk-skip', index);
  }

  private resetGlobalSynthesisAndSections() {
    this.state.globalSynthesis = cloneGlobalSynthesis(DEFAULT_STORY_SYNTHESIS);
    this.state.novelSections = [];
    this.state.memory = { ...DEFAULT_MEMORY_STATE };
    this.state.fullNovel = '';
  }

  private resetPageAnalysesFrom(startIndex: number) {
    for (let index = startIndex; index < this.state.pageAnalyses.length; index += 1) {
      const page = this.state.pageAnalyses[index];
      page.status = 'pending';
      page.summary = undefined;
      page.location = undefined;
      page.timeHint = undefined;
      page.keyEvents = [];
      page.dialogue = [];
      page.narrationText = [];
      page.visualText = [];
      page.characters = [];
      page.error = undefined;
      page.retryCount = 0;
    }
    this.resetGlobalSynthesisAndSections();
    this.state.chunkSyntheses.forEach((chunk, index) => {
      chunk.status = 'pending';
      chunk.title = undefined;
      chunk.summary = undefined;
      chunk.keyDevelopments = [];
      chunk.continuitySummary = undefined;
      chunk.error = undefined;
      chunk.retryCount = 0;
      this.state.chunks[index].status = 'pending';
      this.state.chunks[index].plotSummary = undefined;
      this.state.chunks[index].endingDetail = undefined;
      this.state.chunks[index].error = undefined;
    });
  }

  private resetChunkSynthesesFrom(startIndex: number) {
    for (let index = startIndex; index < this.state.chunkSyntheses.length; index += 1) {
      const chunk = this.state.chunkSyntheses[index];
      chunk.status = 'pending';
      chunk.title = undefined;
      chunk.summary = undefined;
      chunk.keyDevelopments = [];
      chunk.continuitySummary = undefined;
      chunk.error = undefined;
      chunk.retryCount = 0;
      this.state.chunks[index].status = 'pending';
      this.state.chunks[index].plotSummary = undefined;
      this.state.chunks[index].endingDetail = undefined;
      this.state.chunks[index].error = undefined;
    }
    this.resetGlobalSynthesisAndSections();
  }

  private resetSectionsFrom(startIndex: number) {
    for (let index = startIndex; index < this.state.novelSections.length; index += 1) {
      const section = this.state.novelSections[index];
      section.status = 'pending';
      section.markdownBody = undefined;
      section.continuitySummary = undefined;
      section.error = undefined;
      section.retryCount = 0;
    }
    this.refreshFullNovel();
    this.state.memory.completedChunks = this.state.novelSections
      .slice(0, startIndex)
      .filter((section) => section.status === 'success')
      .map((section) => section.index);
    this.state.memory.previousEnding = this.findPreviousContinuitySummary(startIndex);
    this.state.memory.globalSummary = this.state.globalSynthesis.storyOverview;
  }

  async prepare(images: ImageItem[]): Promise<void> {
    this.state.status = 'preparing';
    this.state.currentStage = 'idle';
    this.emit('state-change');

    const workerCount = Math.min(this.getMaxConcurrency(), Math.max(images.length, 1));
    let nextImageIndex = 0;

    const processNextImage = async () => {
      while (true) {
        const currentIndex = nextImageIndex;
        nextImageIndex += 1;

        if (currentIndex >= images.length) {
          return;
        }

        const image = images[currentIndex];
        if (image.status === 'ready') {
          continue;
        }

        try {
          image.status = 'processing';
          const result = await processImage(image.file);
          image.processedBase64 = result.base64;
          image.processedMime = result.mime;
          image.compressedSize = result.compressedSize;
          image.status = 'ready';
        } catch {
          image.status = 'error';
        }

        this.emit('image-processed');
      }
    };

    await Promise.all(
      Array.from({ length: workerCount }, () => processNextImage())
    );

    const readyImages = images.filter((image) => image.status === 'ready');
    const normalizedChunkSize = this.state.config.chunkSize <= 0
      ? Math.max(readyImages.length, 1)
      : this.state.config.chunkSize;

    const chunks: ImageChunk[] = [];
    for (let index = 0; index < readyImages.length; index += normalizedChunkSize) {
      chunks.push({
        index: chunks.length,
        images: readyImages.slice(index, index + normalizedChunkSize),
        status: 'pending',
        retryCount: 0,
      });
    }

    const pageAnalyses: PageAnalysis[] = [];
    chunks.forEach((chunk) => {
      chunk.images.forEach((image) => {
        pageAnalyses.push({
          index: pageAnalyses.length,
          pageNumber: pageAnalyses.length + 1,
          chunkIndex: chunk.index,
          imageName: image.file.webkitRelativePath || image.file.name,
          status: 'pending',
          keyEvents: [],
          dialogue: [],
          narrationText: [],
          visualText: [],
          characters: [],
          retryCount: 0,
        });
      });
    });

    const chunkSyntheses: ChunkSynthesis[] = chunks.map((chunk) => ({
      index: chunk.index,
      pageNumbers: pageAnalyses
        .filter((page) => page.chunkIndex === chunk.index)
        .map((page) => page.pageNumber),
      status: 'pending',
      keyDevelopments: [],
      retryCount: 0,
    }));

    this.state.chunks = chunks;
    this.state.pageAnalyses = pageAnalyses;
    this.state.chunkSyntheses = chunkSyntheses;
    this.state.globalSynthesis = cloneGlobalSynthesis(DEFAULT_STORY_SYNTHESIS);
    this.state.novelSections = [];
    this.state.memory = { ...DEFAULT_MEMORY_STATE };
    this.state.currentStage = pageAnalyses.length > 0 ? 'analyze-pages' : 'idle';
    this.state.currentChunkIndex = pageAnalyses.length > 0 ? 0 : -1;
    this.state.fullNovel = '';
    this.state.status = 'idle';
    this.emit('state-change');
  }

  async run(): Promise<void> {
    if (!this.apiConfig) {
      throw new Error('Please configure the API first.');
    }

    if (this.state.chunks.length === 0) {
      throw new Error('Please add images first.');
    }

    this.state.status = 'running';
    this.isPaused = false;
    this.abortController = new AbortController();
    this.emit('state-change');

    if (this.state.currentStage === 'idle') {
      this.state.currentStage = 'analyze-pages';
      this.state.currentChunkIndex = 0;
    }

    if (this.state.currentStage === 'analyze-pages') {
      const completed = await this.runPageAnalysisStage();
      if (!completed) {
        return;
      }
      this.state.currentStage = 'synthesize-chunks';
      this.state.currentChunkIndex = 0;
      this.emit('state-change');
    }

    if (this.state.currentStage === 'synthesize-chunks') {
      const completed = await this.runChunkSynthesisStage();
      if (!completed) {
        return;
      }
      this.state.currentStage = 'synthesize-story';
      this.state.currentChunkIndex = 0;
      this.emit('state-change');
    }

    if (this.state.currentStage === 'synthesize-story') {
      const completed = await this.runStorySynthesisStage();
      if (!completed) {
        return;
      }
      this.state.currentStage = 'write-sections';
      this.state.currentChunkIndex = 0;
      this.emit('state-change');
    }

    if (this.state.currentStage === 'write-sections') {
      const completed = await this.runSectionWritingStage();
      if (!completed) {
        return;
      }
    }

    this.state.status = 'completed';
    this.state.currentStage = 'idle';
    this.abortController = null;
    this.emit('completed');
  }

  private async runPageAnalysisStage(): Promise<boolean> {
    const readyImages = this.getReadyImagesInOrder();

    const pendingChunkIndexes: number[] = [];

    for (let chunkIndex = this.state.currentChunkIndex; chunkIndex < this.state.chunks.length; chunkIndex += 1) {
      const chunkPages = this.getPageAnalysesForChunk(chunkIndex);
      if (chunkPages.length === 0 || chunkPages.every((page) => page.status === 'success' || page.status === 'skipped')) {
        continue;
      }
      pendingChunkIndexes.push(chunkIndex);
    }

    if (pendingChunkIndexes.length === 0) {
      return true;
    }

    const workerCount = Math.min(this.getMaxConcurrency(), pendingChunkIndexes.length);
    let nextPendingIndex = 0;
    const fatalErrorRef: { current: { index: number; message: string } | null } = { current: null };

    const runNextChunkAnalysis = async () => {
      while (!this.isPaused && fatalErrorRef.current === null) {
        const queueIndex = nextPendingIndex;
        nextPendingIndex += 1;

        if (queueIndex >= pendingChunkIndexes.length) {
          return;
        }

        const chunkIndex = pendingChunkIndexes[queueIndex];
        const chunkPages = this.getPageAnalysesForChunk(chunkIndex);
        if (chunkPages.length === 0 || chunkPages.every((page) => page.status === 'success' || page.status === 'skipped')) {
          continue;
        }

        this.state.currentChunkIndex = chunkIndex;
        chunkPages.forEach((pageAnalysis) => {
          pageAnalysis.status = 'processing';
          pageAnalysis.error = undefined;
        });
        this.emit('chunk-start', chunkIndex);

        try {
          await this.analyzePageBatch(chunkIndex, chunkPages, readyImages);
          this.emit('chunk-success', chunkIndex);
        } catch (error) {
          if (isAbortError(error)) {
            return;
          }

          const errorMessage = error instanceof Error ? error.message : String(error);
          chunkPages.forEach((pageAnalysis) => {
            if (pageAnalysis.status === 'processing' || pageAnalysis.status === 'pending') {
              pageAnalysis.status = 'error';
              pageAnalysis.error = errorMessage;
            }
          });
          if (this.shouldAutoSkipOnError()) {
            this.applySkippedPageAnalysisChunk(chunkIndex, errorMessage);
            continue;
          }
          if (fatalErrorRef.current === null) {
            fatalErrorRef.current = { index: chunkIndex, message: errorMessage };
          }
          return;
        }
      }
    };

    await Promise.allSettled(
      Array.from({ length: workerCount }, () => runNextChunkAnalysis())
    );

    const fatalError = fatalErrorRef.current;

    if (fatalError) {
      this.state.status = 'paused';
      this.state.currentChunkIndex = fatalError.index;
      this.emit('chunk-error', fatalError.index, fatalError.message);
      this.emit('paused');
      return false;
    }

    if (this.isPaused) {
      this.resetProcessingPageAnalysesToPending();
      this.state.status = 'paused';
      this.state.currentChunkIndex = this.findNextPendingPageAnalysisChunkIndex(0);
      this.emit('paused');
      return false;
    }

    return true;
  }

  private async runChunkSynthesisStage(): Promise<boolean> {
    for (let index = this.state.currentChunkIndex; index < this.state.chunkSyntheses.length; index += 1) {
      if (this.isPaused) {
        this.state.status = 'paused';
        this.state.currentChunkIndex = index;
        this.emit('paused');
        return false;
      }

      const chunkSynthesis = this.state.chunkSyntheses[index];
      if (chunkSynthesis.status === 'success' || chunkSynthesis.status === 'skipped') {
        continue;
      }

      const relatedPages = this.state.pageAnalyses.filter((page) => page.chunkIndex === chunkSynthesis.index);
      this.state.currentChunkIndex = index;
      chunkSynthesis.status = 'processing';
      chunkSynthesis.error = undefined;
      this.state.chunks[index].status = 'processing';
      this.emit('chunk-start', index);

      try {
        const result = await this.requestStructuredData(
          chunkSynthesis,
          {
            stage: 'synthesize-chunks',
            itemLabel: `第 ${chunkSynthesis.index + 1} 块综合`,
            chunkIndex: chunkSynthesis.index,
            imageNames: relatedPages.map((page) => page.imageName),
            images: [],
            systemPrompt: CHUNK_SYNTHESIS_SYSTEM_PROMPT,
            userPrompt: buildContextualChunkSynthesisPrompt(chunkSynthesis.index, relatedPages, {
              previousChunk: index > 0
                ? {
                    index: this.state.chunkSyntheses[index - 1].index,
                    title: this.state.chunkSyntheses[index - 1].title,
                    summary: this.state.chunkSyntheses[index - 1].summary,
                    continuitySummary: this.state.chunkSyntheses[index - 1].continuitySummary,
                  }
                : null,
              previousPages: index > 0
                ? this.state.pageAnalyses.filter((page) => page.chunkIndex === index - 1)
                : [],
              nextPages: this.state.pageAnalyses.filter((page) => page.chunkIndex === index + 1),
            }),
            temperature: SYNTHESIS_TEMPERATURE,
            maxOutputTokens: SYNTHESIS_MAX_TOKENS,
          },
          parseChunkSynthesisResult
        );

        chunkSynthesis.title = result.title || `第 ${chunkSynthesis.index + 1} 块`;
        chunkSynthesis.summary = result.summary;
        chunkSynthesis.keyDevelopments = result.keyDevelopments;
        chunkSynthesis.continuitySummary = result.continuitySummary;
        chunkSynthesis.status = 'success';
        this.state.chunks[index].status = 'success';
        this.state.chunks[index].plotSummary = result.summary;
        this.state.chunks[index].endingDetail = result.continuitySummary;
        this.emit('chunk-success', index);
      } catch (error) {
        if (isAbortError(error)) {
          this.state.status = 'paused';
          this.state.currentChunkIndex = index;
          this.emit('paused');
          return false;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        chunkSynthesis.status = 'error';
        chunkSynthesis.error = errorMessage;
        this.state.chunks[index].status = 'error';
        this.state.chunks[index].error = errorMessage;
        if (this.shouldAutoSkipOnError()) {
          this.applySkippedChunkSynthesis(index, errorMessage);
          continue;
        }
        this.state.status = 'paused';
        this.state.currentChunkIndex = index;
        this.emit('chunk-error', index, errorMessage);
        this.emit('paused');
        return false;
      }
    }

    return true;
  }

  private async runStorySynthesisStage(): Promise<boolean> {
    if (this.isPaused) {
      this.state.status = 'paused';
      this.emit('paused');
      return false;
    }

    this.state.currentChunkIndex = 0;
    this.state.globalSynthesis.status = 'processing';
    this.state.globalSynthesis.error = undefined;
    this.emit('chunk-start', 0);

    try {
      const result = await this.requestStructuredData(
        this.state.globalSynthesis,
        {
          stage: 'synthesize-story',
          itemLabel: '整书综合',
          chunkIndex: 0,
          imageNames: this.state.pageAnalyses.map((page) => page.imageName),
          images: [],
          systemPrompt: GLOBAL_SYNTHESIS_SYSTEM_PROMPT,
          userPrompt: buildContextualGlobalSynthesisPrompt(
            this.state.chunkSyntheses,
            this.state.pageAnalyses
          ),
          temperature: SYNTHESIS_TEMPERATURE,
          maxOutputTokens: SYNTHESIS_MAX_TOKENS,
        },
        (rawText) => parseStorySynthesisResult(rawText, this.state.chunkSyntheses.length)
      );

      this.state.globalSynthesis = {
        ...this.state.globalSynthesis,
        status: 'success',
        storyOverview: result.storyOverview,
        worldGuide: result.worldGuide,
        characterGuide: result.characterGuide,
        sceneOutline: result.sceneOutline,
        writingConstraints: result.writingConstraints,
        error: undefined,
      };
      this.state.memory.globalSummary = result.storyOverview || this.state.memory.globalSummary;
      this.initializeSectionsFromGlobalSynthesis();
      this.emit('chunk-success', 0);
      return true;
    } catch (error) {
      if (isAbortError(error)) {
        this.state.status = 'paused';
        this.emit('paused');
        return false;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.state.globalSynthesis.status = 'error';
      this.state.globalSynthesis.error = errorMessage;
      if (this.shouldAutoSkipOnError()) {
        this.applySkippedStorySynthesis(errorMessage);
        return true;
      }
      this.state.status = 'paused';
      this.emit('chunk-error', 0, errorMessage);
      this.emit('paused');
      return false;
    }
  }

  private async runSectionWritingStage(): Promise<boolean> {
    if (this.state.novelSections.length === 0) {
      this.initializeSectionsFromGlobalSynthesis();
    }

    const sectionSystemPrompt = buildSectionSystemPrompt(this.state.creativeSettings.systemPrompt);

    for (let index = this.state.currentChunkIndex; index < this.state.novelSections.length; index += 1) {
      if (this.isPaused) {
        this.state.status = 'paused';
        this.state.currentChunkIndex = index;
        this.emit('paused');
        return false;
      }

      const section = this.state.novelSections[index];
      if (section.status === 'success' || section.status === 'skipped') {
        continue;
      }

      const scenePlan = this.state.globalSynthesis.sceneOutline[index] || {
        sceneId: `scene-${index + 1}`,
        title: section.title,
        summary: this.state.chunkSyntheses
          .filter((chunk) => section.chunkIndexes.includes(chunk.index))
          .map((chunk) => chunk.summary)
          .filter((summary): summary is string => Boolean(summary))
          .join(' '),
        chunkIndexes: section.chunkIndexes,
      };

      this.state.currentChunkIndex = index;
      section.status = 'processing';
      section.error = undefined;
      this.emit('chunk-start', index);

      try {
        const result = await this.requestStructuredData(
          section,
          {
            stage: 'write-sections',
            itemLabel: section.title,
            chunkIndex: index,
            imageNames: this.state.pageAnalyses
              .filter((page) => section.chunkIndexes.includes(page.chunkIndex))
              .map((page) => page.imageName),
            images: [],
            systemPrompt: sectionSystemPrompt,
            userPrompt: buildSectionUserPrompt(
              index,
              this.state.globalSynthesis,
              this.findPreviousContinuitySummary(index),
              scenePlan,
              this.state.chunkSyntheses,
              this.state.pageAnalyses,
              this.state.creativeSettings.userPromptTemplate
            ),
            temperature: this.state.creativeSettings.temperature,
            maxOutputTokens: WRITING_MAX_TOKENS,
          },
          parseSectionResult
        );

        section.markdownBody = result.novelText;
        section.continuitySummary = result.continuitySummary;
        section.status = 'success';
        this.state.memory.previousEnding = result.continuitySummary || this.state.memory.previousEnding;
        this.state.memory.completedChunks.push(index);
        this.refreshFullNovel();
        this.emit('chunk-success', index);
      } catch (error) {
        if (isAbortError(error)) {
          this.state.status = 'paused';
          this.state.currentChunkIndex = index;
          this.emit('paused');
          return false;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        section.status = 'error';
        section.error = errorMessage;
        if (this.shouldAutoSkipOnError()) {
          this.applySkippedSection(index, errorMessage);
          continue;
        }
        this.state.status = 'paused';
        this.state.currentChunkIndex = index;
        this.emit('chunk-error', index, errorMessage);
        this.emit('paused');
        return false;
      }
    }

    return true;
  }

  private async requestStructuredData<T>(
    target: RetryTarget,
    request: ModelRequest,
    parser: (rawText: string) => T
  ): Promise<T> {
    let lastError: unknown;
    const modelCandidates = this.resolveModelCandidatesForStage(request.stage);
    const triedModels: string[] = [];

    for (let modelIndex = 0; modelIndex < modelCandidates.length; modelIndex += 1) {
      const model = modelCandidates[modelIndex];
      let currentMaxOutputTokens = request.maxOutputTokens;
      triedModels.push(model);

      for (let attempt = 0; attempt <= this.state.config.maxRetries; attempt += 1) {
        try {
          const lastAIRequest: LastAIRequest = {
            provider: this.apiConfig!.provider,
            model,
            baseUrl: this.apiConfig!.baseUrl,
            stage: request.stage,
            itemLabel: request.itemLabel,
            chunkIndex: request.chunkIndex,
            imageCount: request.imageNames.length,
            imageNames: request.imageNames,
            systemPrompt: request.systemPrompt,
            userPrompt: request.userPrompt,
            sentAt: new Date().toISOString(),
          };

          this.state.lastAIRequest = lastAIRequest;
          this.emit('state-change');

          const requestSignal = createRequestSignal(
            this.abortController?.signal,
            this.getRequestTimeoutMs(request)
          );

          const rawText = await callAIText(
            {
              ...this.apiConfig!,
              model,
            },
            request.images,
            {
              systemPrompt: request.systemPrompt,
              userPrompt: request.userPrompt,
              temperature: request.temperature,
              maxOutputTokens: currentMaxOutputTokens,
              responseMimeType: 'application/json',
            },
            requestSignal.signal
          ).catch((error) => {
            if (isAbortError(error) && requestSignal.didTimeout()) {
              const timeoutSeconds = Math.round((this.getRequestTimeoutMs(request) || 0) / 1000);
              throw new Error(`The page analysis request timed out after ${timeoutSeconds} seconds.`);
            }
            throw error;
          }).finally(() => {
            requestSignal.cancel();
          });

          target.retryCount = attempt;
          target.error = undefined;
          return parser(rawText);
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }

          lastError = error;
          const errorMessage = error instanceof Error ? error.message : String(error);
          const tokenLimitError = parseMaxTokenLimitError(errorMessage);
          const inputTokenLimitError = isInputTokenLimitError(errorMessage);
          const browserReachabilityError = isBrowserReachabilityError(errorMessage);
          const retryableModelAvailabilityError = isRetryableModelAvailabilityError(errorMessage);
          const nextModel = modelCandidates[modelIndex + 1];

          if (tokenLimitError) {
            const overflow = Math.max(1, tokenLimitError.requestedTotal - tokenLimitError.maxSeqLen);
            const nextMaxOutputTokens = Math.max(128, currentMaxOutputTokens - overflow - 64);

            if (nextMaxOutputTokens < currentMaxOutputTokens) {
              currentMaxOutputTokens = nextMaxOutputTokens;
              target.error = `Token limit reached, automatically retrying with max_tokens=${nextMaxOutputTokens}.`;
              continue;
            }
          }

          if (inputTokenLimitError) {
            target.retryCount = attempt + 1;
            target.error = errorMessage;
            break;
          }

          if (browserReachabilityError) {
            target.retryCount = attempt + 1;
            target.error = errorMessage;
            break;
          }

          if (
            request.stage === 'analyze-pages'
            && request.imageNames.length > 1
            && shouldSplitPageAnalysisBatch(errorMessage)
          ) {
            target.retryCount = attempt + 1;
            target.error = errorMessage;
            break;
          }

          if (retryableModelAvailabilityError && nextModel) {
            target.retryCount = attempt + 1;
            target.error = isCapacityAvailabilityError(errorMessage)
              ? `Model ${model} is currently at capacity, switching to ${nextModel}.`
              : `Model ${model} is unavailable on the current server, switching to ${nextModel}.`;
            this.emit('state-change');
            break;
          }

          target.retryCount = attempt + 1;
          target.error = errorMessage;

          if (attempt < this.state.config.maxRetries) {
            const delay = this.state.config.retryDelay * Math.pow(2, attempt);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      const lastErrorMessage = lastError instanceof Error ? lastError.message : String(lastError ?? '');
      if (!isRetryableModelAvailabilityError(lastErrorMessage)) {
        break;
      }
    }

    const lastErrorMessage = lastError instanceof Error ? lastError.message : String(lastError ?? '');
    if (isCapacityAvailabilityError(lastErrorMessage) && triedModels.length > 1) {
      throw new Error(`All candidate models are currently at capacity. Tried: ${triedModels.join(', ')}.`);
    }

    if (isRetryableModelAvailabilityError(lastErrorMessage) && triedModels.length > 1) {
      throw new Error(`All candidate models were unavailable on the current server. Tried: ${triedModels.join(', ')}.`);
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Unknown request error.'));
  }

  pause() {
    this.isPaused = true;
    this.abortController?.abort();
  }

  async resume(): Promise<void> {
    return this.run();
  }

  async skipAndContinue(): Promise<void> {
    switch (this.state.currentStage) {
      case 'analyze-pages': {
        const pageAnalyses = this.getPageAnalysesForChunk(this.state.currentChunkIndex);
        pageAnalyses.forEach((pageAnalysis) => {
          pageAnalysis.status = 'skipped';
          pageAnalysis.error = undefined;
        });
        this.emit('chunk-skip', this.state.currentChunkIndex);
        this.state.currentChunkIndex += 1;
        break;
      }
      case 'synthesize-chunks': {
        const chunkSynthesis = this.state.chunkSyntheses[this.state.currentChunkIndex];
        if (chunkSynthesis) {
          const fallback = createFallbackChunkSynthesis(
            chunkSynthesis.index,
            this.state.pageAnalyses.filter((page) => page.chunkIndex === chunkSynthesis.index)
          );
          chunkSynthesis.title = fallback.title;
          chunkSynthesis.summary = fallback.summary;
          chunkSynthesis.keyDevelopments = fallback.keyDevelopments;
          chunkSynthesis.continuitySummary = fallback.continuitySummary;
          chunkSynthesis.status = 'skipped';
          chunkSynthesis.error = undefined;
          this.state.chunks[chunkSynthesis.index].status = 'skipped';
          this.state.chunks[chunkSynthesis.index].plotSummary = fallback.summary;
          this.state.chunks[chunkSynthesis.index].endingDetail = fallback.continuitySummary;
        }
        this.emit('chunk-skip', this.state.currentChunkIndex);
        this.state.currentChunkIndex += 1;
        break;
      }
      case 'synthesize-story': {
        const fallback = createFallbackStorySynthesis(this.state.chunkSyntheses);
        this.state.globalSynthesis = {
          ...this.state.globalSynthesis,
          ...fallback,
          status: 'skipped',
          error: undefined,
        };
        this.state.memory.globalSummary = fallback.storyOverview;
        this.initializeSectionsFromGlobalSynthesis();
        this.state.currentStage = 'write-sections';
        this.state.currentChunkIndex = 0;
        this.emit('chunk-skip', 0);
        break;
      }
      case 'write-sections': {
        const section = this.state.novelSections[this.state.currentChunkIndex];
        if (section) {
          section.status = 'skipped';
          section.error = undefined;
        }
        this.refreshFullNovel();
        this.emit('chunk-skip', this.state.currentChunkIndex);
        this.state.currentChunkIndex += 1;
        break;
      }
      default:
        break;
    }

    return this.run();
  }

  async retryCurrentAndContinue(): Promise<void> {
    switch (this.state.currentStage) {
      case 'analyze-pages': {
        const pageAnalyses = this.getPageAnalysesForChunk(this.state.currentChunkIndex);
        pageAnalyses.forEach((pageAnalysis) => {
          pageAnalysis.status = 'pending';
          pageAnalysis.summary = undefined;
          pageAnalysis.location = undefined;
          pageAnalysis.timeHint = undefined;
          pageAnalysis.keyEvents = [];
          pageAnalysis.characters = [];
          pageAnalysis.retryCount = 0;
          pageAnalysis.error = undefined;
        });
        break;
      }
      case 'synthesize-chunks': {
        const chunkSynthesis = this.state.chunkSyntheses[this.state.currentChunkIndex];
        if (chunkSynthesis) {
          chunkSynthesis.status = 'pending';
          chunkSynthesis.retryCount = 0;
          chunkSynthesis.error = undefined;
          this.state.chunks[this.state.currentChunkIndex].status = 'pending';
          this.state.chunks[this.state.currentChunkIndex].error = undefined;
        }
        break;
      }
      case 'synthesize-story': {
        this.state.globalSynthesis.status = 'pending';
        this.state.globalSynthesis.retryCount = 0;
        this.state.globalSynthesis.error = undefined;
        break;
      }
      case 'write-sections': {
        const section = this.state.novelSections[this.state.currentChunkIndex];
        if (section) {
          section.status = 'pending';
          section.retryCount = 0;
          section.error = undefined;
        }
        break;
      }
      default:
        break;
    }

    return this.run();
  }

  async rerunFailedAndContinue(): Promise<void> {
    const firstPageFailure = this.state.pageAnalyses.findIndex((item) => item.status === 'error' || item.status === 'skipped');
    if (firstPageFailure !== -1) {
      const failedChunkIndex = this.state.pageAnalyses[firstPageFailure].chunkIndex;
      const firstChunkPageIndex = this.getFirstPageAnalysisIndexForChunk(failedChunkIndex);
      this.resetPageAnalysesFrom(firstChunkPageIndex === -1 ? firstPageFailure : firstChunkPageIndex);
      this.state.currentStage = 'analyze-pages';
      this.state.currentChunkIndex = failedChunkIndex;
      this.state.status = 'idle';
      this.emit('state-change');
      return this.run();
    }

    const firstChunkFailure = this.state.chunkSyntheses.findIndex((item) => item.status === 'error' || item.status === 'skipped');
    if (firstChunkFailure !== -1) {
      this.resetChunkSynthesesFrom(firstChunkFailure);
      this.state.currentStage = 'synthesize-chunks';
      this.state.currentChunkIndex = firstChunkFailure;
      this.state.status = 'idle';
      this.emit('state-change');
      return this.run();
    }

    if (this.state.globalSynthesis.status === 'error' || this.state.globalSynthesis.status === 'skipped') {
      this.resetGlobalSynthesisAndSections();
      this.state.currentStage = 'synthesize-story';
      this.state.currentChunkIndex = 0;
      this.state.status = 'idle';
      this.emit('state-change');
      return this.run();
    }

    const firstSectionFailure = this.state.novelSections.findIndex((item) => item.status === 'error' || item.status === 'skipped');
    if (firstSectionFailure !== -1) {
      this.resetSectionsFrom(firstSectionFailure);
      this.state.currentStage = 'write-sections';
      this.state.currentChunkIndex = firstSectionFailure;
      this.state.status = 'idle';
      this.emit('state-change');
      return this.run();
    }
  }

  reset() {
    this.abortController?.abort();
    this.abortController = null;
    this.isPaused = false;
    this.state = {
      status: 'idle',
      currentStage: 'idle',
      chunks: [],
      pageAnalyses: [],
      chunkSyntheses: [],
      globalSynthesis: cloneGlobalSynthesis(DEFAULT_STORY_SYNTHESIS),
      novelSections: [],
      memory: { ...DEFAULT_MEMORY_STATE },
      config: this.state.config,
      creativeSettings: this.state.creativeSettings,
      currentChunkIndex: -1,
      fullNovel: '',
      lastAIRequest: this.state.lastAIRequest,
    };
    this.emit('state-change');
  }
}
