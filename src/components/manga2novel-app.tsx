'use client';

import { useState } from 'react';
import { useManga2Novel } from '@/hooks/use-manga2novel';
import { APIConfigPanel } from '@/components/api-config-panel';
import { CreativeSettingsPanel } from '@/components/creative-settings-panel';
import { ImageUploadPanel } from '@/components/image-upload-panel';
import { OrchestratorConfigPanel } from '@/components/orchestrator-config-panel';
import { ProgressPanel } from '@/components/progress-panel';
import { NovelPreview } from '@/components/novel-preview';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Toaster, toast } from 'sonner';
import {
  Play, Pause, SkipForward, RotateCcw, RefreshCw, BookOpenText, Send,
} from 'lucide-react';

export default function Manga2NovelApp() {
  const [lastRequestOpen, setLastRequestOpen] = useState(false);
  const {
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
  } = useManga2Novel();

  const isRunning = taskState.status === 'running' || taskState.status === 'preparing';
  const isPaused = taskState.status === 'paused';
  const isCompleted = taskState.status === 'completed';
  const canStart = images.length > 0 && apiConfig.apiKey && apiConfig.model.trim() && !isRunning;
  const lastAIRequest = taskState.lastAIRequest;

  const handleStart = async () => {
    try {
      await startProcessing();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '处理失败');
    }
  };

  const handleResume = async () => {
    try {
      await resume();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '恢复失败');
    }
  };

  const handleSkip = async () => {
    try {
      await skipCurrent();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '跳过失败');
    }
  };

  const handleRetry = async () => {
    try {
      await retryCurrent();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重试失败');
    }
  };

  if (!configLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Toaster position="top-right" richColors />

      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <BookOpenText className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold">Manga2Novel</h1>
            <span className="text-xs text-muted-foreground hidden sm:inline">漫画转小说 · 纯前端 AI 工具</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Dialog open={lastRequestOpen} onOpenChange={setLastRequestOpen}>
              <DialogTrigger
                render={
                  <Button type="button" variant="outline" disabled={!lastAIRequest}>
                    <Send className="h-4 w-4 mr-1" />
                    查看上次发送
                  </Button>
                }
              />
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>上一次发给 AI 的内容</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div><span className="font-medium">模型：</span>{lastAIRequest?.model || '暂无'}</div>
                  <div><span className="font-medium">提供商：</span>{lastAIRequest?.provider || '暂无'}</div>
                  <div><span className="font-medium">分块：</span>{lastAIRequest ? `第 ${lastAIRequest.chunkIndex + 1} 块` : '暂无'}</div>
                  <div><span className="font-medium">图片数：</span>{lastAIRequest ? `${lastAIRequest.imageCount} 张` : '暂无'}</div>
                  <div className="sm:col-span-2"><span className="font-medium">图片：</span>{lastAIRequest?.imageNames.join('，') || '暂无'}</div>
                  <div className="sm:col-span-2"><span className="font-medium">接口地址：</span>{lastAIRequest?.baseUrl || '默认地址'}</div>
                </div>
                <ScrollArea className="h-[420px] rounded-lg border border-border bg-muted/20 p-3">
                  <div className="space-y-4 pr-4">
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-muted-foreground">System Prompt</div>
                      <pre className="whitespace-pre-wrap break-words text-xs leading-6">{lastAIRequest?.systemPrompt || '暂无'}</pre>
                    </div>
                    <Separator />
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-muted-foreground">User Prompt</div>
                      <pre className="whitespace-pre-wrap break-words text-xs leading-6">{lastAIRequest?.userPrompt || '暂无'}</pre>
                    </div>
                  </div>
                </ScrollArea>
              </DialogContent>
            </Dialog>
            {/* 控制按钮组 */}
            {!isRunning && !isPaused && !isCompleted && (
              <Button onClick={handleStart} disabled={!canStart}>
                <Play className="h-4 w-4 mr-1" />
                开始转换
              </Button>
            )}
            {isRunning && (
              <Button variant="secondary" onClick={pause}>
                <Pause className="h-4 w-4 mr-1" />
                暂停
              </Button>
            )}
            {isPaused && (
              <>
                <Button onClick={handleResume}>
                  <Play className="h-4 w-4 mr-1" />
                  继续
                </Button>
                <Button variant="outline" onClick={handleSkip}>
                  <SkipForward className="h-4 w-4 mr-1" />
                  跳过
                </Button>
                <Button variant="outline" onClick={handleRetry}>
                  <RotateCcw className="h-4 w-4 mr-1" />
                  重试
                </Button>
              </>
            )}
            {(isPaused || isCompleted) && (
              <Button variant="ghost" onClick={reset}>
                <RefreshCw className="h-4 w-4 mr-1" />
                重置
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          {/* Left Column: 配置 + 上传 */}
          <div className="space-y-6">
            <APIConfigPanel
              config={apiConfig}
              onSave={saveApiConfig}
              onFetchModels={fetchModels}
              disabled={isRunning}
            />

            <CreativeSettingsPanel
              settings={taskState.creativeSettings}
              presets={creativePresets}
              onUpdate={updateCreativeSettings}
              onApplyPreset={applyCreativePreset}
              onSavePreset={saveCreativePreset}
              onDeletePreset={deleteCreativePreset}
              disabled={isRunning}
            />

            <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
              <ImageUploadPanel
                images={images}
                onAdd={addImages}
                onRemove={removeImage}
                onReorder={reorderImages}
                onClear={clearImages}
                disabled={isRunning}
              />
              <div className="space-y-4">
                <OrchestratorConfigPanel
                  config={taskState.config}
                  onUpdate={saveOrchestratorConfig}
                  disabled={isRunning}
                />
                <ProgressPanel taskState={taskState} />
              </div>
            </div>
          </div>

          {/* Right Column: 小说预览 */}
          <div>
            <NovelPreview taskState={taskState} onExport={exportNovel} />
          </div>
        </div>

        <Separator className="my-8" />

        {/* Footer */}
        <footer className="text-center text-xs text-muted-foreground pb-4">
          <p>Manga2Novel — 纯前端架构 · 所有数据仅在浏览器本地处理 · API Key 以 AES-GCM 加密存储</p>
          <p className="mt-1">支持 OpenRouter (跨 CORS 无障碍) 和 Google Gemini API</p>
        </footer>
      </main>
    </div>
  );
}
