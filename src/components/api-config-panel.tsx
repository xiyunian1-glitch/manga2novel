'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  CopyPlus,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  Save,
  Shield,
  Trash2,
  Waypoints,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  APIConfig,
  APIProfileSummary,
  APIProvider,
  ModelOption,
  RequestStage,
  StageAPIOverrideConfig,
  StageAPIOverrideMap,
} from '@/lib/types';
import {
  COMPATIBLE_MODELS,
  DEFAULT_STAGE_API_OVERRIDES,
  DEFAULT_STAGE_MODELS,
  GEMINI_ROOT_BASE_URL,
  GEMINI_MODELS,
  PROVIDER_DISPLAY_NAMES,
  REQUEST_STAGE_LABELS,
  REQUEST_STAGES,
  resolveProviderDisplayLabel,
} from '@/lib/types';
import { cn } from '@/lib/utils';

const DEFAULT_PROFILE_NAME = '默认配置';

type ServicePresetId =
  | 'openai'
  | 'openrouter'
  | 'siliconflow'
  | 'deepseek'
  | 'gemini'
  | 'compatible-custom';

interface ServicePreset {
  id: ServicePresetId;
  label: string;
  provider: APIProvider;
  providerLabel: string;
  baseUrl: string;
  description: string;
}

const SERVICE_PRESETS: ServicePreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    provider: 'compatible',
    providerLabel: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    description: '官方兼容接口，填好 Key 和模型即可。',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    provider: 'compatible',
    providerLabel: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    description: '聚合路由常见做法，适合频繁切模型。',
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    provider: 'compatible',
    providerLabel: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    description: '国内常见兼容接口，适合直接走 OpenAI 协议。',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    provider: 'compatible',
    providerLabel: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    description: 'DeepSeek 官方兼容地址，模型手动填即可。',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    provider: 'gemini',
    providerLabel: 'Google Gemini',
    baseUrl: GEMINI_ROOT_BASE_URL,
    description: 'Gemini 原生接口，和兼容接口分开处理。',
  },
  {
    id: 'compatible-custom',
    label: '自定义兼容接口',
    provider: 'compatible',
    providerLabel: '自定义兼容接口',
    baseUrl: '',
    description: '你自己的网关、代理、OneAPI 或任意兼容 /chat/completions。',
  },
];

type QuickRouteId = 'analysis' | 'writing';

interface QuickRouteGroup {
  id: QuickRouteId;
  label: string;
  description: string;
  stages: RequestStage[];
}

const QUICK_ROUTE_GROUPS: QuickRouteGroup[] = [
  {
    id: 'analysis',
    label: '分析流程',
    description: '逐页分析、分块综合、整书综合统一走第二套接口。',
    stages: ['analyze-pages', 'synthesize-chunks', 'synthesize-story'],
  },
  {
    id: 'writing',
    label: '写作流程',
    description: '章节写作和全书润色统一走第二套接口。',
    stages: ['write-sections', 'polish-novel'],
  },
];

interface QuickRouteState {
  representative: StageAPIOverrideConfig;
  anyEnabled: boolean;
  mixed: boolean;
}

interface APIConfigPanelProps {
  config: APIConfig;
  profiles: APIProfileSummary[];
  activeProfileId: string;
  onSave: (config: APIConfig, options?: { profileName?: string }) => Promise<void>;
  onSelectProfile: (profileId: string) => Promise<void>;
  onDuplicateProfile: (config: APIConfig, profileName?: string) => Promise<void>;
  onDeleteProfile: (profileId: string) => Promise<void>;
  onFetchModels: (config: Pick<APIConfig, 'provider' | 'providerLabel' | 'apiKey' | 'baseUrl'>) => Promise<ModelOption[]>;
  disabled?: boolean;
}

function getVendorLabel(model: ModelOption): string {
  const idVendor = model.id.includes('/') ? model.id.split('/')[0] : '';
  if (idVendor.trim()) {
    return idVendor.charAt(0).toUpperCase() + idVendor.slice(1);
  }

  return model.name.split(':')[0]?.trim() || 'Other';
}

function getDefaultModelsForProvider(provider: APIProvider): ModelOption[] {
  return provider === 'gemini' ? GEMINI_MODELS : COMPATIBLE_MODELS;
}

function getBaseUrlPlaceholder(provider: APIProvider): string {
  return provider === 'gemini'
    ? GEMINI_ROOT_BASE_URL
    : 'https://api.openai.com/v1';
}

function getModelPlaceholder(provider: APIProvider): string {
  return provider === 'gemini'
    ? '例如：gemini-2.5-pro'
    : '例如：gpt-4.1 / claude-sonnet-4';
}

function getApiKeyPlaceholder(provider: APIProvider): string {
  return provider === 'gemini' ? 'AIza...' : 'sk-...';
}

function normalizeUrl(value?: string): string {
  return (value || '').trim().replace(/\/+$/, '');
}

function createShowQuickRouteKeysState(): Record<QuickRouteId, boolean> {
  return {
    analysis: false,
    writing: false,
  };
}

function createQuickRoutePickerState(): Record<QuickRouteId, boolean> {
  return {
    analysis: false,
    writing: false,
  };
}

function createQuickRouteFetchingState(): Record<QuickRouteId, boolean> {
  return {
    analysis: false,
    writing: false,
  };
}

function cloneStageAPIOverrides(overrides: StageAPIOverrideMap): StageAPIOverrideMap {
  return REQUEST_STAGES.reduce((result, stage) => {
    result[stage] = { ...overrides[stage] };
    return result;
  }, { ...DEFAULT_STAGE_API_OVERRIDES });
}

