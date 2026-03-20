'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  APIConfig,
  APIProfileSummary,
  CreativePreset,
  CreativeSettings,
  ImageItem,
  OrchestratorConfig,
  RequestStage,
  ScenePlan,
  StageAPIOverrideConfig,
  StageAPIOverrideMap,
  TaskState,
} from '@/lib/types';
import {
  DEFAULT_COMPATIBLE_BASE_URL,
  DEFAULT_CREATIVE_SETTINGS,
  DEFAULT_FINAL_POLISH,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_ORCHESTRATOR_CONFIG,
  DEFAULT_MEMORY_STATE,
  DEFAULT_STAGE_API_OVERRIDES,
  DEFAULT_STAGE_MODELS,
  DEFAULT_STORY_SYNTHESIS,
  DEFAULT_WRITING_PREPARATION,
  GEMINI_ROOT_BASE_URL,
  getEnabledRequestStages,
  LEGACY_OPENROUTER_BASE_URL,
  PROVIDER_DISPLAY_NAMES,
  REQUEST_STAGES,
  resolveProviderDisplayLabel,
  resolveStageAPIConfig,
  resolveStageModel,
} from '@/lib/types';
import { TaskOrchestrator } from '@/lib/task-orchestrator';
import { secureGet, secureRemove, secureSet, getJSON, setJSON } from '@/lib/crypto-store';
import { fetchModels as fetchProviderModels } from '@/lib/api-adapter';
import { createPreviewUrl, revokePreviewUrl } from '@/lib/image-pipeline';
import {
  clearWorkspaceSnapshot,
  loadWorkspaceSnapshot,
  saveWorkspaceImageFiles,
  saveWorkspaceImageMeta,
  saveWorkspaceTaskState,
  serializeImages,
  serializeTaskState,
  type PersistedTaskState,
  type RestorableImageItem,
} from '@/lib/workspace-store';
import {
  CREATIVE_PRESETS,
  CUSTOM_PRESET_ID,
  composeSystemPrompt,
  DEFAULT_SUPPLEMENTAL_PROMPT,
  resolveCreativePresetId,
  splitSystemPrompt,
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_BODY,
  USER_PROMPT_TEMPLATE,
} from '@/lib/prompts';

let idCounter = 0;
const CREATIVE_SETTINGS_TEMPLATE_VERSION = 7;
const ORCHESTRATOR_CONFIG_TEMPLATE_VERSION = 2;
const API_PROFILES_STORAGE_KEY = 'apiProfiles';
const ACTIVE_API_PROFILE_ID_STORAGE_KEY = 'activeApiProfileId';
const DEFAULT_API_PROFILE_NAME = '默认配置';

interface StoredAPIProfile extends APIProfileSummary {
  provider: APIConfig['provider'];
  providerLabel?: string;
  model: string;
  baseUrl?: string;
  stageModels: APIConfig['stageModels'];
  stageAPIOverrides: Record<RequestStage, Omit<StageAPIOverrideConfig, 'apiKey'>>;
}

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

function migrateOrchestratorConfig(
  config: OrchestratorConfig | null | undefined,
  savedVersion: number | null | undefined
): OrchestratorConfig | null {
  if (!config) {
    return null;
  }

  const mergedConfig: OrchestratorConfig = {
    ...DEFAULT_ORCHESTRATOR_CONFIG,
    ...config,
  };

  if (savedVersion === ORCHESTRATOR_CONFIG_TEMPLATE_VERSION) {
    return mergedConfig;
  }

  const nextConfig: OrchestratorConfig = { ...mergedConfig };

  if (config.chunkSize === 1) {
    nextConfig.chunkSize = DEFAULT_ORCHESTRATOR_CONFIG.chunkSize;
  }

  if (config.includeSectionImages === false) {
    nextConfig.includeSectionImages = DEFAULT_ORCHESTRATOR_CONFIG.includeSectionImages;
  }

  if (config.enableFinalPolish === false) {
    nextConfig.enableFinalPolish = DEFAULT_ORCHESTRATOR_CONFIG.enableFinalPolish;
  }

  return nextConfig;
}

function canResolveModels(
  config: APIConfig,
  orchestratorConfig?: Pick<OrchestratorConfig, 'enableFinalPolish' | 'workflowMode'>
): boolean {
  return getEnabledRequestStages(orchestratorConfig).every((stage) => Boolean(resolveStageModel(config, stage)));
}

function normalizeProviderLabel(config: Pick<APIConfig, 'provider' | 'providerLabel'>): string {
  return resolveProviderDisplayLabel(config.provider, config.providerLabel);
}

function normalizeProvider(provider: APIConfig['provider'] | 'openrouter' | null | undefined): APIConfig['provider'] {
  if (provider === 'gemini') {
    return 'gemini';
  }

  return 'compatible';
}

