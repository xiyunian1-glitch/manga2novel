'use client';

/**
 * useManga2Novel —— 全局状态管理 Hook
 * 将 TaskOrchestrator 与 React 状态桥接
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import type { APIConfig, ImageItem, TaskState, OrchestratorConfig, CreativeSettings } from '@/lib/types';
import { DEFAULT_CREATIVE_SETTINGS, DEFAULT_ORCHESTRATOR_CONFIG, DEFAULT_MEMORY_STATE } from '@/lib/types';
import { TaskOrchestrator } from '@/lib/task-orchestrator';
import { secureSet, secureGet, setJSON, getJSON } from '@/lib/crypto-store';
import { createPreviewUrl, revokePreviewUrl } from '@/lib/image-pipeline';
import { fetchModels as fetchProviderModels } from '@/lib/api-adapter';
import { CREATIVE_PRESETS, CUSTOM_PRESET_ID, getCreativePreset, resolveCreativePresetId, SYSTEM_PROMPT } from '@/lib/prompts';

let idCounter = 0;

export function useManga2Novel() {
  const orchestratorRef = useRef<TaskOrchestrator | null>(null);

  const [apiConfig, setApiConfigState] = useState<APIConfig>({
    provider: 'openrouter',
    apiKey: '',
    model: 'anthropic/claude-sonnet-4',
  });
  const [images, setImages] = useState<ImageItem[]>([]);
  const [taskState, setTaskState] = useState<TaskState>({
    status: 'idle',
    chunks: [],
    memory: { ...DEFAULT_MEMORY_STATE },
    config: { ...DEFAULT_ORCHESTRATOR_CONFIG },
    creativeSettings: { ...DEFAULT_CREATIVE_SETTINGS, systemPrompt: SYSTEM_PROMPT },
    currentChunkIndex: -1,
    fullNovel: '',
  });
  const [configLoaded, setConfigLoaded] = useState(false);

  // 初始化 orchestrator
  if (!orchestratorRef.current) {
    orchestratorRef.current = new TaskOrchestrator();
  }
  const orchestrator = orchestratorRef.current;

  // 加载已保存的配置
  useEffect(() => {
    (async () => {
      const savedKey = await secureGet('apiKey');
      const savedProvider = getJSON<string>('provider');
      const savedModel = getJSON<string>('model');
      const savedBaseUrl = getJSON<string>('baseUrl');
      const savedOrcConfig = getJSON<OrchestratorConfig>('orchestratorConfig');
      const savedCreativeSettings = getJSON<CreativeSettings>('creativeSettings');

      const config: APIConfig = {
        provider: (savedProvider as APIConfig['provider']) || 'openrouter',
        apiKey: savedKey || '',
        model: savedModel || 'anthropic/claude-sonnet-4',
        baseUrl: savedBaseUrl || '',
      };
      setApiConfigState(config);
      if (savedOrcConfig) {
        orchestrator.updateConfig(savedOrcConfig);
      }
      const creativeSettings: CreativeSettings = {
        ...DEFAULT_CREATIVE_SETTINGS,
        systemPrompt: SYSTEM_PROMPT,
        ...savedCreativeSettings,
      };
      creativeSettings.presetId = resolveCreativePresetId(creativeSettings.systemPrompt);
      orchestrator.updateCreativeSettings(creativeSettings);
      setTaskState((prev) => ({
        ...prev,
        config: savedOrcConfig ? { ...DEFAULT_ORCHESTRATOR_CONFIG, ...savedOrcConfig } : prev.config,
        creativeSettings,
      }));
      setConfigLoaded(true);
    })();
  }, [orchestrator]);

  // 订阅 orchestrator 事件
  useEffect(() => {
    return orchestrator.on((event) => {
      setTaskState(event.state);
    });
  }, [orchestrator]);

  // 保存 API 配置
  const saveApiConfig = useCallback(async (config: APIConfig) => {
    setApiConfigState(config);
    await secureSet('apiKey', config.apiKey);
    setJSON('provider', config.provider);
    setJSON('model', config.model);
    setJSON('baseUrl', config.baseUrl || '');
    orchestrator.setAPIConfig(config);
  }, [orchestrator]);

  // 保存编排配置
  const saveOrchestratorConfig = useCallback((config: Partial<OrchestratorConfig>) => {
    orchestrator.updateConfig(config);
    const current = orchestrator.getState().config;
    setJSON('orchestratorConfig', current);
    setTaskState(orchestrator.getState());
  }, [orchestrator]);

  const fetchModels = useCallback(async (config: Pick<APIConfig, 'provider' | 'apiKey' | 'baseUrl'>) => {
    return fetchProviderModels(config);
  }, []);

  const updateCreativeSettings = useCallback((settings: Partial<CreativeSettings>) => {
    const currentSettings = orchestrator.getState().creativeSettings;
    const nextSettings: Partial<CreativeSettings> = { ...settings };

    if (typeof settings.systemPrompt === 'string' && settings.presetId === undefined) {
      nextSettings.presetId = resolveCreativePresetId(settings.systemPrompt);
    }

    if (settings.presetId && settings.presetId !== CUSTOM_PRESET_ID) {
      const preset = getCreativePreset(settings.presetId);
      if (preset) {
        nextSettings.systemPrompt = preset.prompt;
      }
    }

    if (
      settings.presetId === CUSTOM_PRESET_ID &&
      settings.systemPrompt === undefined
    ) {
      nextSettings.systemPrompt = currentSettings.systemPrompt;
    }

    orchestrator.updateCreativeSettings(nextSettings);
    const currentState = orchestrator.getState();
    setJSON('creativeSettings', currentState.creativeSettings);
    setTaskState(currentState);
  }, [orchestrator]);

  const applyCreativePreset = useCallback((presetId: string) => {
    if (presetId === CUSTOM_PRESET_ID) {
      updateCreativeSettings({ presetId: CUSTOM_PRESET_ID });
      return;
    }
    const preset = getCreativePreset(presetId) || CREATIVE_PRESETS[1];
    updateCreativeSettings({ presetId: preset.id, systemPrompt: preset.prompt });
  }, [updateCreativeSettings]);

  // 添加图片
  const addImages = useCallback((files: File[]) => {
    const newImages: ImageItem[] = files.map((file) => ({
      id: `img_${Date.now()}_${++idCounter}`,
      file,
      previewUrl: createPreviewUrl(file),
      status: 'pending' as const,
      originalSize: file.size,
    }));
    setImages((prev) => [...prev, ...newImages]);
  }, []);

  // 移除图片
  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img) revokePreviewUrl(img.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  // 重排图片
  const reorderImages = useCallback((fromIndex: number, toIndex: number) => {
    setImages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  // 清空所有图片
  const clearImages = useCallback(() => {
    images.forEach((img) => revokePreviewUrl(img.previewUrl));
    setImages([]);
  }, [images]);

  // 开始处理
  const startProcessing = useCallback(async () => {
    if (!apiConfig.apiKey) throw new Error('请先配置 API Key');
    orchestrator.setAPIConfig(apiConfig);
    await orchestrator.prepare(images);
    setImages([...images]); // 触发重渲染以显示处理后的状态
    await orchestrator.run();
  }, [apiConfig, images, orchestrator]);

  // 暂停
  const pause = useCallback(() => {
    orchestrator.pause();
  }, [orchestrator]);

  // 继续
  const resume = useCallback(async () => {
    await orchestrator.resume();
  }, [orchestrator]);

  // 跳过当前块
  const skipCurrent = useCallback(async () => {
    await orchestrator.skipAndContinue();
  }, [orchestrator]);

  // 重试当前块
  const retryCurrent = useCallback(async () => {
    await orchestrator.retryCurrentAndContinue();
  }, [orchestrator]);

  // 重置
  const reset = useCallback(() => {
    orchestrator.reset();
  }, [orchestrator]);

  // 导出小说
  const exportNovel = useCallback((format: 'txt' | 'md' = 'txt') => {
    const content = format === 'md'
      ? `# Manga2Novel 输出\n\n${taskState.fullNovel}`
      : taskState.fullNovel;
    const mimeType = format === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `manga2novel_${new Date().toISOString().slice(0, 10)}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [taskState.fullNovel]);

  return {
    apiConfig,
    images,
    taskState,
    configLoaded,
    saveApiConfig,
    saveOrchestratorConfig,
    fetchModels,
    updateCreativeSettings,
    applyCreativePreset,
    addImages,
    removeImage,
    reorderImages,
    clearImages,
    startProcessing,
    pause,
    resume,
    skipCurrent,
    retryCurrent,
    reset,
    exportNovel,
  };
}
