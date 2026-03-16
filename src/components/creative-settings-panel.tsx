'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, WandSparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import type { CreativePreset, CreativeSettings } from '@/lib/types';
import { WRITING_MODE_LABELS } from '@/lib/types';
import { composeSystemPrompt, splitSystemPrompt } from '@/lib/prompts';

interface CreativeSettingsPanelProps {
  settings: CreativeSettings;
  presets: CreativePreset[];
  onUpdate: (settings: Partial<CreativeSettings>) => void;
  onApplyPreset: (presetId: string) => void;
  onSavePreset: (name: string) => void;
  onDeletePreset: (presetId: string) => void;
  disabled?: boolean;
}

export function CreativeSettingsPanel({
  settings,
  presets,
  onUpdate,
  onApplyPreset,
  onSavePreset,
  onDeletePreset,
  disabled,
}: CreativeSettingsPanelProps) {
  const [showSupplementalPrompt, setShowSupplementalPrompt] = useState(false);
  const [showRoleAndStyle, setShowRoleAndStyle] = useState(false);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);

  const { supplementalPrompt, roleAndStyle, systemPromptBody } = useMemo(
    () => splitSystemPrompt(settings.systemPrompt),
    [settings.systemPrompt]
  );

  const handleSupplementalPromptChange = (value: string) => {
    onUpdate({ systemPrompt: composeSystemPrompt(value, roleAndStyle, systemPromptBody) });
  };

  const handleRoleAndStyleChange = (value: string) => {
    onUpdate({ systemPrompt: composeSystemPrompt(supplementalPrompt, value, systemPromptBody) });
  };

  const handleSystemPromptBodyChange = (value: string) => {
    onUpdate({ systemPrompt: composeSystemPrompt(supplementalPrompt, roleAndStyle, value) });
  };

  const handleSavePreset = () => {
    const presetName = window.prompt('输入预设名称');
    if (presetName === null) {
      return;
    }
    onSavePreset(presetName);
  };

  const isBuiltInPreset = presets.some((preset) => preset.id === settings.presetId && !preset.id.startsWith('user-'));
  const canDeletePreset = settings.presetId.startsWith('user-') && !isBuiltInPreset;

  const handleDeletePreset = () => {
    if (!canDeletePreset) {
      return;
    }
    const currentPreset = presets.find((preset) => preset.id === settings.presetId);
    const confirmed = window.confirm(`确认删除预设「${currentPreset?.name || '当前预设'}」吗？`);
    if (!confirmed) {
      return;
    }
    onDeletePreset(settings.presetId);
  };

  return (
    <Card className="relative z-10">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <WandSparkles className="h-4 w-4" />
          创作设置
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <Label>风格预设</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2"
                onClick={handleSavePreset}
                disabled={disabled}
              >
                保存为预设
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2"
                onClick={handleDeletePreset}
                disabled={disabled || !canDeletePreset}
              >
                删除预设
              </Button>
            </div>
          </div>
          <Select
            value={settings.presetId}
            onValueChange={(value) => value && onApplyPreset(value)}
            disabled={disabled}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[9999] max-h-80 sm:max-h-96" sideOffset={10}>
              {presets.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  <span className="block truncate" title={preset.name}>{preset.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            选择预设时只会替换“风格”内容，不会改动补充提示和系统提示词。
          </p>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <Label>写作模式</Label>
          </div>
          <Select
            value={settings.writingMode}
            onValueChange={(value) => {
              if (value === 'faithful' || value === 'literary') {
                onUpdate({ writingMode: value });
              }
            }}
            disabled={disabled}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[9999]">
              <SelectItem value="faithful">{WRITING_MODE_LABELS.faithful}</SelectItem>
              <SelectItem value="literary">{WRITING_MODE_LABELS.literary}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            忠实转写更稳，优先保留原信息；文学改写会在不改变剧情的前提下加强氛围、节奏和文字质感。
          </p>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <Label>Temperature</Label>
            <span className="rounded bg-muted px-2 py-0.5 text-sm font-mono">
              {settings.temperature.toFixed(2)}
            </span>
          </div>
          <Slider
            value={[settings.temperature]}
            onValueChange={(value) => onUpdate({ temperature: Number((Array.isArray(value) ? value[0] : value).toFixed(2)) })}
            min={0}
            max={1.2}
            step={0.05}
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            数值越高，语言越发散；数值越低，叙事越稳定。
          </p>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <Label>特殊提示词</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2"
              onClick={() => setShowSupplementalPrompt((prev) => !prev)}
              disabled={disabled}
            >
              {showSupplementalPrompt ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <ChevronDown className="mr-1 h-3.5 w-3.5" />}
              {showSupplementalPrompt ? '收起' : '展开'}
            </Button>
          </div>
          {showSupplementalPrompt ? (
            <Textarea
              value={supplementalPrompt}
              onChange={(event) => handleSupplementalPromptChange(event.target.value)}
              disabled={disabled}
              className="min-h-24 resize-y leading-6"
              placeholder="输入额外创作要求或本轮强调点..."
            />
          ) : (
            <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
              这里适合放额外创作强调、临时补充要求或本轮特别想强化的表达重点。
            </div>
          )}
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <Label>风格</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2"
              onClick={() => setShowRoleAndStyle((prev) => !prev)}
              disabled={disabled}
            >
              {showRoleAndStyle ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <ChevronDown className="mr-1 h-3.5 w-3.5" />}
              {showRoleAndStyle ? '收起' : '展开'}
            </Button>
          </div>
          {showRoleAndStyle ? (
            <Textarea
              value={roleAndStyle}
              onChange={(event) => handleRoleAndStyleChange(event.target.value)}
              disabled={disabled}
              className="min-h-28 resize-y leading-6"
              placeholder="输入角色设定、文风方向和叙事口吻..."
            />
          ) : (
            <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
              这里适合放角色设定、文风走向、叙事口吻和情绪张力等经常会改的内容。
            </div>
          )}
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <Label>系统提示词</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2"
              onClick={() => setShowSystemPrompt((prev) => !prev)}
              disabled={disabled}
            >
              {showSystemPrompt ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <ChevronDown className="mr-1 h-3.5 w-3.5" />}
              {showSystemPrompt ? '收起' : '展开'}
            </Button>
          </div>
          {showSystemPrompt ? (
            <Textarea
              value={systemPromptBody}
              onChange={(event) => handleSystemPromptBodyChange(event.target.value)}
              disabled={disabled}
              className="min-h-72 resize-y leading-6"
              placeholder="输入任务说明、输出规则和格式要求..."
            />
          ) : (
            <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
              这里放任务说明、输出规则和 JSON 格式要求。User Prompt 模板已从前端隐藏。
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            修改后会实时参与每一轮分块请求。系统提示词更适合放结构化规则，而“风格”更适合放创作语气。
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