function normalizeBaseUrl(
  provider: APIConfig['provider'],
  baseUrl: string | null | undefined,
  legacyProvider?: APIConfig['provider'] | 'openrouter' | null
): string {
  const normalizedBaseUrl = baseUrl?.trim().replace(/\/+$/, '') || '';
  if (normalizedBaseUrl) {
    if (provider === 'gemini') {
      try {
        const parsedUrl = new URL(normalizedBaseUrl);
        const normalizedPath = parsedUrl.pathname.replace(/\/+$/, '');

        if (
          parsedUrl.origin.toLowerCase() === GEMINI_ROOT_BASE_URL
          && (!normalizedPath || normalizedPath === '/v1beta')
        ) {
          return GEMINI_ROOT_BASE_URL;
        }
      } catch {
        const loweredBaseUrl = normalizedBaseUrl.toLowerCase();
        if (loweredBaseUrl === GEMINI_ROOT_BASE_URL || loweredBaseUrl === DEFAULT_GEMINI_BASE_URL) {
          return GEMINI_ROOT_BASE_URL;
        }
      }
    }

    return normalizedBaseUrl;
  }

  if (provider === 'compatible' && legacyProvider === 'openrouter') {
    return LEGACY_OPENROUTER_BASE_URL;
  }

  return '';
}

function normalizeStageAPIOverride(
  stage: RequestStage,
  override: Partial<StageAPIOverrideConfig> | null | undefined,
  stageApiKeys?: Partial<Record<RequestStage, string>>
): StageAPIOverrideConfig {
  const provider = normalizeProvider(override?.provider);

  return {
    enabled: Boolean(override?.enabled),
    provider,
    providerLabel: normalizeProviderLabel({
      provider,
      providerLabel: override?.providerLabel || '',
    }),
    apiKey: stageApiKeys?.[stage]?.trim() || override?.apiKey?.trim() || '',
    model: override?.model?.trim() || '',
    baseUrl: normalizeBaseUrl(provider, override?.baseUrl),
  };
}

function normalizeStageAPIOverrides(
  overrides: Partial<Record<RequestStage, Partial<StageAPIOverrideConfig>>> | null | undefined,
  stageApiKeys?: Partial<Record<RequestStage, string>>
): StageAPIOverrideMap {
  return REQUEST_STAGES.reduce((result, stage) => {
    result[stage] = normalizeStageAPIOverride(stage, overrides?.[stage], stageApiKeys);
    return result;
  }, { ...DEFAULT_STAGE_API_OVERRIDES });
}

function serializeStageAPIOverrides(overrides: StageAPIOverrideMap): Record<RequestStage, Omit<StageAPIOverrideConfig, 'apiKey'>> {
  return REQUEST_STAGES.reduce((result, stage) => {
    const override = overrides[stage];
    result[stage] = {
      enabled: override.enabled,
      provider: override.provider,
      providerLabel: normalizeProviderLabel({
        provider: override.provider,
        providerLabel: override.providerLabel || '',
      }),
      model: override.model.trim(),
      baseUrl: override.baseUrl?.trim() || '',
    };
    return result;
  }, {} as Record<RequestStage, Omit<StageAPIOverrideConfig, 'apiKey'>>);
}

function extractStageApiKeys(overrides: StageAPIOverrideMap): Partial<Record<RequestStage, string>> {
  return REQUEST_STAGES.reduce((result, stage) => {
    const apiKey = overrides[stage].apiKey.trim();
    if (apiKey) {
      result[stage] = apiKey;
    }
    return result;
  }, {} as Partial<Record<RequestStage, string>>);
}

function normalizeStageModels(stageModels: Partial<APIConfig['stageModels']> | null | undefined): APIConfig['stageModels'] {
  return REQUEST_STAGES.reduce((result, stage) => {
    result[stage] = stageModels?.[stage]?.trim() || '';
    return result;
  }, { ...DEFAULT_STAGE_MODELS });
}

function normalizeApiConfig(config: APIConfig): APIConfig {
  return {
    provider: config.provider,
    providerLabel: normalizeProviderLabel(config),
    apiKey: config.apiKey.trim(),
    model: config.model.trim(),
    baseUrl: normalizeBaseUrl(config.provider, config.baseUrl),
    stageModels: normalizeStageModels(config.stageModels),
    stageAPIOverrides: normalizeStageAPIOverrides(config.stageAPIOverrides),
  };
}

function createEmptyApiConfig(): APIConfig {
  return {
    provider: 'compatible',
    providerLabel: PROVIDER_DISPLAY_NAMES.compatible,
    apiKey: '',
    model: '',
    baseUrl: DEFAULT_COMPATIBLE_BASE_URL,
    stageModels: { ...DEFAULT_STAGE_MODELS },
    stageAPIOverrides: { ...DEFAULT_STAGE_API_OVERRIDES },
  };
}

function createApiProfileId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getProfileApiKeyStorageKey(profileId: string): string {
  return `apiKey_profile_${profileId}`;
}

function getProfileStageApiKeysStorageKey(profileId: string): string {
  return `stageApiKeys_profile_${profileId}`;
}

