/**
 * TaskOrchestrator —— 智能异步队列 + 递归上下文状态机 (Memory Loop)
 * 
 * 核心职责：
 *   1. 将图片分块 (Chunk)
 *   2. 顺序处理每块（因为需要上下文传递）
 *   3. 每块处理后更新 MemoryState（全局摘要 + 结尾细节）
 *   4. 支持断点续传、手动跳过、自动重试
 * 
 * 数据流:
 *   Chunk_N → prompt(SystemPrompt, GlobalSummary_{1..N-1}, EndingDetail_{N-1}, Images_N)
 *           → AI → parse → { novelText_N, plotSummary_N, endingDetail_N }
 *           → memory.globalSummary = plotSummary_N
 *           → memory.previousEnding = endingDetail_N
 *           → fullNovel += novelText_N
 */

import type {
  ImageItem,
  ImageChunk,
  MemoryState,
  TaskState,
  OrchestratorConfig,
  APIConfig,
  AIResponse,
  CreativeSettings,
} from './types';
import { DEFAULT_CREATIVE_SETTINGS, DEFAULT_MEMORY_STATE, DEFAULT_ORCHESTRATOR_CONFIG } from './types';
import { processImage } from './image-pipeline';
import { callAI } from './api-adapter';

export type TaskEventType =
  | 'state-change'     // 整体状态变化
  | 'chunk-start'      // 开始处理某块
  | 'chunk-success'    // 某块处理成功
  | 'chunk-error'      // 某块处理失败
  | 'chunk-skip'       // 跳过某块
  | 'image-processed'  // 单张图片预处理完成
  | 'completed'        // 全部完成
  | 'paused';          // 已暂停

export interface TaskEvent {
  type: TaskEventType;
  state: TaskState;
  chunkIndex?: number;
  error?: string;
}

type TaskListener = (event: TaskEvent) => void;

export class TaskOrchestrator {
  private state: TaskState;
  private apiConfig: APIConfig | null = null;
  private listeners: Set<TaskListener> = new Set();
  private abortController: AbortController | null = null;
  private isPaused = false;

  constructor(config?: Partial<OrchestratorConfig>) {
    this.state = {
      status: 'idle',
      chunks: [],
      memory: { ...DEFAULT_MEMORY_STATE },
      config: { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config },
      creativeSettings: { ...DEFAULT_CREATIVE_SETTINGS },
      currentChunkIndex: -1,
      fullNovel: '',
    };
  }

  /** 订阅状态变化 */
  on(listener: TaskListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 触发事件 */
  private emit(type: TaskEventType, chunkIndex?: number, error?: string) {
    const event: TaskEvent = {
      type,
      state: this.getState(),
      chunkIndex,
      error,
    };
    this.listeners.forEach((fn) => fn(event));
  }

  /** 获取当前状态的快照 */
  getState(): TaskState {
    return {
      ...this.state,
      chunks: this.state.chunks.map((c) => ({ ...c, images: [...c.images] })),
      memory: { ...this.state.memory },
      config: { ...this.state.config },
      creativeSettings: { ...this.state.creativeSettings },
    };
  }

  /** 设置 API 配置 */
  setAPIConfig(config: APIConfig) {
    this.apiConfig = config;
  }

  /** 更新编排器配置 */
  updateConfig(config: Partial<OrchestratorConfig>) {
    this.state.config = { ...this.state.config, ...config };
  }

  /** 更新创作设置 */
  updateCreativeSettings(settings: Partial<CreativeSettings>) {
    this.state.creativeSettings = {
      ...this.state.creativeSettings,
      ...settings,
    };
  }

  /**
   * 准备阶段：接收图片列表 → 预处理 → 分块
   */
  async prepare(images: ImageItem[]): Promise<void> {
    this.state.status = 'preparing';
    this.emit('state-change');

    // 预处理所有图片（压缩 + WebP）
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (img.status === 'ready') continue; // 已处理过
      try {
        img.status = 'processing';
        const result = await processImage(img.file);
        img.processedBase64 = result.base64;
        img.processedMime = result.mime;
        img.compressedSize = result.compressedSize;
        img.status = 'ready';
      } catch {
        img.status = 'error';
      }
      this.emit('image-processed');
    }

    // 分块
    const readyImages = images.filter((img) => img.status === 'ready');
    const { chunkSize } = this.state.config;
    const normalizedChunkSize = chunkSize <= 0 ? Math.max(readyImages.length, 1) : chunkSize;
    const chunks: ImageChunk[] = [];
    for (let i = 0; i < readyImages.length; i += normalizedChunkSize) {
      chunks.push({
        index: chunks.length,
        images: readyImages.slice(i, i + normalizedChunkSize),
        status: 'pending',
        retryCount: 0,
      });
    }

    this.state.chunks = chunks;
    this.state.memory = { ...DEFAULT_MEMORY_STATE };
    this.state.currentChunkIndex = 0;
    this.state.fullNovel = '';
    this.state.status = 'idle';
    this.emit('state-change');
  }