function hasStageModelChanges(
  left: APIConfig['stageModels'],
  right: APIConfig['stageModels']
): boolean {
  return REQUEST_STAGES.some((stage) => (left[stage] || '').trim() !== (right[stage] || '').trim());
}

function hasStageOverrideChanges(
  left: StageAPIOverrideMap,
  right: StageAPIOverrideMap
): boolean {
  return REQUEST_STAGES.some((stage) => {
    const leftItem = left[stage];
    const rightItem = right[stage];

    return leftItem.enabled !== rightItem.enabled
      || leftItem.provider !== rightItem.provider
      || (leftItem.providerLabel?.trim() || '') !== (rightItem.providerLabel?.trim() || '')
      || leftItem.apiKey.trim() !== rightItem.apiKey.trim()
      || leftItem.model.trim() !== rightItem.model.trim()
      || (leftItem.baseUrl?.trim() || '') !== (rightItem.baseUrl?.trim() || '');
  });
}

function formatProfileUpdatedAt(value?: string): string {
  if (!value) {
    return '刚刚';
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return '刚刚';
  }

  return timestamp.toLocaleString('zh-CN', { hour12: false });
}

function getServicePreset(presetId: ServicePresetId): ServicePreset {
  return SERVICE_PRESETS.find((preset) => preset.id === presetId) || SERVICE_PRESETS[SERVICE_PRESETS.length - 1];
}

function resolveServicePresetId(
  provider: APIProvider,
  baseUrl?: string,
  providerLabel?: string
): ServicePresetId {
  if (provider === 'gemini') {
    return 'gemini';
  }

  const normalizedBaseUrl = normalizeUrl(baseUrl);
  const normalizedLabel = (providerLabel || '').trim().toLowerCase();

  for (const preset of SERVICE_PRESETS) {
    if (preset.provider !== provider || preset.id === 'compatible-custom' || preset.id === 'gemini') {
      continue;
    }

    if (normalizedBaseUrl && normalizeUrl(preset.baseUrl) === normalizedBaseUrl) {
      return preset.id;
    }

    if (normalizedLabel && preset.providerLabel.toLowerCase() === normalizedLabel) {
      return preset.id;
    }
  }

  return 'compatible-custom';
}

function areOverridesEquivalent(left: StageAPIOverrideConfig, right: StageAPIOverrideConfig): boolean {
  if (left.enabled !== right.enabled) {
    return false;
  }

  if (!left.enabled && !right.enabled) {
    return true;
  }

  return left.provider === right.provider
    && (left.providerLabel?.trim() || '') === (right.providerLabel?.trim() || '')
    && left.apiKey.trim() === right.apiKey.trim()
    && left.model.trim() === right.model.trim()
    && (left.baseUrl?.trim() || '') === (right.baseUrl?.trim() || '');
}

function getQuickRouteState(stages: RequestStage[], overrides: StageAPIOverrideMap): QuickRouteState {
  const representative = stages
    .map((stage) => overrides[stage])
    .find((item) => item.enabled) || overrides[stages[0]];
  const anyEnabled = stages.some((stage) => overrides[stage].enabled);
  const mixed = stages.some((stage) => !areOverridesEquivalent(overrides[stage], representative));

  return {
    representative,
    anyEnabled,
    mixed,
  };
}

function groupModelsByVendor(models: ModelOption[]): Array<[string, ModelOption[]]> {
  const groups = new Map<string, ModelOption[]>();
  models.forEach((item) => {
    const vendor = getVendorLabel(item);
    const current = groups.get(vendor) || [];
    current.push(item);
    groups.set(vendor, current);
  });
  return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right, 'zh-CN'));
}

function findSelectedModel(
  currentModel: string,
  groupedModels: Array<[string, ModelOption[]]>,
  models: ModelOption[]
): ModelOption | undefined {
  const normalizedModel = currentModel.trim();
  if (!normalizedModel) {
    return undefined;
  }

  for (const [, vendorModels] of groupedModels) {
    const found = vendorModels.find((item) => item.id === normalizedModel);
    if (found) {
      return found;
    }
  }

  return models.find((item) => item.id === normalizedModel);
}

function createQuickRouteModelOptionsState(overrides: StageAPIOverrideMap): Record<QuickRouteId, ModelOption[]> {
  return {
    analysis: getDefaultModelsForProvider(getQuickRouteState(QUICK_ROUTE_GROUPS[0].stages, overrides).representative.provider),
    writing: getDefaultModelsForProvider(getQuickRouteState(QUICK_ROUTE_GROUPS[1].stages, overrides).representative.provider),
  };
}

