'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { WandSparkles } from 'lucide-react';
import type { CreativePreset, CreativeSettings } from '@/lib/types';

interface CreativeSettingsPanelProps {
  settings: CreativeSettings;
  presets: CreativePreset[];
  onUpdate: (settings: Partial<CreativeSettings>) => void;
  onApplyPreset: (presetId: string) => void;
  disabled?: boolean;
}

export function CreativeSettingsPanel({
  settings,
  presets,
  onUpdate,
  onApplyPreset,
  disabled,
}: CreativeSettingsPanelProps) {
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
          <Label>风格预设</Label>
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
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <Label>Temperature</Label>
            <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
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
          <Label>System Prompt</Label>
          <Textarea
            value={settings.systemPrompt}
            onChange={(event) => onUpdate({ systemPrompt: event.target.value })}
            disabled={disabled}
            className="min-h-56 resize-y leading-6"
            placeholder="输入 AI 的角色设定、叙事风格、语言约束与输出要求..."
          />
          <p className="text-xs text-muted-foreground">
            修改后会实时参与每一轮分块请求，影响 Memory Loop 的创作风格。
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
