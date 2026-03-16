'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, ListTree, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ChunkSynthesis, ScenePlan } from '@/lib/types';

interface DraftScene extends ScenePlan {
  chunkIndexesText: string;
}

interface SceneOutlineEditorProps {
  sceneOutline: ScenePlan[];
  chunkSyntheses: ChunkSynthesis[];
  disabled?: boolean;
  onSave: (sceneOutline: ScenePlan[]) => void;
  onConfirmAndContinue: () => Promise<void>;
}

function toDraftScenes(sceneOutline: ScenePlan[]): DraftScene[] {
  return sceneOutline.map((scene) => ({
    ...scene,
    chunkIndexesText: scene.chunkIndexes.map((index) => index + 1).join(', '),
  }));
}

function parseChunkIndexes(chunkIndexesText: string): number[] {
  const indexes = chunkIndexesText
    .split(/[\s,，、]+/u)
    .map((token) => Number(token.trim()))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.trunc(value) - 1);

  return Array.from(new Set(indexes)).sort((left, right) => left - right);
}

export function SceneOutlineEditor({
  sceneOutline,
  chunkSyntheses,
  disabled,
  onSave,
  onConfirmAndContinue,
}: SceneOutlineEditorProps) {
  const [draftScenes, setDraftScenes] = useState<DraftScene[]>(() => toDraftScenes(sceneOutline));
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setDraftScenes(toDraftScenes(sceneOutline));
    setDirty(false);
  }, [sceneOutline]);

  const chunkTitles = useMemo(() => (
    new Map(chunkSyntheses.map((chunk) => [chunk.index, chunk.title || `分块 ${chunk.index + 1}`]))
  ), [chunkSyntheses]);

  const coveredChunkCount = useMemo(() => {
    const usedChunks = new Set(draftScenes.flatMap((scene) => parseChunkIndexes(scene.chunkIndexesText)));
    return usedChunks.size;
  }, [draftScenes]);

  const buildNextScene = (): DraftScene => {
    const usedChunks = new Set(draftScenes.flatMap((scene) => parseChunkIndexes(scene.chunkIndexesText)));
    const nextChunkIndex = chunkSyntheses.find((chunk) => !usedChunks.has(chunk.index))?.index
      ?? chunkSyntheses[chunkSyntheses.length - 1]?.index
      ?? 0;
    const nextIndex = draftScenes.length + 1;

    return {
      sceneId: `scene-${nextIndex}`,
      title: `第 ${nextIndex} 节`,
      summary: '',
      chunkIndexes: nextChunkIndex >= 0 ? [nextChunkIndex] : [],
      chunkIndexesText: nextChunkIndex >= 0 ? String(nextChunkIndex + 1) : '',
    };
  };

  const updateScene = (index: number, patch: Partial<DraftScene>) => {
    setDraftScenes((prev) => prev.map((scene, sceneIndex) => (
      sceneIndex === index ? { ...scene, ...patch } : scene
    )));
    setDirty(true);
  };

  const validateScenes = (): ScenePlan[] => {
    const normalizedScenes = draftScenes.map((scene, index) => ({
      sceneId: scene.sceneId.trim() || `scene-${index + 1}`,
      title: scene.title.trim() || `第 ${index + 1} 节`,
      summary: scene.summary.trim(),
      chunkIndexes: parseChunkIndexes(scene.chunkIndexesText).filter((chunkIndex) => (
        chunkIndex >= 0 && chunkIndex < chunkSyntheses.length
      )),
    }));

    if (normalizedScenes.length === 0) {
      throw new Error('请至少保留一个场景。');
    }

    const emptyChunkScene = normalizedScenes.findIndex((scene) => scene.chunkIndexes.length === 0);
    if (emptyChunkScene !== -1) {
      throw new Error(`第 ${emptyChunkScene + 1} 个场景还没有绑定分块。请填写分块编号，例如 1,2,3。`);
    }

    return normalizedScenes;
  };

  const handleSave = (): boolean => {
    try {
      const normalizedScenes = validateScenes();
      onSave(normalizedScenes);
      setDirty(false);
      toast.success('sceneOutline 已保存');
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '场景大纲保存失败');
      return false;
    }
  };

  const handleConfirm = async () => {
    try {
      if (dirty) {
        const saved = handleSave();
        if (!saved) {
          return;
        }
      } else {
        validateScenes();
      }

      setConfirming(true);
      await onConfirmAndContinue();
      setDirty(false);
      toast.success('场景大纲已确认，继续进入章节写作');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '场景大纲确认失败');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListTree className="h-4 w-4" />
              sceneOutline 人工确认
            </CardTitle>
            <CardDescription>
              整书综合已经完成。请先检查并编辑场景划分，再继续进入章节写作。
            </CardDescription>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">场景 {draftScenes.length}</Badge>
            <Badge variant="outline">覆盖分块 {coveredChunkCount} / {chunkSyntheses.length}</Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {draftScenes.map((scene, index) => {
          const chunkIndexes = parseChunkIndexes(scene.chunkIndexesText);

          return (
            <div key={scene.sceneId || `scene-${index}`} className="space-y-3 rounded-xl border bg-background/90 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">场景 {index + 1}</div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-destructive"
                  onClick={() => {
                    setDraftScenes((prev) => prev.filter((_, sceneIndex) => sceneIndex !== index));
                    setDirty(true);
                  }}
                  disabled={disabled || draftScenes.length <= 1}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  删除
                </Button>
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label>章节标题</Label>
                    <Input
                      value={scene.title}
                      onChange={(event) => updateScene(index, { title: event.target.value })}
                      disabled={disabled}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>关联分块</Label>
                    <Input
                      value={scene.chunkIndexesText}
                      onChange={(event) => updateScene(index, { chunkIndexesText: event.target.value })}
                      placeholder="例如：1,2,3"
                      disabled={disabled}
                    />
                    <p className="text-xs text-muted-foreground">
                      用分块编号填写，按 1 开始。例如 `1,2,3` 表示引用第 1 到第 3 个分块。
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>场景摘要</Label>
                  <Textarea
                    value={scene.summary}
                    onChange={(event) => updateScene(index, { summary: event.target.value })}
                    disabled={disabled}
                    className="min-h-28 resize-y leading-6"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {chunkIndexes.map((chunkIndex) => (
                  <Badge key={`${scene.sceneId}-${chunkIndex}`} variant="secondary">
                    #{chunkIndex + 1} {chunkTitles.get(chunkIndex) || `分块 ${chunkIndex + 1}`}
                  </Badge>
                ))}
              </div>
            </div>
          );
        })}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDraftScenes((prev) => [...prev, buildNextScene()]);
              setDirty(true);
            }}
            disabled={disabled}
          >
            <Plus className="mr-1 h-4 w-4" />
            新增场景
          </Button>

          <Button type="button" variant="outline" onClick={handleSave} disabled={disabled || !dirty}>
            <Save className="mr-1 h-4 w-4" />
            保存修改
          </Button>

          <Button type="button" onClick={() => void handleConfirm()} disabled={disabled || confirming}>
            <Check className="mr-1 h-4 w-4" />
            {confirming ? '确认中...' : '确认并继续'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
