'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { APIConfig, CreativePreset, CreativeSettings, ImageItem, OrchestratorConfig, TaskState } from '@/lib/types';
import {
  DEFAULT_CREATIVE_SETTINGS,
  DEFAULT_ORCHESTRATOR_CONFIG,
  DEFAULT_MEMORY_STATE,
  DEFAULT_STAGE_MODELS,
  DEFAULT_STORY_SYNTHESIS,
  REQUEST_STAGES,
} from '@/lib/types';
import { TaskOrchestrator } from '@/lib/task-orchestrator';
import { secureGet, secureRemove, secureSet, getJSON, setJSON } from '@/lib/crypto-store';
import { fetchModels as fetchProviderModels } from '@/lib/api-adapter';
import { createPreviewUrl, revokePreviewUrl } from '@/lib/image-pipeline';
import {
  CREATIVE_PRESETS,
  CUSTOM_PRESET_ID,
  composeSystemPrompt,
  resolveCreativePresetId,
  splitSystemPrompt,
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_BODY,
  USER_PROMPT_TEMPLATE,
} from '@/lib/prompts';

let idCounter = 0;
const CREATIVE_SETTINGS_TEMPLATE_VERSION = 6;

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

function canResolveModels(config: APIConfig): boolean {
  return REQUEST_STAGES.every((stage) => {
    const stageModel = config.stageModels[stage]?.trim() || '';
    return Boolean(stageModel || config.model.trim());
  });
}

