'use client';

/**
 * useManga2Novel —— 全局状态管理 Hook
 * 将 TaskOrchestrator 与 React 状态桥接
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import type { APIConfig, ImageItem, TaskState, OrchestratorConfig, CreativeSettings } from '@/lib/types';
import { DEFAULT_CREATIVE_SETTINGS, DEFAULT_ORCHESTRATOR_CONFIG, DEFAULT_MEMORY_STATE } from '@/lib/types';
import { TaskOrchestrator } from '@/lib/task-orchestrator';
import { secureSet, secureGet, secureRemove, setJSON, getJSON } from '@/lib/crypto-store';
import { createPreviewUrl, revokePreviewUrl } from '@/lib/image-pipeline';
import { fetchModels as fetchProviderModels } from '@/lib/api-adapter';
import {
  CREATIVE_PRESETS,
  CUSTOM_PRESET_ID,
  composeSystemPrompt,
  resolveCreativePresetId,
  splitSystemPrompt,
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_BODY,
} from '@/lib/prompts';
import type { CreativePreset } from '@/lib/types';

let idCounter = 0;
const CREATIVE_SETTINGS_TEMPLATE_VERSION = 3;

function resolvePresetIdFromPresets(systemPrompt: string, presets: CreativePreset[]): string {
  const builtinPresetId = resolveCreativePresetId(systemPrompt);
  if (builtinPresetId !== CUSTOM_PRESET_ID) {
    return builtinPresetId;
  }

  const { roleAndStyle } = splitSystemPrompt(systemPrompt);
  const matchedPreset = presets.find(
    (preset) => preset.id !== CUSTOM_PRESET_ID && splitSystemPrompt(preset.prompt).roleAndStyle === roleAndStyle
  );
  return matchedPreset?.id || CUSTOM_PRESET_ID;
}

export function useManga2Novel() {
  const orchestratorRef = useRef<TaskOrchestrator | null>(null);

  const [apiConfig, setApiConfigState] = useState<APIConfig>({
    provider: 'openrouter',
    apiKey: '',
    model: '',
  });
  const [images, setImages] = useState<ImageItem[]>([]);
  const [creativePresets, setCreativePresets] = useState<CreativePreset[]>(CREATIVE_PRESETS);
  const [taskState, setTaskState] = useState<TaskState>({
    status: 'idle',
    chunks: [],
    memory: { ...DEFAULT_MEMORY_STATE },
    config: { ...DEFAULT_ORCHESTRATOR_CONFIG },
    creativeSettings: { ...DEFAULT_CREATIVE_SETTINGS, systemPrompt: SYSTEM_PROMPT },
    currentChunkIndex: -1,
    fullNovel: '',
    lastAIRequest: undefined,
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
      const savedModel = getJSON<string>('model');
      const savedBaseUrl = getJSON<string>('baseUrl');
      const savedOrcConfig = getJSON<OrchestratorConfig>('orchestratorConfig');
      const savedCreativeSettings = getJSON<CreativeSettings>('creativeSettings');
      const savedCreativeSettingsTemplateVersion = getJSON<number>('creativeSettingsTemplateVersion');
      const savedCreativePresets = getJSON<CreativePreset[]>('creativePresets');
      const nextPresets = [
        ...CREATIVE_PRESETS,
        ...(savedCreativePresets?.filter((preset) => !CREATIVE_PRESETS.some((builtin) => builtin.id === preset.id)) || []),
      ];

      const config: APIConfig = {
        provider: 'openrouter',
        apiKey: savedKey || '',
        model: savedModel || '',
        baseUrl: savedBaseUrl || '',
      };
      setApiConfigState(config);
      setCreativePresets(nextPresets);
      if (savedOrcConfig) {
        orchestrator.updateConfig(savedOrcConfig);
      }
      const creativeSettings: CreativeSettings = {
        ...DEFAULT_CREATIVE_SETTINGS,
        systemPrompt: SYSTEM_PROMPT,
        ...savedCreativeSettings,
      };

      if (savedCreativeSettingsTemplateVersion !== CREATIVE_SETTINGS_TEMPLATE_VERSION) {
        const { supplementalPrompt, roleAndStyle } = splitSystemPrompt(creativeSettings.systemPrompt);
        creativeSettings.systemPrompt = composeSystemPrompt(supplementalPrompt, roleAndStyle, SYSTEM_PROMPT_BODY);
        setJSON('creativeSettingsTemplateVersion', CREATIVE_SETTINGS_TEMPLATE_VERSION);
        setJSON('creativeSettings', creativeSettings);
      }

      creativeSettings.presetId = resolvePresetIdFromPresets(creativeSettings.systemPrompt, nextPresets);
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
    const normalizedConfig: APIConfig = {
      ...config,
      provider: 'openrouter',
      apiKey: config.apiKey.trim(),
      model: config.model.trim(),
      baseUrl: config.baseUrl?.trim() || '',
    };
    setApiConfigState(normalizedConfig);
    if (normalizedConfig.apiKey) {
      await secureSet('apiKey', normalizedConfig.apiKey);
    } else {
      secureRemove('apiKey');
    }
    setJSON('provider', normalizedConfig.provider);
    setJSON('model', normalizedConfig.model);
    setJSON('baseUrl', normalizedConfig.baseUrl || '');
    orchestrator.setAPIConfig(normalizedConfig);
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
      nextSettings.presetId = resolvePresetIdFromPresets(settings.systemPrompt, creativePresets);
    }

    if (settings.presetId && settings.presetId !== CUSTOM_PRESET_ID) {
      const preset = creativePresets.find((item) => item.id === settings.presetId);
      if (preset) {
        const { roleAndStyle } = splitSystemPrompt(preset.prompt);
        const { supplementalPrompt, systemPromptBody } = splitSystemPrompt(currentSettings.systemPrompt);
        nextSettings.systemPrompt = composeSystemPrompt(supplementalPrompt, roleAndStyle, systemPromptBody);
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
  }, [creativePresets, orchestrator]);

  const applyCreativePreset = useCallback((presetId: string) => {
    if (presetId === CUSTOM_PRESET_ID) {
      updateCreativeSettings({ presetId: CUSTOM_PRESET_ID });
      return;
    }
    const preset = creativePresets.find((item) => item.id === presetId) || CREATIVE_PRESETS[1];
    const { roleAndStyle } = splitSystemPrompt(preset.prompt);
    const { supplementalPrompt, systemPromptBody } = splitSystemPrompt(orchestrator.getState().creativeSettings.systemPrompt);
    updateCreativeSettings({
      presetId: preset.id,
      systemPrompt: composeSystemPrompt(supplementalPrompt, roleAndStyle, systemPromptBody),
    });
  }, [creativePresets, orchestrator, updateCreativeSettings]);

  const saveCreativePreset = useCallback((name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('请输入预设名称');
    }

    const { roleAndStyle } = splitSystemPrompt(orchestrator.getState().creativeSettings.systemPrompt);
    if (!roleAndStyle.trim()) {
      throw new Error('当前风格内容为空，无法保存为预设');
    }

    const existingCustomPresets = creativePresets.filter((preset) => !CREATIVE_PRESETS.some((builtin) => builtin.id === preset.id));
    const existingPreset = existingCustomPresets.find((preset) => preset.name === trimmedName);
    const nextPreset: CreativePreset = existingPreset
      ? { ...existingPreset, prompt: roleAndStyle }
      : {
          id: `user-${Date.now()}`,
          name: trimmedName,
          prompt: roleAndStyle,
        };

    const nextCustomPresets = existingPreset
      ? existingCustomPresets.map((preset) => (preset.id === existingPreset.id ? nextPreset : preset))
      : [...existingCustomPresets, nextPreset];
    const nextPresets = [...CREATIVE_PRESETS, ...nextCustomPresets];

    setCreativePresets(nextPresets);
    setJSON('creativePresets', nextCustomPresets);
    updateCreativeSettings({ presetId: nextPreset.id });
  }, [creativePresets, orchestrator, updateCreativeSettings]);

  const deleteCreativePreset = useCallback((presetId: string) => {
    const isBuiltinPreset = CREATIVE_PRESETS.some((preset) => preset.id === presetId);
    if (presetId === CUSTOM_PRESET_ID || isBuiltinPreset) {
      return;
    }

    const nextCustomPresets = creativePresets.filter(
      (preset) => !CREATIVE_PRESETS.some((builtin) => builtin.id === preset.id) && preset.id !== presetId
    );
    const nextPresets = [...CREATIVE_PRESETS, ...nextCustomPresets];
    setCreativePresets(nextPresets);
    setJSON('creativePresets', nextCustomPresets);

    if (orchestrator.getState().creativeSettings.presetId === presetId) {
      updateCreativeSettings({ presetId: CUSTOM_PRESET_ID });
    }
  }, [creativePresets, orchestrator, updateCreativeSettings]);

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
    if (!apiConfig.model.trim()) throw new Error('请先输入或选择模型');
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
    creativePresets,
    images,
    taskState,
    configLoaded,
    saveApiConfig,
    saveCreativePreset,
    deleteCreativePreset,
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