function buildStoredApiProfile(
  profileId: string,
  profileName: string,
  config: APIConfig,
  updatedAt = new Date().toISOString()
): StoredAPIProfile {
  const normalizedConfig = normalizeApiConfig(config);

  return {
    id: profileId,
    name: profileName.trim() || DEFAULT_API_PROFILE_NAME,
    updatedAt,
    provider: normalizedConfig.provider,
    providerLabel: normalizedConfig.providerLabel || PROVIDER_DISPLAY_NAMES[normalizedConfig.provider],
    model: normalizedConfig.model,
    baseUrl: normalizedConfig.baseUrl || '',
    stageModels: normalizedConfig.stageModels,
    stageAPIOverrides: serializeStageAPIOverrides(normalizedConfig.stageAPIOverrides),
  };
}

function normalizeStoredApiProfile(profile: Partial<StoredAPIProfile> | null | undefined): StoredAPIProfile {
  const provider = normalizeProvider(profile?.provider);
  const normalizedConfig = normalizeApiConfig({
    provider,
    providerLabel: profile?.providerLabel || PROVIDER_DISPLAY_NAMES[provider],
    apiKey: '',
    model: profile?.model || '',
    baseUrl: normalizeBaseUrl(provider, profile?.baseUrl),
    stageModels: { ...DEFAULT_STAGE_MODELS, ...(profile?.stageModels || {}) },
    stageAPIOverrides: normalizeStageAPIOverrides(profile?.stageAPIOverrides as Partial<StageAPIOverrideMap> | undefined),
  });

  return buildStoredApiProfile(
    profile?.id || createApiProfileId(),
    profile?.name || DEFAULT_API_PROFILE_NAME,
    normalizedConfig,
    profile?.updatedAt || new Date().toISOString()
  );
}

function parseStageApiKeys(raw: string | null): Partial<Record<RequestStage, string>> | undefined {
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as Partial<Record<RequestStage, string>>;
  } catch {
    return undefined;
  }
}

async function loadApiConfigFromProfile(profile: StoredAPIProfile): Promise<APIConfig> {
  const [savedKey, savedStageApiKeysRaw] = await Promise.all([
    secureGet(getProfileApiKeyStorageKey(profile.id)),
    secureGet(getProfileStageApiKeysStorageKey(profile.id)),
  ]);

  return normalizeApiConfig({
    provider: profile.provider,
    providerLabel: profile.providerLabel || PROVIDER_DISPLAY_NAMES[profile.provider],
    apiKey: savedKey || '',
    model: profile.model,
    baseUrl: profile.baseUrl || '',
    stageModels: profile.stageModels,
    stageAPIOverrides: normalizeStageAPIOverrides(profile.stageAPIOverrides, parseStageApiKeys(savedStageApiKeysRaw)),
  });
}

async function persistApiConfigSecrets(profileId: string, config: APIConfig): Promise<void> {
  const normalizedConfig = normalizeApiConfig(config);
  const stageApiKeys = extractStageApiKeys(normalizedConfig.stageAPIOverrides);

  if (normalizedConfig.apiKey) {
    await secureSet(getProfileApiKeyStorageKey(profileId), normalizedConfig.apiKey);
  } else {
    secureRemove(getProfileApiKeyStorageKey(profileId));
  }

  if (Object.keys(stageApiKeys).length > 0) {
    await secureSet(getProfileStageApiKeysStorageKey(profileId), JSON.stringify(stageApiKeys));
  } else {
    secureRemove(getProfileStageApiKeysStorageKey(profileId));
  }
}

async function syncLegacyActiveApiConfig(config: APIConfig): Promise<void> {
  const normalizedConfig = normalizeApiConfig(config);
  const stageApiKeys = extractStageApiKeys(normalizedConfig.stageAPIOverrides);

  if (normalizedConfig.apiKey) {
    await secureSet('apiKey', normalizedConfig.apiKey);
  } else {
    secureRemove('apiKey');
  }

  if (Object.keys(stageApiKeys).length > 0) {
    await secureSet('stageApiKeys', JSON.stringify(stageApiKeys));
  } else {
    secureRemove('stageApiKeys');
  }

  setJSON('provider', normalizedConfig.provider);
  setJSON('providerLabel', normalizedConfig.providerLabel || '');
  setJSON('model', normalizedConfig.model);
  setJSON('baseUrl', normalizedConfig.baseUrl || '');
  setJSON('stageModels', normalizedConfig.stageModels);
  setJSON('stageAPIOverrides', serializeStageAPIOverrides(normalizedConfig.stageAPIOverrides));
}

function createProfileSummary(profile: StoredAPIProfile): APIProfileSummary {
  return {
    id: profile.id,
    name: profile.name,
    updatedAt: profile.updatedAt,
  };
}

function ensureUniqueProfileName(
  desiredName: string,
  profiles: StoredAPIProfile[],
  excludeProfileId?: string
): string {
  const baseName = desiredName.trim() || DEFAULT_API_PROFILE_NAME;
  const takenNames = new Set(
    profiles
      .filter((profile) => profile.id !== excludeProfileId)
      .map((profile) => profile.name.trim())
  );

  if (!takenNames.has(baseName)) {
    return baseName;
  }

  let suffix = 2;
  while (takenNames.has(`${baseName} ${suffix}`)) {
    suffix += 1;
  }

  return `${baseName} ${suffix}`;
}

