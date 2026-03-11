'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { Check, ChevronsUpDown, Eye, EyeOff, KeyRound, RefreshCw, Shield } from 'lucide-react';
import { toast } from 'sonner';
import type { APIConfig, APIProvider, ModelOption } from '@/lib/types';
import { OPENROUTER_MODELS } from '@/lib/types';
import { cn } from '@/lib/utils';

function getVendorLabel(model: ModelOption): string {
  const idVendor = model.id.includes('/') ? model.id.split('/')[0] : '';
  const normalizedIdVendor = idVendor.trim();
  if (normalizedIdVendor) {
    return normalizedIdVendor.charAt(0).toUpperCase() + normalizedIdVendor.slice(1);
  }

  const namePrefix = model.name.split(':')[0]?.trim();
  return namePrefix || 'Other';
}

interface APIConfigPanelProps {
  config: APIConfig;
  onSave: (config: APIConfig) => Promise<void>;
  onFetchModels: (config: Pick<APIConfig, 'provider' | 'apiKey' | 'baseUrl'>) => Promise<ModelOption[]>;
  disabled?: boolean;
}

export function APIConfigPanel({ config, onSave, onFetchModels, disabled }: APIConfigPanelProps) {
  const provider: APIProvider = 'openrouter';
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [model, setModel] = useState(config.model || '');
  const [baseUrl, setBaseUrl] = useState(config.baseUrl || '');
  const [models, setModels] = useState<ModelOption[]>(OPENROUTER_MODELS);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const canFetchModels = !disabled && !fetchingModels && Boolean(apiKey.trim());
  const hasConfigChanges = (
    apiKey.trim() !== config.apiKey
    || model.trim() !== config.model
    || baseUrl.trim() !== (config.baseUrl || '')
  );

  useEffect(() => {
    setApiKey(config.apiKey);
    setModel(config.model || '');
    setBaseUrl(config.baseUrl || '');
  }, [config]);

  const groupedModels = useMemo(() => {
    const groups = new Map<string, ModelOption[]>();
    models.forEach((item) => {
      const vendor = getVendorLabel(item);
      const current = groups.get(vendor) || [];
      current.push(item);
      groups.set(vendor, current);
    });

    return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right, 'zh-CN'));
  }, [models]);

  const selectedModel = useMemo(() => {
    const normalizedModel = model.trim();
    if (!normalizedModel) return undefined;
    for (const [, vendorModels] of groupedModels) {
      const found = vendorModels.find((item) => item.id === normalizedModel);
      if (found) {
        return found;
      }
    }
    return models.find((item) => item.id === normalizedModel);
  }, [groupedModels, model, models]);

  const handleSave = async () => {
    setSaving(true);
    await onSave({ provider, apiKey: apiKey.trim(), model: model.trim(), baseUrl: baseUrl.trim() });
    setSaving(false);
  };

  const handleFetchModels = async () => {
    if (!apiKey.trim()) {
      toast.error('请先填写 OpenRouter API Key，再获取模型列表');
      return;
    }

    try {
      setFetchingModels(true);
      const nextModels = await onFetchModels({ provider, apiKey: apiKey.trim(), baseUrl: baseUrl.trim() });
      if (nextModels.length === 0) {
        toast.warning('未获取到可用模型，已保留当前预置列表');
        return;
      }
      setModels(nextModels);
      toast.success(`已获取 ${nextModels.length} 个模型`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '获取模型失败');
    } finally {
      setFetchingModels(false);
    }
  };

  return (
    <Card className="relative z-10">
      <CardHeader className="pb-4">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" />
          API 配置
          <Badge variant="outline" className="text-xs sm:ml-auto">
            <Shield className="h-3 w-3 mr-1" />
            AES-GCM 加密存储
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2.5">
          <Label>API 提供商</Label>
          <div className="flex h-10 items-center rounded-lg border border-input bg-muted/30 px-3 text-sm">
            OpenRouter
          </div>
        </div>

        <div className="space-y-2.5">
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
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${fetchingModels ? 'animate-spin' : ''}`} />
                获取模型
              </Button>
              <Popover open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={modelPickerOpen}
                      className="h-7 px-2 font-normal"
                      disabled={disabled}
                    >
                      <span className="truncate text-left">
                        {selectedModel?.name || '从列表选择'}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  }
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
            placeholder="输入模型 ID，例如 anthropic/claude-sonnet-4"
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            可以直接手动输入模型 ID，也可以先获取模型列表再从列表中选择。
            {selectedModel ? ` 当前匹配：${selectedModel.name}` : ''}
          </p>
        </div>

        <div className="space-y-2.5">
          <Label>API URL / 代理地址</Label>
          <Input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://openrouter.ai/api/v1"
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            可选。用于接入自定义网关、透明代理或兼容 API 前缀。
          </p>
        </div>

        <div className="space-y-2.5">
          <Label>API Key</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-or-..."
                disabled={disabled}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button className="sm:w-auto" onClick={handleSave} disabled={disabled || saving || !hasConfigChanges}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Switch checked={showKey} onCheckedChange={setShowKey} id="show-key" />
            <Label htmlFor="show-key" className="text-xs text-muted-foreground cursor-pointer">
              显示密钥
            </Label>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
