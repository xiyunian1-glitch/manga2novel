'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Settings } from 'lucide-react';
import type { OrchestratorConfig } from '@/lib/types';

interface OrchestratorConfigPanelProps {
  config: OrchestratorConfig;
  onUpdate: (config: Partial<OrchestratorConfig>) => void;
  disabled?: boolean;
}

export function OrchestratorConfigPanel({ config, onUpdate, disabled }: OrchestratorConfigPanelProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings className="h-4 w-4" />
          队列配置
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">每组图片数 (Chunk Size)</Label>
            <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
              {config.chunkSize === 0 ? '自动' : config.chunkSize}
            </span>
          </div>
          <Slider
            value={[config.chunkSize]}
            onValueChange={(v) => onUpdate({ chunkSize: Array.isArray(v) ? v[0] : v })}
            min={0}
            max={50}
            step={1}
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            每次发送给 AI 的图片数量。0 表示自动合并为一组，50 为上限。
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">最大重试次数</Label>
            <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
              {config.maxRetries}
            </span>
          </div>
          <Slider
            value={[config.maxRetries]}
            onValueChange={(v) => onUpdate({ maxRetries: Array.isArray(v) ? v[0] : v })}
            min={0}
            max={5}
            step={1}
            disabled={disabled}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">重试间隔 (ms)</Label>
            <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
              {config.retryDelay}
            </span>
          </div>
          <Slider
            value={[config.retryDelay]}
            onValueChange={(v) => onUpdate({ retryDelay: Array.isArray(v) ? v[0] : v })}
            min={500}
            max={10000}
            step={500}
            disabled={disabled}
          />
        </div>
      </CardContent>
    </Card>
  );
}