function canResolveStageAccess(
  config: APIConfig,
  orchestratorConfig?: Pick<OrchestratorConfig, 'enableFinalPolish' | 'workflowMode'>
): boolean {
  return getEnabledRequestStages(orchestratorConfig).every((stage) => {
    const stageConfig = resolveStageAPIConfig(config, stage);
    return Boolean(stageConfig.apiKey.trim() && stageConfig.model.trim());
  });
}

function hasRestorableTaskState(taskState: TaskState): boolean {
  return taskState.status !== 'idle'
    || taskState.currentStage !== 'idle'
    || taskState.pageAnalyses.length > 0
    || taskState.chunkSyntheses.length > 0
    || taskState.novelSections.length > 0
    || Boolean(taskState.fullNovel)
    || Boolean(taskState.lastAIRequest);
}

function restoreImagesFromSnapshot(images: RestorableImageItem[]): ImageItem[] {
  return images.map((image) => ({
    id: image.id,
    file: image.file,
    previewUrl: createPreviewUrl(image.file),
    processedBase64: image.processedBase64,
    processedMime: image.processedMime,
    status: image.status,
    originalSize: image.originalSize,
    compressedSize: image.compressedSize,
  }));
}

function restoreTaskStateFromSnapshot(snapshot: PersistedTaskState, images: ImageItem[]): TaskState {
  const imageById = new Map(images.map((image) => [image.id, image]));

  return {
    ...snapshot,
    chunks: snapshot.chunks.map((chunk) => ({
      ...chunk,
      images: chunk.imageIds
        .map((imageId) => imageById.get(imageId))
        .filter((image): image is ImageItem => Boolean(image)),
    })),
  };
}

type RecoveryNoticeType = 'interrupted-task' | 'workspace-restored';

interface RecoveryNotice {
  type: RecoveryNoticeType;
  title: string;
  message: string;
}

function createRecoveryNotice(restoredImages: ImageItem[], restoredTaskState: TaskState | null): RecoveryNotice | null {
  const hasRestoredImages = restoredImages.length > 0;
  const hasRestoredTask = restoredTaskState ? hasRestorableTaskState(restoredTaskState) : false;

  if (!hasRestoredImages && !hasRestoredTask) {
    return null;
  }

  if (
    restoredTaskState
    && (restoredTaskState.status === 'paused' || restoredTaskState.lastAIRequest?.status === 'interrupted')
  ) {
    return {
      type: 'interrupted-task',
      title: '已恢复上次任务',
      message: '页面刷新后，正在生成的请求已中断，但图片和进度已经保留。点击“继续”即可从当前进度恢复。',
    };
  }

  if (hasRestoredTask) {
    return {
      type: 'workspace-restored',
      title: '已恢复上次工作区',
      message: '上次的图片和处理进度已经恢复，你可以继续查看结果，或直接从当前状态继续操作。',
    };
  }

  return {
    type: 'workspace-restored',
    title: '已恢复上次图片',
    message: '上次上传的图片已经恢复，可以直接继续配置或开始处理。',
  };
}