  /**
   * 核心执行循环 —— 顺序处理所有块
   */
  async run(): Promise<void> {
    if (!this.apiConfig) throw new Error('请先配置 API');
    if (this.state.chunks.length === 0) throw new Error('请先添加图片');

    this.state.status = 'running';
    this.isPaused = false;
    this.abortController = new AbortController();
    this.emit('state-change');

    const { chunks, memory, config } = this.state;

    for (let i = this.state.currentChunkIndex; i < chunks.length; i++) {
      // 暂停检查
      if (this.isPaused) {
        this.state.status = 'paused';
        this.state.currentChunkIndex = i;
        this.emit('paused');
        return;
      }

      const chunk = chunks[i];
      // 跳过已完成或已跳过的块
      if (chunk.status === 'success' || chunk.status === 'skipped') continue;

      this.state.currentChunkIndex = i;
      chunk.status = 'processing';
      this.emit('chunk-start', i);

      const success = await this.processChunk(chunk, memory, config);

      if (this.isPaused) {
        this.state.status = 'paused';
        this.state.currentChunkIndex = i;
        this.emit('paused');
        return;
      }

      if (success) {
        chunk.status = 'success';
        // ===== Memory Loop 核心：滚动更新上下文 =====
        memory.globalSummary = chunk.plotSummary || memory.globalSummary;
        memory.previousEnding = chunk.endingDetail || memory.previousEnding;
        memory.completedChunks.push(i);
        this.state.fullNovel += (this.state.fullNovel ? '\n\n' : '') + chunk.novelText;
        this.emit('chunk-success', i);
      } else {
        chunk.status = 'error';
        this.emit('chunk-error', i, chunk.error);
        // 出错后暂停，等待用户决定（重试或跳过）
        this.state.status = 'paused';
        this.state.currentChunkIndex = i;
        this.emit('paused');
        return;
      }
    }

    this.state.status = 'completed';
    this.abortController = null;
    this.emit('completed');
  }

  /**
   * 处理单个块（含自动重试逻辑）
   */
  private async processChunk(
    chunk: ImageChunk,
    memory: MemoryState,
    config: OrchestratorConfig
  ): Promise<boolean> {
    const images = chunk.images
      .filter((img) => img.processedBase64 && img.processedMime)
      .map((img) => ({
        base64: img.processedBase64!,
        mime: img.processedMime!,
      }));

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        const result: AIResponse = await callAI(
          this.apiConfig!,
          images,
          chunk.index,
          memory.globalSummary,
          memory.previousEnding,
          {
            systemPrompt: this.state.creativeSettings.systemPrompt,
            temperature: this.state.creativeSettings.temperature,
          },
          this.abortController?.signal
        );
        chunk.novelText = result.novelText;
        chunk.plotSummary = result.plotSummary;
        chunk.endingDetail = result.endingDetail;
        chunk.error = undefined;
        return true;
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return false;
        }
        chunk.retryCount = attempt + 1;
        chunk.error = err instanceof Error ? err.message : String(err);

        if (attempt < config.maxRetries) {
          // 指数退避
          const delay = config.retryDelay * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    return false;
  }

  /** 暂停处理 */
  pause() {
    this.isPaused = true;
    this.abortController?.abort();
  }

  /** 从断点继续 */
  async resume(): Promise<void> {
    return this.run();
  }

  /** 跳过当前出错的块并继续 */
  async skipAndContinue(): Promise<void> {
    const chunk = this.state.chunks[this.state.currentChunkIndex];
    if (chunk) {
      chunk.status = 'skipped';
      this.emit('chunk-skip', this.state.currentChunkIndex);
    }
    this.state.currentChunkIndex++;
    return this.run();
  }

  /** 重试当前出错的块 */
  async retryCurrentAndContinue(): Promise<void> {
    const chunk = this.state.chunks[this.state.currentChunkIndex];
    if (chunk) {
      chunk.status = 'pending';
      chunk.retryCount = 0;
      chunk.error = undefined;
    }
    return this.run();
  }

  /** 完全重置 */
  reset() {
    this.abortController?.abort();
    this.abortController = null;
    this.isPaused = false;
    this.state = {
      status: 'idle',
      chunks: [],
      memory: { ...DEFAULT_MEMORY_STATE },
      config: this.state.config,
      creativeSettings: this.state.creativeSettings,
      currentChunkIndex: -1,
      fullNovel: '',
    };
    this.emit('state-change');
  }
}