export function APIConfigPanel({
  config,
  profiles,
  activeProfileId,
  onSave,
  onSelectProfile,
  onDuplicateProfile,
  onDeleteProfile,
  onFetchModels,
  disabled,
}: APIConfigPanelProps) {
  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) || profiles[0],
    [activeProfileId, profiles]
  );
  const normalizedProviderLabel = (config.providerLabel || PROVIDER_DISPLAY_NAMES[config.provider]).trim();
  const [editorOpen, setEditorOpen] = useState(false);
  const [profileName, setProfileName] = useState(activeProfile?.name || DEFAULT_PROFILE_NAME);
  const [provider, setProvider] = useState<APIProvider>(config.provider);
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [providerLabel, setProviderLabel] = useState(config.providerLabel || PROVIDER_DISPLAY_NAMES[config.provider]);
  const [model, setModel] = useState(config.model || '');
  const [baseUrl, setBaseUrl] = useState(config.baseUrl || '');
  const [stageModels, setStageModels] = useState<APIConfig['stageModels']>({ ...DEFAULT_STAGE_MODELS, ...config.stageModels });
  const [stageAPIOverrides, setStageAPIOverrides] = useState<StageAPIOverrideMap>(
    cloneStageAPIOverrides(config.stageAPIOverrides)
  );
  const [models, setModels] = useState<ModelOption[]>(getDefaultModelsForProvider(config.provider));
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [showQuickRouteKeys, setShowQuickRouteKeys] = useState<Record<QuickRouteId, boolean>>(createShowQuickRouteKeysState);
  const [quickRouteModels, setQuickRouteModels] = useState<Record<QuickRouteId, ModelOption[]>>(
    createQuickRouteModelOptionsState(config.stageAPIOverrides)
  );
  const [quickRouteModelPickerOpen, setQuickRouteModelPickerOpen] = useState<Record<QuickRouteId, boolean>>(
    createQuickRoutePickerState
  );
  const [fetchingModels, setFetchingModels] = useState(false);
  const [quickRouteFetchingModels, setQuickRouteFetchingModels] = useState<Record<QuickRouteId, boolean>>(
    createQuickRouteFetchingState
  );
  const [showRoutingOptions, setShowRoutingOptions] = useState(false);
  const [profileAction, setProfileAction] = useState<'save' | 'switch' | 'duplicate' | 'delete' | null>(null);

  const profileBusy = Boolean(profileAction);
  const canFetchModels = !disabled && !fetchingModels && !profileBusy && Boolean(apiKey.trim());
  const hasConfigChanges = (
    provider !== config.provider
    || apiKey.trim() !== config.apiKey
    || providerLabel.trim() !== normalizedProviderLabel
    || model.trim() !== config.model
    || baseUrl.trim() !== (config.baseUrl || '')
    || hasStageModelChanges(stageModels, config.stageModels)
    || hasStageOverrideChanges(stageAPIOverrides, config.stageAPIOverrides)
  );
  const hasProfileNameChange = profileName.trim() !== (activeProfile?.name || DEFAULT_PROFILE_NAME);
  const hasDraftChanges = hasConfigChanges || hasProfileNameChange;

  const resetDraft = useCallback(() => {
    setProfileName(activeProfile?.name || DEFAULT_PROFILE_NAME);
    setProvider(config.provider);
    setApiKey(config.apiKey);
    setProviderLabel(config.providerLabel || PROVIDER_DISPLAY_NAMES[config.provider]);
    setModel(config.model || '');
    setBaseUrl(config.baseUrl || '');
    setStageModels({ ...DEFAULT_STAGE_MODELS, ...config.stageModels });
    setStageAPIOverrides(cloneStageAPIOverrides(config.stageAPIOverrides));
    setModels(getDefaultModelsForProvider(config.provider));
    setModelPickerOpen(false);
    setShowKey(false);
    setShowQuickRouteKeys(createShowQuickRouteKeysState());
    setQuickRouteModels(createQuickRouteModelOptionsState(config.stageAPIOverrides));
    setQuickRouteModelPickerOpen(createQuickRoutePickerState());
    setQuickRouteFetchingModels(createQuickRouteFetchingState());
    setShowRoutingOptions(false);
  }, [activeProfile?.name, config]);

  useEffect(() => {
    resetDraft();
  }, [activeProfile?.id, resetDraft]);

  const currentConfig = useMemo<APIConfig>(() => ({
    provider,
    providerLabel: providerLabel.trim() || PROVIDER_DISPLAY_NAMES[provider],
    apiKey: apiKey.trim(),
    model: model.trim(),
    baseUrl: baseUrl.trim(),
    stageModels: REQUEST_STAGES.reduce((result, stage) => {
      result[stage] = stageModels[stage]?.trim() || '';
      return result;
    }, { ...DEFAULT_STAGE_MODELS }),
    stageAPIOverrides: REQUEST_STAGES.reduce((result, stage) => {
      const override = stageAPIOverrides[stage];
      result[stage] = {
        enabled: override.enabled,
        provider: override.provider,
        providerLabel: resolveProviderDisplayLabel(override.provider, override.providerLabel),
        apiKey: override.apiKey.trim(),
        model: override.model.trim(),
        baseUrl: override.baseUrl?.trim() || '',
      };
      return result;
    }, { ...DEFAULT_STAGE_API_OVERRIDES }),
  }), [apiKey, baseUrl, model, provider, providerLabel, stageAPIOverrides, stageModels]);

  const groupedModels = useMemo(() => groupModelsByVendor(models), [models]);

  const selectedModel = useMemo(
    () => findSelectedModel(model, groupedModels, models),
    [groupedModels, model, models]
  );

  const selectedServicePresetId = useMemo(
    () => resolveServicePresetId(provider, baseUrl, providerLabel),
    [baseUrl, provider, providerLabel]
  );

  const quickRouteStates = useMemo<Record<QuickRouteId, QuickRouteState>>(() => ({
    analysis: getQuickRouteState(QUICK_ROUTE_GROUPS[0].stages, stageAPIOverrides),
    writing: getQuickRouteState(QUICK_ROUTE_GROUPS[1].stages, stageAPIOverrides),
  }), [stageAPIOverrides]);
  const quickRouteGroupedModels = useMemo<Record<QuickRouteId, Array<[string, ModelOption[]]>>>(() => ({
    analysis: groupModelsByVendor(quickRouteModels.analysis),
    writing: groupModelsByVendor(quickRouteModels.writing),
  }), [quickRouteModels]);

  const summaryItems = useMemo(() => {
    const analysisLabel = quickRouteStates.analysis.anyEnabled
      ? resolveProviderDisplayLabel(
        quickRouteStates.analysis.representative.provider,
        quickRouteStates.analysis.representative.providerLabel
      )
      : '跟随默认';
    const writingLabel = quickRouteStates.writing.anyEnabled
      ? resolveProviderDisplayLabel(
        quickRouteStates.writing.representative.provider,
        quickRouteStates.writing.representative.providerLabel
      )
      : '跟随默认';

    return [
      {
        label: '默认接口',
        value: providerLabel.trim() || PROVIDER_DISPLAY_NAMES[provider],
        detail: model.trim() || '模型未设置',
      },
      {
        label: '分析分流',
        value: analysisLabel,
        detail: quickRouteStates.analysis.mixed ? '组内已细分' : '逐页分析 / 分块综合 / 整书综合',
      },
      {
        label: '写作分流',
        value: writingLabel,
        detail: quickRouteStates.writing.mixed ? '组内已细分' : '章节写作 / 全书润色',
      },
      {
        label: '最近更新',
        value: formatProfileUpdatedAt(activeProfile?.updatedAt),
        detail: baseUrl.trim() || '使用预设地址',
      },
    ];
  }, [activeProfile?.updatedAt, baseUrl, model, provider, providerLabel, quickRouteStates]);

  const applyDefaultServicePreset = (presetId: ServicePresetId) => {
    const preset = getServicePreset(presetId);
    const nextBaseUrl = preset.id === 'compatible-custom'
      ? (selectedServicePresetId === 'compatible-custom' ? baseUrl : '')
      : preset.baseUrl;

    setProvider(preset.provider);
    setProviderLabel(preset.providerLabel);
    setBaseUrl(nextBaseUrl);
    setModels(getDefaultModelsForProvider(preset.provider));
    setModelPickerOpen(false);
  };

  const getQuickRouteStages = (routeId: QuickRouteId) => {
    return QUICK_ROUTE_GROUPS.find((group) => group.id === routeId)?.stages || [];
  };

  const handleQuickRouteChange = (routeId: QuickRouteId, patch: Partial<StageAPIOverrideConfig>) => {
    const stages = getQuickRouteStages(routeId);
    setStageAPIOverrides((prev) => {
      const next = { ...prev };
      stages.forEach((stage) => {
        next[stage] = {
          ...next[stage],
          ...patch,
        };
      });
      return next;
    });
  };

  const handleQuickRoutePresetChange = (routeId: QuickRouteId, presetId: ServicePresetId) => {
    const preset = getServicePreset(presetId);
    const stages = getQuickRouteStages(routeId);

    setStageAPIOverrides((prev) => {
      const next = { ...prev };
      stages.forEach((stage) => {
        const current = next[stage];
        const currentPresetId = resolveServicePresetId(current.provider, current.baseUrl, current.providerLabel);
        next[stage] = {
          ...current,
          provider: preset.provider,
          providerLabel: preset.providerLabel,
          baseUrl: preset.id === 'compatible-custom'
            ? (currentPresetId === 'compatible-custom' ? current.baseUrl || '' : '')
            : preset.baseUrl,
        };
      });
      return next;
    });
    setQuickRouteModels((prev) => ({
      ...prev,
      [routeId]: getDefaultModelsForProvider(preset.provider),
    }));
    setQuickRouteModelPickerOpen((prev) => ({ ...prev, [routeId]: false }));
  };

  const handleToggleQuickRoute = (routeId: QuickRouteId, enabled: boolean) => {
    const stages = getQuickRouteStages(routeId);
    const routeState = quickRouteStates[routeId];

    setStageAPIOverrides((prev) => {
      const next = { ...prev };
      stages.forEach((stage) => {
        const current = next[stage];
        next[stage] = {
          ...current,
          enabled,
          provider: enabled ? (routeState.representative.provider || provider) : current.provider,
          providerLabel: enabled
            ? (routeState.representative.providerLabel?.trim() || providerLabel.trim() || PROVIDER_DISPLAY_NAMES[provider])
            : current.providerLabel,
          apiKey: enabled ? (current.apiKey || routeState.representative.apiKey || apiKey) : current.apiKey,
          model: enabled ? (current.model || routeState.representative.model || stageModels[stage] || model) : current.model,
          baseUrl: enabled ? (current.baseUrl || routeState.representative.baseUrl || baseUrl) : current.baseUrl,
        };
      });
      return next;
    });
  };

  const copyDefaultToQuickRoute = (routeId: QuickRouteId) => {
    const stages = getQuickRouteStages(routeId);
    setStageAPIOverrides((prev) => {
      const next = { ...prev };
      stages.forEach((stage) => {
        next[stage] = {
          ...next[stage],
          enabled: true,
          provider,
          providerLabel: providerLabel.trim() || PROVIDER_DISPLAY_NAMES[provider],
          apiKey,
          model: stageModels[stage] || model,
          baseUrl,
        };
      });
      return next;
    });
    const routeLabel = QUICK_ROUTE_GROUPS.find((group) => group.id === routeId)?.label || '该分流';
    toast.success(`${routeLabel} 已复制默认接口，你可以继续改成第二套 API。`);
  };

  const handleFetchModels = async () => {
    if (!apiKey.trim()) {
      toast.error('请先填写默认 API Key，再获取模型列表。');
      return;
    }

    try {
      setFetchingModels(true);
      const nextModels = await onFetchModels({
        provider,
        providerLabel: providerLabel.trim() || PROVIDER_DISPLAY_NAMES[provider],
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim(),
      });

      if (nextModels.length === 0) {
        toast.warning('没有拿到模型列表，已保留当前预置模型。');
        return;
      }

      setModels(nextModels);
      toast.success(`已获取 ${nextModels.length} 个可用模型。`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '获取模型失败');
    } finally {
      setFetchingModels(false);
    }
  };

  const handleFetchQuickRouteModels = async (routeId: QuickRouteId) => {
    const routeState = quickRouteStates[routeId];
    const routeLabel = QUICK_ROUTE_GROUPS.find((group) => group.id === routeId)?.label || '该流程';
    const resolvedApiKey = routeState.representative.apiKey.trim() || apiKey.trim();

    if (!resolvedApiKey) {
      toast.error(`请先填写${routeLabel}的 API Key，再获取模型列表。`);
      return;
    }

    try {
      setQuickRouteFetchingModels((prev) => ({ ...prev, [routeId]: true }));
      const nextModels = await onFetchModels({
        provider: routeState.representative.provider,
        providerLabel: routeState.representative.providerLabel?.trim()
          || PROVIDER_DISPLAY_NAMES[routeState.representative.provider],
        apiKey: resolvedApiKey,
        baseUrl: routeState.representative.baseUrl?.trim() || '',
      });

      if (nextModels.length === 0) {
        toast.warning(`${routeLabel} 没有拿到模型列表，已保留当前预置模型。`);
        return;
      }

      setQuickRouteModels((prev) => ({ ...prev, [routeId]: nextModels }));
      toast.success(`${routeLabel} 已获取 ${nextModels.length} 个可用模型。`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `${routeLabel} 获取模型失败`);
    } finally {
      setQuickRouteFetchingModels((prev) => ({ ...prev, [routeId]: false }));
    }
  };

  const handleEditorOpenChange = (open: boolean) => {
    if (!open) {
      resetDraft();
    }

    setEditorOpen(open);
  };

  const handleSave = async () => {
    try {
      setProfileAction('save');
      await onSave(currentConfig, {
        profileName: profileName.trim() || activeProfile?.name || DEFAULT_PROFILE_NAME,
      });
      setEditorOpen(false);
      toast.success('API 配置档已保存。');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存 API 配置失败');
    } finally {
      setProfileAction(null);
    }
  };

  const handleSwitchProfile = async (nextProfileId: string | null) => {
    if (!nextProfileId || nextProfileId === activeProfileId) {
      return;
    }

    if (hasDraftChanges) {
      toast.error('当前配置还没保存，先保存再切换配置档。');
      return;
    }

    try {
      setProfileAction('switch');
      await onSelectProfile(nextProfileId);
      toast.success('已切换 API 配置档。');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '切换配置档失败');
    } finally {
      setProfileAction(null);
    }
  };

  const handleDuplicateProfile = async () => {
    try {
      setProfileAction('duplicate');
      const nextProfileName = `${profileName.trim() || activeProfile?.name || DEFAULT_PROFILE_NAME} 副本`;
      await onDuplicateProfile(currentConfig, nextProfileName);
      setEditorOpen(true);
      toast.success('已复制出新的 API 配置档。');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '复制配置档失败');
    } finally {
      setProfileAction(null);
    }
  };

  const handleDeleteProfile = async () => {
    if (!activeProfileId) {
      toast.error('当前没有可删除的配置档。');
      return;
    }

    if (profiles.length <= 1) {
      toast.error('至少保留一个 API 配置档。');
      return;
    }

    if (hasDraftChanges) {
      toast.error('当前配置还没保存，先保存再删除配置档。');
      return;
    }

    try {
      setProfileAction('delete');
      await onDeleteProfile(activeProfileId);
      setEditorOpen(false);
      toast.success('当前 API 配置档已删除。');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除配置档失败');
    } finally {
      setProfileAction(null);
    }
  };

  return (
    <Card className="relative z-10" data-panel="api-config-panel">
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <KeyRound className="h-4 w-4" />
              API 配置
            </CardTitle>
            <CardDescription>
              先配一套默认接口就能直接用；只有你想把分析和写作拆开，才需要继续往下配第二套 API。
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-xs">
              <Shield className="mr-1 h-3 w-3" />
              AES-GCM 加密存储
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleEditorOpenChange(true)}
              data-action="open-api-config-editor"
            >
              编辑配置
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="rounded-xl border bg-muted/10 p-3.5">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] xl:items-start">
            <div className="space-y-2">
              <Label>命名配置档</Label>
              <Select value={activeProfileId || activeProfile?.id || ''} onValueChange={handleSwitchProfile} disabled={disabled || profileBusy}>
                <SelectTrigger className="w-full bg-background/80">
                  <SelectValue placeholder="选择配置档">
                    {activeProfile?.name || '选择配置档'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent sideOffset={10}>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs leading-5 text-muted-foreground">
                不同供应商、不同模型组合都能单独存成一档，切换时不会互相覆盖。
              </p>
            </div>

            <div className="flex min-w-0 flex-wrap gap-2">
              {summaryItems.map((item) => (
                <div
                  key={item.label}
                  className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border bg-background/80 px-3 py-1.5 text-xs"
                >
                  <span className="shrink-0 font-medium text-foreground">{item.label}</span>
                  <span className="min-w-0 truncate text-muted-foreground" title={item.value}>
                    {item.value}
                  </span>
                  <span className="hidden min-w-0 truncate text-muted-foreground/80 xl:inline" title={item.detail}>
                    {item.detail}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="outline" className={cn(!apiKey.trim() && 'border-amber-300 text-amber-700')}>
              {apiKey.trim() ? '默认 Key 已配置' : '默认 Key 未配置'}
            </Badge>
            <Badge variant="outline">
              {model.trim() ? `默认模型：${model.trim()}` : '默认模型未设置'}
            </Badge>
            <Badge variant="outline">
              分析分流 {quickRouteStates.analysis.anyEnabled ? '已启用' : '未启用'}
            </Badge>
            <Badge variant="outline">
              写作分流 {quickRouteStates.writing.anyEnabled ? '已启用' : '未启用'}
            </Badge>
          </div>
        </div>

        <Dialog open={editorOpen} onOpenChange={handleEditorOpenChange}>
          <DialogContent className="w-[min(96vw,72rem)] sm:max-w-5xl" data-dialog="api-config-editor">
            <DialogHeader>
              <DialogTitle>API 配置</DialogTitle>
              <DialogDescription>
                参考常见 AI 客户端的做法，把必填项放前面：先选服务商预设，再填 Key 和模型，分流和精细配置往下折叠。
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[80vh] overflow-y-auto pr-1">
              <div className="space-y-4">
                <div className="grid gap-4 rounded-xl border bg-muted/10 p-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
                  <div className="space-y-2">
                    <Label>配置档名称</Label>
                    <Input
                      value={profileName}
                      onChange={(event) => setProfileName(event.target.value)}
                      placeholder={DEFAULT_PROFILE_NAME}
                      disabled={disabled || profileBusy}
                      data-field="api-profile-name"
                    />
                    <p className="text-xs leading-5 text-muted-foreground">
                      比如：OpenRouter 写作 / Gemini 分析。以后切换会很顺手。
                    </p>
                  </div>

                  <div className="rounded-xl border border-dashed bg-background/80 px-4 py-3 text-xs leading-6 text-muted-foreground">
                    默认接口会被所有阶段沿用。只有你明确想让分析和写作走不同平台时，才需要打开下面的分流配置。
                  </div>
                </div>

                <div className="space-y-4 rounded-2xl border bg-muted/10 p-4">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">1. 先选服务商预设</div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      像 OpenAI、OpenRouter 这种会自动带出接口类型和默认 URL，你只需要补 Key、模型，保存就能开始。
                    </p>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {SERVICE_PRESETS.map((preset) => {
                      const isActive = selectedServicePresetId === preset.id;

                      return (
                        <button
                          key={preset.id}
                          type="button"
                          className={cn(
                            'rounded-xl border px-4 py-3 text-left transition-colors',
                            isActive
                              ? 'border-primary bg-primary/5 shadow-sm'
                              : 'border-border bg-background hover:border-primary/40 hover:bg-muted/20'
                          )}
                          onClick={() => applyDefaultServicePreset(preset.id)}
                          disabled={disabled || profileBusy}
                          data-action="apply-default-service-preset"
                          data-preset-id={preset.id}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-medium">{preset.label}</div>
                            <Check className={cn('h-4 w-4', isActive ? 'opacity-100 text-primary' : 'opacity-0')} />
                          </div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            {preset.description}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2">
                      <Label>API Key</Label>
                      <div className="relative">
                        <Input
                          type={showKey ? 'text' : 'password'}
                          value={apiKey}
                          onChange={(event) => setApiKey(event.target.value)}
                          placeholder={getApiKeyPlaceholder(provider)}
                          disabled={disabled || profileBusy}
                          data-field="default-api-key"
                        />
                        <button
                          type="button"
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          onClick={() => setShowKey((prev) => !prev)}
                          data-action="toggle-default-api-key-visibility"
                        >
                          {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label>模型</Label>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2"
                            onClick={handleFetchModels}
                            disabled={!canFetchModels}
                            data-action="fetch-default-models"
                          >
                            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${fetchingModels ? 'animate-spin' : ''}`} />
                            获取模型
                          </Button>
                          <Popover open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
                            <PopoverTrigger
                              render={(
                                <Button
                                  type="button"
                                  variant="outline"
                                  role="combobox"
                                  aria-expanded={modelPickerOpen}
                                  className="h-7 px-2 font-normal"
                                  disabled={disabled || profileBusy}
                                  data-action="open-default-model-picker"
                                >
                                  <span className="truncate text-left">
                                    {selectedModel?.name || '从列表选择'}
                                  </span>
                                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                              )}
                            />
                            <PopoverContent className="z-[9999] w-[min(32rem,calc(100vw-2rem))] p-0" sideOffset={12} align="end">
                              <Command shouldFilter>
                                <CommandInput placeholder="搜索模型或厂商" />
                                <CommandList className="max-h-96">
                                  <CommandEmpty>没有匹配的模型</CommandEmpty>
                                  {groupedModels.map(([vendor, vendorModels], groupIndex) => (
                                    <div key={vendor}>
                                      {groupIndex > 0 ? <CommandSeparator /> : null}
                                      <CommandGroup heading={vendor}>
                                        {vendorModels.map((item) => (
                                          <CommandItem
                                            key={item.id}
                                            value={`${vendor} ${item.name} ${item.id}`}
                                            onSelect={() => {
                                              setModel(item.id);
                                              setModelPickerOpen(false);
                                            }}
                                            className="gap-3"
                                          >
                                            <Check className={cn('h-4 w-4', model.trim() === item.id ? 'opacity-100' : 'opacity-0')} />
                                            <div className="min-w-0 flex-1">
                                              <div className="truncate" title={item.name}>{item.name}</div>
                                              <div className="truncate text-xs text-muted-foreground" title={item.id}>{item.id}</div>
                                            </div>
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    </div>
                                  ))}
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        </div>
                      </div>

                      <Input
                        value={model}
                        onChange={(event) => setModel(event.target.value)}
                        placeholder={getModelPlaceholder(provider)}
                        disabled={disabled || profileBusy}
                        data-field="default-model"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>API URL / 代理地址</Label>
                    <Input
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.target.value)}
                      placeholder={getBaseUrlPlaceholder(provider)}
                      disabled={disabled || profileBusy}
                      data-field="default-base-url"
                    />
                    <p className="text-xs text-muted-foreground">
                      {selectedServicePresetId === 'compatible-custom'
                        ? '自定义兼容接口请填完整前缀，例如 https://your-gateway.example/v1。'
                        : '预设已经帮你带出默认地址；只有你要换成自己的网关、代理或中转时才需要改。'}
                    </p>
                  </div>
                </div>

                <div className="space-y-4 rounded-2xl border bg-muted/10 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Waypoints className="h-4 w-4 text-muted-foreground" />
                        2. 可选：把分析和写作拆成两路
                      </div>
                      <p className="text-xs leading-5 text-muted-foreground">
                        这是很多 AI 客户端常见的做法。大多数人只需要区分“分析流程”和“写作流程”，不用一开始就逐阶段细配。
                      </p>
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowRoutingOptions((prev) => !prev)}
                      disabled={disabled || profileBusy}
                      data-action="toggle-routing-options"
                      data-expanded={showRoutingOptions ? 'true' : 'false'}
                    >
                      {showRoutingOptions ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <ChevronDown className="mr-1 h-3.5 w-3.5" />}
                      {showRoutingOptions ? '收起' : '展开'}
                    </Button>
                  </div>

                  {!showRoutingOptions ? (
                    <div className="rounded-lg border border-dashed border-border bg-background/70 px-3 py-2 text-xs leading-5 text-muted-foreground">
                      分析分流 {quickRouteStates.analysis.anyEnabled ? '已启用' : '未启用'}，
                      写作分流 {quickRouteStates.writing.anyEnabled ? '已启用' : '未启用'}。
                      如果只是一套 API 直接全流程跑，这里可以一直不动。
                    </div>
                  ) : (
                    <div className="grid gap-4 xl:grid-cols-2">
                      {QUICK_ROUTE_GROUPS.map((group) => {
                        const routeState = quickRouteStates[group.id];
                        const routePresetId = resolveServicePresetId(
                          routeState.representative.provider,
                          routeState.representative.baseUrl,
                          routeState.representative.providerLabel
                        );
                        const routeModels = quickRouteModels[group.id];
                        const routeGroupedModels = quickRouteGroupedModels[group.id];
                        const routeSelectedModel = findSelectedModel(
                          routeState.representative.model,
                          routeGroupedModels,
                          routeModels
                        );
                        const routeCanFetchModels = !disabled
                          && !profileBusy
                          && !quickRouteFetchingModels[group.id]
                          && Boolean((routeState.representative.apiKey.trim() || apiKey.trim()));

                        return (
                          <div key={group.id} className="rounded-xl border bg-background/80 p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                                  {group.label}
                                  {routeState.mixed ? <Badge variant="secondary">已细分</Badge> : null}
                                </div>
                                <p className="text-xs leading-5 text-muted-foreground">
                                  {group.description}
                                </p>
                                <div className="flex flex-wrap gap-1">
                                  {group.stages.map((stage) => (
                                    <Badge key={stage} variant="outline" className="text-[10px]">
                                      {REQUEST_STAGE_LABELS[stage]}
                                    </Badge>
                                  ))}
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={routeState.anyEnabled}
                                  onCheckedChange={(checked) => handleToggleQuickRoute(group.id, checked)}
                                  disabled={disabled || profileBusy}
                                  id={`quick-route-${group.id}`}
                                />
                                <Label htmlFor={`quick-route-${group.id}`} className="cursor-pointer text-xs text-muted-foreground">
                                  {routeState.anyEnabled ? '独立接口' : '跟随默认'}
                                </Label>
                              </div>
                            </div>

                            {routeState.anyEnabled ? (
                              <div className="mt-4 space-y-4">
                                {routeState.mixed ? (
                                  <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground">
                                    这一路当前并不是完全统一的。你在这里改动后，会把这组阶段统一覆盖成同一套接口。
                                  </div>
                                ) : null}

                                <div className="grid gap-4 lg:grid-cols-2">
                                  <div className="space-y-2">
                                    <Label>服务商预设</Label>
                                    <Select
                                      value={routePresetId}
                                      onValueChange={(value) => handleQuickRoutePresetChange(group.id, value as ServicePresetId)}
                                      disabled={disabled || profileBusy}
                                    >
                                      <SelectTrigger className="w-full">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent sideOffset={10}>
                                        {SERVICE_PRESETS.map((preset) => (
                                          <SelectItem key={preset.id} value={preset.id}>
                                            {preset.label}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>

                                  <div className="space-y-2">
                                    <Label>模型</Label>
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <Label>模型</Label>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="h-7 px-2"
                                          onClick={() => handleFetchQuickRouteModels(group.id)}
                                          disabled={!routeCanFetchModels}
                                          data-action="fetch-quick-route-models"
                                          data-route-id={group.id}
                                        >
                                          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${quickRouteFetchingModels[group.id] ? 'animate-spin' : ''}`} />
                                          获取模型
                                        </Button>
                                        <Popover
                                          open={quickRouteModelPickerOpen[group.id]}
                                          onOpenChange={(open) => setQuickRouteModelPickerOpen((prev) => ({ ...prev, [group.id]: open }))}
                                        >
                                          <PopoverTrigger
                                            render={(
                                              <Button
                                                type="button"
                                                variant="outline"
                                                role="combobox"
                                                aria-expanded={quickRouteModelPickerOpen[group.id]}
                                                className="h-7 px-2 font-normal"
                                                disabled={disabled || profileBusy}
                                                data-action="open-quick-route-model-picker"
                                                data-route-id={group.id}
                                              >
                                                <span className="truncate text-left">
                                                  {routeSelectedModel?.name || '从列表选择'}
                                                </span>
                                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                              </Button>
                                            )}
                                          />
                                          <PopoverContent className="z-[9999] w-[min(32rem,calc(100vw-2rem))] p-0" sideOffset={12} align="end">
                                            <Command shouldFilter>
                                              <CommandInput placeholder="搜索模型或厂商" />
                                              <CommandList className="max-h-96">
                                                <CommandEmpty>没有匹配的模型</CommandEmpty>
                                                {routeGroupedModels.map(([vendor, vendorModels], groupIndex) => (
                                                  <div key={`${group.id}-${vendor}`}>
                                                    {groupIndex > 0 ? <CommandSeparator /> : null}
                                                    <CommandGroup heading={vendor}>
                                                      {vendorModels.map((item) => (
                                                        <CommandItem
                                                          key={`${group.id}-${item.id}`}
                                                          value={`${vendor} ${item.name} ${item.id}`}
                                                          onSelect={() => {
                                                            handleQuickRouteChange(group.id, { model: item.id });
                                                            setQuickRouteModelPickerOpen((prev) => ({ ...prev, [group.id]: false }));
                                                          }}
                                                          className="gap-3"
                                                        >
                                                          <Check className={cn('h-4 w-4', routeState.representative.model.trim() === item.id ? 'opacity-100' : 'opacity-0')} />
                                                          <div className="min-w-0 flex-1">
                                                            <div className="truncate" title={item.name}>{item.name}</div>
                                                            <div className="truncate text-xs text-muted-foreground" title={item.id}>{item.id}</div>
                                                          </div>
                                                        </CommandItem>
                                                      ))}
                                                    </CommandGroup>
                                                  </div>
                                                ))}
                                              </CommandList>
                                            </Command>
                                          </PopoverContent>
                                        </Popover>
                                      </div>
                                    </div>
                                    <Input
                                      value={routeState.representative.model}
                                      onChange={(event) => handleQuickRouteChange(group.id, { model: event.target.value })}
                                      placeholder={getModelPlaceholder(routeState.representative.provider)}
                                      disabled={disabled || profileBusy}
                                    />
                                  </div>
                                </div>

                                <div className="grid gap-4 lg:grid-cols-2">
                                  <div className="space-y-2">
                                    <Label>API URL / 代理地址</Label>
                                    <Input
                                      value={routeState.representative.baseUrl || ''}
                                      onChange={(event) => handleQuickRouteChange(group.id, { baseUrl: event.target.value })}
                                      placeholder={getBaseUrlPlaceholder(routeState.representative.provider)}
                                      disabled={disabled || profileBusy}
                                    />
                                  </div>

                                  <div className="space-y-2">
                                    <Label>API Key</Label>
                                    <div className="relative">
                                      <Input
                                        type={showQuickRouteKeys[group.id] ? 'text' : 'password'}
                                        value={routeState.representative.apiKey}
                                        onChange={(event) => handleQuickRouteChange(group.id, { apiKey: event.target.value })}
                                        placeholder={getApiKeyPlaceholder(routeState.representative.provider)}
                                        disabled={disabled || profileBusy}
                                        data-field={`quick-route-api-key-${group.id}`}
                                      />
                                      <button
                                        type="button"
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        onClick={() => setShowQuickRouteKeys((prev) => ({ ...prev, [group.id]: !prev[group.id] }))}
                                        data-action="toggle-quick-route-api-key-visibility"
                                        data-route-id={group.id}
                                      >
                                        {showQuickRouteKeys[group.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                      </button>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => copyDefaultToQuickRoute(group.id)}
                                    disabled={disabled || profileBusy}
                                    data-action="copy-default-to-quick-route"
                                    data-route-id={group.id}
                                  >
                                    复制默认接口
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="mt-4 rounded-lg border border-dashed border-border bg-background/70 px-3 py-2 text-xs leading-5 text-muted-foreground">
                                这一路现在直接跟随默认接口。只有你想把分析和写作拆开时，再打开它。
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleDuplicateProfile}
                      disabled={disabled || profileBusy}
                      data-action="duplicate-api-profile"
                    >
                      <CopyPlus className="mr-1 h-3.5 w-3.5" />
                      复制新档
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={handleDeleteProfile}
                      disabled={disabled || profileBusy || profiles.length <= 1}
                      data-action="delete-api-profile"
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      删除当前档
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => handleEditorOpenChange(false)}
                      data-action="cancel-api-config-editor"
                    >
                      取消
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSave}
                      disabled={disabled || profileBusy || !hasDraftChanges}
                      data-action="save-api-config"
                    >
                      <Save className="mr-1 h-3.5 w-3.5" />
                      {profileAction === 'save' ? '保存中...' : '保存配置'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