export function useManga2Novel() {
  const orchestratorRef = useRef<TaskOrchestrator | null>(null);
  const imageFilesSignatureRef = useRef('');
  const imageFilesSaveTimerRef = useRef<number | null>(null);
  const imageMetaSaveTimerRef = useRef<number | null>(null);
  const taskStateSaveTimerRef = useRef<number | null>(null);

  if (!orchestratorRef.current) {
    orchestratorRef.current = new TaskOrchestrator();
  }

  const orchestrator = orchestratorRef.current;

  const [apiConfig, setApiConfigState] = useState<APIConfig>(createEmptyApiConfig);
  const [apiProfiles, setApiProfiles] = useState<StoredAPIProfile[]>([]);
  const [activeApiProfileId, setActiveApiProfileIdState] = useState('');
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
    writingPreparation: { ...DEFAULT_WRITING_PREPARATION },
    novelSections: [],
    finalPolish: { ...DEFAULT_FINAL_POLISH },
    memory: { ...DEFAULT_MEMORY_STATE },
    config: { ...DEFAULT_ORCHESTRATOR_CONFIG },
    creativeSettings: {
      ...DEFAULT_CREATIVE_SETTINGS,
      systemPrompt: SYSTEM_PROMPT,
      userPromptTemplate: USER_PROMPT_TEMPLATE,
    },
    currentChunkIndex: -1,
    fullNovel: '',
    runtimeMs: 0,
    runtimeStartedAt: undefined,
    lastAIRequest: undefined,
  });
  const [configLoaded, setConfigLoaded] = useState(false);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState<RecoveryNotice | null>(null);

  useEffect(() => {
    (async () => {
      const savedOrcConfig = getJSON<OrchestratorConfig>('orchestratorConfig');
      const savedOrchestratorConfigTemplateVersion = getJSON<number>('orchestratorConfigTemplateVersion');
      const savedCreativeSettings = getJSON<CreativeSettings>('creativeSettings');
      const savedCreativeSettingsTemplateVersion = getJSON<number>('creativeSettingsTemplateVersion');
      const savedCreativePresets = getJSON<CreativePreset[]>('creativePresets');
      const nextOrchestratorConfig = migrateOrchestratorConfig(savedOrcConfig, savedOrchestratorConfigTemplateVersion);

      const nextPresets = [
        ...CREATIVE_PRESETS,
        ...(savedCreativePresets?.filter((preset) => !CREATIVE_PRESETS.some((builtin) => builtin.id === preset.id)) || []),
      ];

      const storedProfiles = (getJSON<StoredAPIProfile[]>(API_PROFILES_STORAGE_KEY) || []).map((profile) => (
        normalizeStoredApiProfile(profile)
      ));
      const savedActiveProfileId = getJSON<string>(ACTIVE_API_PROFILE_ID_STORAGE_KEY);
      let nextProfiles = storedProfiles;
      let nextActiveProfileId = savedActiveProfileId || storedProfiles[0]?.id || '';
      let nextApiConfig = createEmptyApiConfig();

      if (nextProfiles.length === 0) {
        const [savedKey, savedStageApiKeysRaw] = await Promise.all([
          secureGet('apiKey'),
          secureGet('stageApiKeys'),
        ]);
        const savedProvider = getJSON<APIConfig['provider']>('provider');
        const savedProviderLabel = getJSON<string>('providerLabel');
        const savedModel = getJSON<string>('model');
        const savedBaseUrl = getJSON<string>('baseUrl');
        const savedStageModels = getJSON<APIConfig['stageModels']>('stageModels');
        const savedStageAPIOverrides = getJSON<Partial<StageAPIOverrideMap>>('stageAPIOverrides');
        const nextProvider = normalizeProvider(savedProvider as APIConfig['provider'] | 'openrouter' | null | undefined);
        const legacyConfig = normalizeApiConfig({
          provider: nextProvider,
          providerLabel: normalizeProviderLabel({
            provider: nextProvider,
            providerLabel: savedProviderLabel || '',
          }),
          apiKey: savedKey || '',
          model: savedModel || '',
          baseUrl: normalizeBaseUrl(
            nextProvider,
            savedBaseUrl,
            savedProvider as APIConfig['provider'] | 'openrouter' | null | undefined
          ),
          stageModels: { ...DEFAULT_STAGE_MODELS, ...(savedStageModels || {}) },
          stageAPIOverrides: normalizeStageAPIOverrides(savedStageAPIOverrides, parseStageApiKeys(savedStageApiKeysRaw)),
        });

        const defaultProfile = buildStoredApiProfile(createApiProfileId(), DEFAULT_API_PROFILE_NAME, legacyConfig);
        nextProfiles = [defaultProfile];
        nextActiveProfileId = defaultProfile.id;
        nextApiConfig = legacyConfig;

        setJSON(API_PROFILES_STORAGE_KEY, nextProfiles);
        setJSON(ACTIVE_API_PROFILE_ID_STORAGE_KEY, nextActiveProfileId);
        await persistApiConfigSecrets(defaultProfile.id, legacyConfig);
      } else {
        const activeProfile = nextProfiles.find((profile) => profile.id === nextActiveProfileId) || nextProfiles[0];
        nextActiveProfileId = activeProfile.id;
        nextApiConfig = await loadApiConfigFromProfile(activeProfile);

        setJSON(API_PROFILES_STORAGE_KEY, nextProfiles);
        setJSON(ACTIVE_API_PROFILE_ID_STORAGE_KEY, nextActiveProfileId);
      }

      setApiConfigState(nextApiConfig);
      setApiProfiles(nextProfiles);
      setActiveApiProfileIdState(nextActiveProfileId);
      setCreativePresets(nextPresets);
      if (nextOrchestratorConfig) {
        orchestrator.updateConfig(nextOrchestratorConfig);
        if (savedOrchestratorConfigTemplateVersion !== ORCHESTRATOR_CONFIG_TEMPLATE_VERSION) {
          setJSON('orchestratorConfigTemplateVersion', ORCHESTRATOR_CONFIG_TEMPLATE_VERSION);
          setJSON('orchestratorConfig', nextOrchestratorConfig);
        }
      }

      const nextCreativeSettings: CreativeSettings = {
        ...DEFAULT_CREATIVE_SETTINGS,
        systemPrompt: SYSTEM_PROMPT,
        userPromptTemplate: USER_PROMPT_TEMPLATE,
        ...savedCreativeSettings,
      };

      if (savedCreativeSettingsTemplateVersion !== CREATIVE_SETTINGS_TEMPLATE_VERSION) {
        const { supplementalPrompt, roleAndStyle } = splitSystemPrompt(nextCreativeSettings.systemPrompt);
        nextCreativeSettings.systemPrompt = composeSystemPrompt(
          supplementalPrompt.trim() || DEFAULT_SUPPLEMENTAL_PROMPT,
          roleAndStyle,
          SYSTEM_PROMPT_BODY
        );
        nextCreativeSettings.userPromptTemplate = (nextCreativeSettings.userPromptTemplate.trim() || USER_PROMPT_TEMPLATE)
          .replace(/\n?\{\{safetyInstruction\}\}\n?/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        setJSON('creativeSettingsTemplateVersion', CREATIVE_SETTINGS_TEMPLATE_VERSION);
        setJSON('creativeSettings', nextCreativeSettings);
      }

      nextCreativeSettings.presetId = resolvePresetIdFromPresets(nextCreativeSettings.systemPrompt, nextPresets);
      await syncLegacyActiveApiConfig(nextApiConfig);
      orchestrator.setAPIConfig(nextApiConfig);
      orchestrator.updateCreativeSettings(nextCreativeSettings);

      setTaskState((prev) => ({
        ...prev,
        config: nextOrchestratorConfig || prev.config,
        creativeSettings: nextCreativeSettings,
      }));
      setConfigLoaded(true);
    })();
  }, [orchestrator]);

  useEffect(() => {
    return orchestrator.on((event) => {
      setTaskState(event.state);
      if (event.type === 'image-processed') {
        setImages((prev) => [...prev]);
      }
    });
  }, [orchestrator]);

  useEffect(() => {
    if (!configLoaded || workspaceLoaded) {
      return;
    }

    let isCancelled = false;

    (async () => {
      try {
        const snapshot = await loadWorkspaceSnapshot();
        if (isCancelled || !snapshot) {
          return;
        }

        const restoredImages = restoreImagesFromSnapshot(snapshot.images);
        setImages(restoredImages);

        let restoredTaskState: TaskState | null = null;
        if (snapshot.taskState) {
          restoredTaskState = restoreTaskStateFromSnapshot(snapshot.taskState, restoredImages);
          orchestrator.restoreState(restoredTaskState);
        }

        setRecoveryNotice(createRecoveryNotice(restoredImages, restoredTaskState));
      } finally {
        if (!isCancelled) {
          setWorkspaceLoaded(true);
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [configLoaded, orchestrator, workspaceLoaded]);

  useEffect(() => {
    if (!workspaceLoaded) {
      return;
    }

    const workspaceEmpty = images.length === 0 && !hasRestorableTaskState(taskState);
    if (!workspaceEmpty) {
      return;
    }

    setRecoveryNotice(null);
    void clearWorkspaceSnapshot();
  }, [images.length, taskState, workspaceLoaded]);

  useEffect(() => {
    if (!workspaceLoaded) {
      return;
    }

    const nextSignature = images.map((image) => `${image.id}:${image.file.name}:${image.file.size}`).join('|');
    if (nextSignature === imageFilesSignatureRef.current) {
      return;
    }

    imageFilesSignatureRef.current = nextSignature;

    if (imageFilesSaveTimerRef.current !== null) {
      window.clearTimeout(imageFilesSaveTimerRef.current);
    }

    imageFilesSaveTimerRef.current = window.setTimeout(() => {
      void saveWorkspaceImageFiles(images);
      imageFilesSaveTimerRef.current = null;
    }, 100);

    return () => {
      if (imageFilesSaveTimerRef.current !== null) {
        window.clearTimeout(imageFilesSaveTimerRef.current);
        imageFilesSaveTimerRef.current = null;
      }
    };
  }, [images, workspaceLoaded]);

  useEffect(() => {
    if (!workspaceLoaded) {
      return;
    }

    if (imageMetaSaveTimerRef.current !== null) {
      window.clearTimeout(imageMetaSaveTimerRef.current);
    }

    imageMetaSaveTimerRef.current = window.setTimeout(() => {
      void saveWorkspaceImageMeta(serializeImages(images));
      imageMetaSaveTimerRef.current = null;
    }, 100);

    return () => {
      if (imageMetaSaveTimerRef.current !== null) {
        window.clearTimeout(imageMetaSaveTimerRef.current);
        imageMetaSaveTimerRef.current = null;
      }
    };
  }, [images, workspaceLoaded]);

  useEffect(() => {
    if (!workspaceLoaded || (images.length === 0 && !hasRestorableTaskState(taskState))) {
      return;
    }

    if (taskStateSaveTimerRef.current !== null) {
      window.clearTimeout(taskStateSaveTimerRef.current);
    }

    taskStateSaveTimerRef.current = window.setTimeout(() => {
      void saveWorkspaceTaskState(hasRestorableTaskState(taskState) ? serializeTaskState(taskState) : null);
      taskStateSaveTimerRef.current = null;
    }, 100);

    return () => {
      if (taskStateSaveTimerRef.current !== null) {
        window.clearTimeout(taskStateSaveTimerRef.current);
        taskStateSaveTimerRef.current = null;
      }
    };
  }, [images.length, taskState, workspaceLoaded]);

  const saveApiConfig = useCallback(async (
    config: APIConfig,
    options?: { profileName?: string }
  ) => {
    const normalizedConfig = normalizeApiConfig(config);
    const fallbackProfile = buildStoredApiProfile(createApiProfileId(), DEFAULT_API_PROFILE_NAME, normalizedConfig);
    const currentProfile = apiProfiles.find((profile) => profile.id === activeApiProfileId) || fallbackProfile;
    const nextProfile = buildStoredApiProfile(
      currentProfile.id,
      ensureUniqueProfileName(options?.profileName || currentProfile.name, apiProfiles, currentProfile.id),
      normalizedConfig
    );
    const nextProfiles = apiProfiles.some((profile) => profile.id === currentProfile.id)
      ? apiProfiles.map((profile) => (profile.id === currentProfile.id ? nextProfile : profile))
      : [...apiProfiles, nextProfile];

    setApiConfigState(normalizedConfig);
    setApiProfiles(nextProfiles);
    setActiveApiProfileIdState(nextProfile.id);
    setJSON(API_PROFILES_STORAGE_KEY, nextProfiles);
    setJSON(ACTIVE_API_PROFILE_ID_STORAGE_KEY, nextProfile.id);
    await persistApiConfigSecrets(nextProfile.id, normalizedConfig);
    await syncLegacyActiveApiConfig(normalizedConfig);
    orchestrator.setAPIConfig(normalizedConfig);
  }, [activeApiProfileId, apiProfiles, orchestrator]);

  const selectApiProfile = useCallback(async (profileId: string) => {
    const nextProfile = apiProfiles.find((profile) => profile.id === profileId);
    if (!nextProfile) {
      throw new Error('未找到要切换的 API 配置档');
    }

    const nextConfig = await loadApiConfigFromProfile(nextProfile);
    setApiConfigState(nextConfig);
    setActiveApiProfileIdState(nextProfile.id);
    setJSON(ACTIVE_API_PROFILE_ID_STORAGE_KEY, nextProfile.id);
    await syncLegacyActiveApiConfig(nextConfig);
    orchestrator.setAPIConfig(nextConfig);
  }, [apiProfiles, orchestrator]);

  const duplicateApiProfile = useCallback(async (
    config: APIConfig,
    profileName?: string
  ) => {
    const normalizedConfig = normalizeApiConfig(config);
    const nextProfileId = createApiProfileId();
    const nextProfile = buildStoredApiProfile(
      nextProfileId,
      ensureUniqueProfileName(profileName || `${DEFAULT_API_PROFILE_NAME} 副本`, apiProfiles),
      normalizedConfig
    );
    const nextProfiles = [...apiProfiles, nextProfile];

    setApiProfiles(nextProfiles);
    setApiConfigState(normalizedConfig);
    setActiveApiProfileIdState(nextProfileId);
    setJSON(API_PROFILES_STORAGE_KEY, nextProfiles);
    setJSON(ACTIVE_API_PROFILE_ID_STORAGE_KEY, nextProfileId);
    await persistApiConfigSecrets(nextProfileId, normalizedConfig);
    await syncLegacyActiveApiConfig(normalizedConfig);
    orchestrator.setAPIConfig(normalizedConfig);
  }, [apiProfiles, orchestrator]);

  const deleteApiProfile = useCallback(async (profileId: string) => {
    if (apiProfiles.length <= 1) {
      throw new Error('至少保留一个 API 配置档');
    }

    const remainingProfiles = apiProfiles.filter((profile) => profile.id !== profileId);
    const nextActiveProfile = profileId === activeApiProfileId
      ? remainingProfiles[0]
      : remainingProfiles.find((profile) => profile.id === activeApiProfileId) || remainingProfiles[0];

    setApiProfiles(remainingProfiles);
    setJSON(API_PROFILES_STORAGE_KEY, remainingProfiles);
    secureRemove(getProfileApiKeyStorageKey(profileId));
    secureRemove(getProfileStageApiKeysStorageKey(profileId));

    if (!nextActiveProfile) {
      return;
    }

    const nextConfig = profileId === activeApiProfileId
      ? await loadApiConfigFromProfile(nextActiveProfile)
      : apiConfig;

    setActiveApiProfileIdState(nextActiveProfile.id);
    setJSON(ACTIVE_API_PROFILE_ID_STORAGE_KEY, nextActiveProfile.id);

    if (profileId === activeApiProfileId) {
      setApiConfigState(nextConfig);
      await syncLegacyActiveApiConfig(nextConfig);
      orchestrator.setAPIConfig(nextConfig);
    }
  }, [activeApiProfileId, apiConfig, apiProfiles, orchestrator]);

  const saveOrchestratorConfig = useCallback((config: Partial<OrchestratorConfig>) => {
    orchestrator.updateConfig(config);
    const current = orchestrator.getState().config;
    setJSON('orchestratorConfig', current);
    setJSON('orchestratorConfigTemplateVersion', ORCHESTRATOR_CONFIG_TEMPLATE_VERSION);
    setTaskState(orchestrator.getState());
  }, [orchestrator]);

  const fetchModels = useCallback(async (config: Pick<APIConfig, 'provider' | 'providerLabel' | 'apiKey' | 'baseUrl'>) => {
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

  const dismissRecoveryNotice = useCallback(() => {
    setRecoveryNotice(null);
  }, []);

const startProcessing = useCallback(async () => {
    const enabledStages = getEnabledRequestStages(taskState.config);

    if (!canResolveStageAccess(apiConfig, taskState.config)) {
      throw new Error('请先补全各阶段可用的 API Key 和模型。独立接口阶段可以填自己的 Key / 模型，其余阶段会沿用默认接口。');
    }
    if (!apiConfig.apiKey && !enabledStages.some((stage) => apiConfig.stageAPIOverrides[stage].enabled)) {
      throw new Error('请先配置 API Key');
    }
    if (!canResolveModels(apiConfig, taskState.config)) {
      throw new Error('请至少填写主模型，或为各阶段分别配置模型');
    }

    setRecoveryNotice(null);
    orchestrator.setAPIConfig(apiConfig);
    await orchestrator.prepare(images);
    setImages([...images]);
    await orchestrator.run();
  }, [apiConfig, images, orchestrator, taskState.config]);

  const pause = useCallback(() => {
    orchestrator.pause();
  }, [orchestrator]);

  const resume = useCallback(async () => {
    setRecoveryNotice(null);
    await orchestrator.resume();
  }, [orchestrator]);

  const skipCurrent = useCallback(async () => {
    setRecoveryNotice(null);
    await orchestrator.skipAndContinue();
  }, [orchestrator]);

  const retryCurrent = useCallback(async () => {
    setRecoveryNotice(null);
    await orchestrator.retryCurrentAndContinue();
  }, [orchestrator]);

  const reanalyzePage = useCallback(async (pageIndex: number) => {
    return orchestrator.reanalyzePageAndPause(pageIndex);
  }, [orchestrator]);

  const regenerateChunk = useCallback(async (chunkIndex: number) => {
    return orchestrator.regenerateChunkAndPause(chunkIndex);
  }, [orchestrator]);

  const regenerateStory = useCallback(async () => {
    return orchestrator.regenerateStoryAndPause();
  }, [orchestrator]);

  const regenerateSection = useCallback(async (sectionIndex: number) => {
    return orchestrator.regenerateSectionAndPause(sectionIndex);
  }, [orchestrator]);

  const regenerateWritingPreparation = useCallback(async () => {
    return orchestrator.regenerateWritingPreparationAndPause();
  }, [orchestrator]);

  const regenerateFinalPolish = useCallback(async () => {
    return orchestrator.regenerateFinalPolishAndPause();
  }, [orchestrator]);

  const updatePageAnalysis = useCallback((pageIndex: number, value: unknown) => {
    orchestrator.updatePageAnalysis(pageIndex, value);
    setTaskState(orchestrator.getState());
  }, [orchestrator]);

  const updateChunkSynthesis = useCallback((chunkIndex: number, value: unknown) => {
    orchestrator.updateChunkSynthesis(chunkIndex, value);
    setTaskState(orchestrator.getState());
  }, [orchestrator]);

  const updateStorySynthesis = useCallback((value: unknown) => {
    orchestrator.updateStorySynthesis(value);
    setTaskState(orchestrator.getState());
  }, [orchestrator]);

  const updateWritingPreparation = useCallback((value: unknown) => {
    orchestrator.updateWritingPreparation(value);
    setTaskState(orchestrator.getState());
  }, [orchestrator]);

  const updateNovelSection = useCallback((sectionIndex: number, value: unknown) => {
    orchestrator.updateNovelSection(sectionIndex, value);
    setTaskState(orchestrator.getState());
  }, [orchestrator]);

  const updateFinalPolish = useCallback((value: unknown) => {
    orchestrator.updateFinalPolish(value);
    setTaskState(orchestrator.getState());
  }, [orchestrator]);

  const updateSceneOutline = useCallback((sceneOutline: ScenePlan[]) => {
    orchestrator.updateSceneOutline(sceneOutline);
    const currentState = orchestrator.getState();
    setTaskState(currentState);
  }, [orchestrator]);

  const confirmSceneOutline = useCallback(() => {
    orchestrator.confirmSceneOutline();
    const currentState = orchestrator.getState();
    setTaskState(currentState);
  }, [orchestrator]);

  const confirmSceneOutlineAndResume = useCallback(async () => {
    setRecoveryNotice(null);
    orchestrator.confirmSceneOutline();
    setTaskState(orchestrator.getState());
    await orchestrator.resume();
  }, [orchestrator]);

  const reset = useCallback(() => {
    setRecoveryNotice(null);
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
    apiProfiles: apiProfiles.map(createProfileSummary),
    activeApiProfileId,
    creativePresets,
    images,
    taskState,
    configLoaded,
    recoveryNotice,
    saveApiConfig,
    selectApiProfile,
    duplicateApiProfile,
    deleteApiProfile,
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
    reanalyzePage,
    regenerateChunk,
    regenerateStory,
    regenerateSection,
    regenerateWritingPreparation,
    regenerateFinalPolish,
    updatePageAnalysis,
    updateChunkSynthesis,
    updateStorySynthesis,
    updateWritingPreparation,
    updateNovelSection,
    updateFinalPolish,
    updateSceneOutline,
    confirmSceneOutline,
    confirmSceneOutlineAndResume,
    dismissRecoveryNotice,
    reset,
    exportNovel,
  };
}