export function useManga2Novel() {
  const orchestratorRef = useRef<TaskOrchestrator | null>(null);

  if (!orchestratorRef.current) {
    orchestratorRef.current = new TaskOrchestrator();
  }

  const orchestrator = orchestratorRef.current;

  const [apiConfig, setApiConfigState] = useState<APIConfig>({
    provider: 'openrouter',
    apiKey: '',
    model: '',
    baseUrl: '',
    stageModels: { ...DEFAULT_STAGE_MODELS },
  });
  const [images, setImages] = useState<ImageItem[]>([]);
  const [creativePresets, setCreativePresets] = useState<CreativePreset[]>(CREATIVE_PRESETS);
  const [taskState, setTaskState] = useState<TaskState>({
    status: 'idle',
    currentStage: 'idle',
    chunks: [],
    pageAnalyses: [],
    chunkSyntheses: [],
    globalSynthesis: {
      ...DEFAULT_STORY_SYNTHESIS,
      sceneOutline: [],
      writingConstraints: [],
    },
    novelSections: [],
    memory: { ...DEFAULT_MEMORY_STATE },
    config: { ...DEFAULT_ORCHESTRATOR_CONFIG },
    creativeSettings: {
      ...DEFAULT_CREATIVE_SETTINGS,
      systemPrompt: SYSTEM_PROMPT,
      userPromptTemplate: USER_PROMPT_TEMPLATE,
    },
    currentChunkIndex: -1,
    fullNovel: '',
    lastAIRequest: undefined,
  });
  const [configLoaded, setConfigLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const savedKey = await secureGet('apiKey');
      const savedModel = getJSON<string>('model');
      const savedBaseUrl = getJSON<string>('baseUrl');
      const savedStageModels = getJSON<APIConfig['stageModels']>('stageModels');
      const savedOrcConfig = getJSON<OrchestratorConfig>('orchestratorConfig');
      const savedCreativeSettings = getJSON<CreativeSettings>('creativeSettings');
      const savedCreativeSettingsTemplateVersion = getJSON<number>('creativeSettingsTemplateVersion');
      const savedCreativePresets = getJSON<CreativePreset[]>('creativePresets');

      const nextPresets = [
        ...CREATIVE_PRESETS,
        ...(savedCreativePresets?.filter((preset) => !CREATIVE_PRESETS.some((builtin) => builtin.id === preset.id)) || []),
      ];

      const nextApiConfig: APIConfig = {
        provider: 'openrouter',
        apiKey: savedKey || '',
        model: savedModel || '',
        baseUrl: savedBaseUrl || '',
        stageModels: { ...DEFAULT_STAGE_MODELS, ...(savedStageModels || {}) },
      };

      setApiConfigState(nextApiConfig);
      setCreativePresets(nextPresets);

      if (savedOrcConfig) {
        orchestrator.updateConfig(savedOrcConfig);
      }

      const nextCreativeSettings: CreativeSettings = {
        ...DEFAULT_CREATIVE_SETTINGS,
        systemPrompt: SYSTEM_PROMPT,
        userPromptTemplate: USER_PROMPT_TEMPLATE,
        ...savedCreativeSettings,
      };

      if (savedCreativeSettingsTemplateVersion !== CREATIVE_SETTINGS_TEMPLATE_VERSION) {
        const { supplementalPrompt, roleAndStyle } = splitSystemPrompt(nextCreativeSettings.systemPrompt);
        nextCreativeSettings.systemPrompt = composeSystemPrompt(supplementalPrompt, roleAndStyle, SYSTEM_PROMPT_BODY);
        nextCreativeSettings.userPromptTemplate = (nextCreativeSettings.userPromptTemplate.trim() || USER_PROMPT_TEMPLATE)
          .replace(/\n?\{\{safetyInstruction\}\}\n?/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        setJSON('creativeSettingsTemplateVersion', CREATIVE_SETTINGS_TEMPLATE_VERSION);
        setJSON('creativeSettings', nextCreativeSettings);
      }

      nextCreativeSettings.presetId = resolvePresetIdFromPresets(nextCreativeSettings.systemPrompt, nextPresets);
      orchestrator.setAPIConfig(nextApiConfig);
      orchestrator.updateCreativeSettings(nextCreativeSettings);

      setTaskState((prev) => ({
        ...prev,
        config: savedOrcConfig ? { ...DEFAULT_ORCHESTRATOR_CONFIG, ...savedOrcConfig } : prev.config,
        creativeSettings: nextCreativeSettings,
      }));
      setConfigLoaded(true);
    })();
  }, [orchestrator]);

  useEffect(() => {
    return orchestrator.on((event) => {
      setTaskState(event.state);
    });
  }, [orchestrator]);

  const saveApiConfig = useCallback(async (config: APIConfig) => {
    const normalizedConfig: APIConfig = {
      provider: 'openrouter',
      apiKey: config.apiKey.trim(),
      model: config.model.trim(),
      baseUrl: config.baseUrl?.trim() || '',
      stageModels: REQUEST_STAGES.reduce((result, stage) => {
        result[stage] = config.stageModels[stage]?.trim() || '';
        return result;
      }, { ...DEFAULT_STAGE_MODELS }),
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
    setJSON('stageModels', normalizedConfig.stageModels);
    orchestrator.setAPIConfig(normalizedConfig);
  }, [orchestrator]);

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

    if (settings.presetId === CUSTOM_PRESET_ID && settings.systemPrompt === undefined) {
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

  const addImages = useCallback((files: File[]) => {
    const newImages: ImageItem[] = files.map((file) => ({
      id: `img_${Date.now()}_${++idCounter}`,
      file,
      previewUrl: createPreviewUrl(file),
      status: 'pending',
      originalSize: file.size,
    }));
    setImages((prev) => [...prev, ...newImages]);
  }, []);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const image = prev.find((item) => item.id === id);
      if (image) {
        revokePreviewUrl(image.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const reorderImages = useCallback((fromIndex: number, toIndex: number) => {
    setImages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const clearImages = useCallback(() => {
    images.forEach((image) => revokePreviewUrl(image.previewUrl));
    setImages([]);
  }, [images]);

  const startProcessing = useCallback(async () => {
    if (!apiConfig.apiKey) {
      throw new Error('请先配置 API Key');
    }
    if (!canResolveModels(apiConfig)) {
      throw new Error('请至少填写主模型，或为四个阶段分别配置模型');
    }

    orchestrator.setAPIConfig(apiConfig);
    await orchestrator.prepare(images);
    setImages([...images]);
    await orchestrator.run();
  }, [apiConfig, images, orchestrator]);

  const pause = useCallback(() => {
    orchestrator.pause();
  }, [orchestrator]);

  const resume = useCallback(async () => {
    await orchestrator.resume();
  }, [orchestrator]);

  const skipCurrent = useCallback(async () => {
    await orchestrator.skipAndContinue();
  }, [orchestrator]);

  const retryCurrent = useCallback(async () => {
    await orchestrator.retryCurrentAndContinue();
  }, [orchestrator]);

  const rerunFailed = useCallback(async () => {
    await orchestrator.rerunFailedAndContinue();
  }, [orchestrator]);

  const reset = useCallback(() => {
    orchestrator.reset();
  }, [orchestrator]);

  const exportNovel = useCallback((format: 'txt' | 'md' = 'txt') => {
    const content = format === 'md'
      ? `# Manga2Novel 输出\n\n${taskState.fullNovel}`
      : taskState.fullNovel;
    const mimeType = format === 'md'
      ? 'text/markdown;charset=utf-8'
      : 'text/plain;charset=utf-8';
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `manga2novel_${new Date().toISOString().slice(0, 10)}.${format}`;
    anchor.click();
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
    rerunFailed,
    reset,
    exportNovel,
  };
}
