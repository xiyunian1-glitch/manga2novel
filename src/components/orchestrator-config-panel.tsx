'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
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
        <div className="space-y-2 rounded-lg border bg-muted/15 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <Label className="text-sm">全书统稿 / 润色</Label>
              <p className="text-xs text-muted-foreground">
                章节写作全部完成后，可选再跑一次全书统稿，统一称呼、衔接、节奏与文风。
              </p>
            </div>
            <Switch
              checked={config.enableFinalPolish}
              onCheckedChange={(checked) => onUpdate({ enableFinalPolish: checked })}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">每组图片数（逐页分析）</Label>
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
            控制逐页分析阶段每次发给 AI 的图片数量。0 表示自动合并为一组，50 为上限。
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">分块综合数量</Label>
            <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
              {config.synthesisChunkCount}
            </span>
          </div>
          <Slider
            value={[config.synthesisChunkCount]}
            onValueChange={(v) => onUpdate({ synthesisChunkCount: Array.isArray(v) ? v[0] : v })}
            min={1}
            max={32}
            step={1}
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            控制后续“分块综合”会把全书切成多少块。系统会按页码顺序尽量均匀分配，页数不足时会自动缩到总页数。
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">并发请求数 (Max Concurrency)</Label>
            <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
              {config.maxConcurrency}
            </span>
          </div>
          <Slider
            value={[config.maxConcurrency]}
            onValueChange={(v) => onUpdate({ maxConcurrency: Array.isArray(v) ? v[0] : v })}
            min={1}
            max={8}
            step={1}
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            同时处理的图片预处理与逐页分析请求数。通常 2 到 4 会明显更快，过高可能触发模型限流。
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
