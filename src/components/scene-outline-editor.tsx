'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, ListTree, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ChunkSynthesis, ScenePlan, WorkflowMode } from '@/lib/types';

interface DraftScene extends ScenePlan {
  chunkIndexesText: string;
}

type SceneInsight = {
  chunkCount: number;
  summaryLength: number;
  shouldSuggestMerge: boolean;
  hint: string | null;
};

interface SceneOutlineEditorProps {
  sceneOutline: ScenePlan[];
  chunkSyntheses: ChunkSynthesis[];
  workflowMode: WorkflowMode;
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

function isGenericSceneTitle(title: string): boolean {
  return /^第\s*\d+\s*节$/u.test(title.trim());
}

function buildChunkIndexesText(indexes: number[]): string {
  return Array.from(new Set(indexes))
    .sort((left, right) => left - right)
    .map((index) => index + 1)
    .join(', ');
}

function chooseMergedSceneTitle(previous: DraftScene, current: DraftScene, nextIndex: number): string {
  const previousTitle = previous.title.trim();
  const currentTitle = current.title.trim();

  if (!previousTitle) {
    return currentTitle || `第 ${nextIndex} 节`;
  }

  if (!currentTitle || isGenericSceneTitle(currentTitle)) {
    return previousTitle;
  }

  if (isGenericSceneTitle(previousTitle)) {
    return currentTitle;
  }

  if (
    /终章|尾声|幕间|收束|结尾/u.test(currentTitle)
    && !previousTitle.includes(currentTitle)
  ) {
    return `${previousTitle} · ${currentTitle}`;
  }

  return previousTitle;
}

function mergeDraftScenes(previous: DraftScene, current: DraftScene, nextIndex: number): DraftScene {
  const mergedChunkIndexes = [
    ...parseChunkIndexes(previous.chunkIndexesText),
    ...parseChunkIndexes(current.chunkIndexesText),
  ];
  const mergedSummary = [previous.summary.trim(), current.summary.trim()].filter(Boolean).join('\n\n');

  return {
    sceneId: previous.sceneId || `scene-${nextIndex}`,
    title: chooseMergedSceneTitle(previous, current, nextIndex),
    summary: mergedSummary,
    chunkIndexes: Array.from(new Set(mergedChunkIndexes)).sort((left, right) => left - right),
    chunkIndexesText: buildChunkIndexesText(mergedChunkIndexes),
  };
}

function buildSceneInsight(
  scene: DraftScene,
  index: number,
  totalScenes: number,
  unitLabel: string
): SceneInsight {
  const chunkCount = parseChunkIndexes(scene.chunkIndexesText).length;
  const summaryLength = scene.summary.trim().length;
  const title = scene.title.trim();
  const isTailScene = index === totalScenes - 1;
  const isLeadingScene = index === 0;
  const isFinaleLike = /终章|尾声|幕间|收束|结尾/u.test(title);
  const isIntroLike = /空白|标题|扉页|封面|无实质|引子/u.test(`${title}\n${scene.summary}`.trim());
  const shouldSuggestMerge = chunkCount === 1 && (
    summaryLength < 180
    || isTailScene
    || isLeadingScene
    || isFinaleLike
    || isIntroLike
  );

  if (!shouldSuggestMerge) {
    return {
      chunkCount,
      summaryLength,
      shouldSuggestMerge: false,
      hint: null,
    };
  }

  return {
    chunkCount,
    summaryLength,
    shouldSuggestMerge: true,
    hint: isLeadingScene && isIntroLike
      ? '这个场景更像封面、标题页或引子，单独成节通常会显得太碎。可以考虑并入下一场。'
      : isTailScene
      ? `这个场景只有 1 个${unitLabel}，且位于末尾，最后成文可能偏短。可以考虑并入上一场，减少“尾巴感”。`
      : `这个场景只有 1 个${unitLabel}，成文可能偏短。若它和上一场承接很紧，可以考虑合并。`,
  };
}

function optimizeDraftScenes(scenes: DraftScene[], unitLabel: string): DraftScene[] {
  const workingScenes = scenes.map((scene) => ({
    ...scene,
    chunkIndexesText: buildChunkIndexesText(parseChunkIndexes(scene.chunkIndexesText)),
  }));

  if (workingScenes.length > 1) {
    const leadingInsight = buildSceneInsight(workingScenes[0], 0, workingScenes.length, unitLabel);
    if (leadingInsight.shouldSuggestMerge && /封面|标题页|引子/u.test(leadingInsight.hint || '')) {
      const leadingScene = workingScenes.shift();
      const nextScene = workingScenes.shift();

      if (leadingScene && nextScene) {
        workingScenes.unshift({
          ...mergeDraftScenes(leadingScene, nextScene, 1),
          title: nextScene.title.trim() || leadingScene.title.trim() || '第 1 节',
        });
      }
    }
  }

  return workingScenes.reduce<DraftScene[]>((result, scene, index) => {
    if (result.length === 0) {
      result.push(scene);
      return result;
    }

    const insight = buildSceneInsight(scene, index, workingScenes.length, unitLabel);
    if (!insight.shouldSuggestMerge) {
      result.push(scene);
      return result;
    }

    const previous = result[result.length - 1];
    result[result.length - 1] = mergeDraftScenes(previous, scene, result.length);
    return result;
  }, []).map((scene, index) => ({
    ...scene,
    sceneId: `scene-${index + 1}`,
  }));
}

export function SceneOutlineEditor({
  sceneOutline,
  chunkSyntheses,
  workflowMode,
  disabled,
  onSave,
  onConfirmAndContinue,
}: SceneOutlineEditorProps) {
  const [draftScenes, setDraftScenes] = useState<DraftScene[]>(() => toDraftScenes(sceneOutline));
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [expandedSceneIndex, setExpandedSceneIndex] = useState<number | null>(null);

  useEffect(() => {
    setDraftScenes(toDraftScenes(sceneOutline));
    setDirty(false);
    setExpandedSceneIndex(null);
  }, [sceneOutline]);

  useEffect(() => {
    if (expandedSceneIndex !== null && expandedSceneIndex >= draftScenes.length) {
      setExpandedSceneIndex(null);
    }
  }, [draftScenes.length, expandedSceneIndex]);

  const splitDraftMode = workflowMode === 'split-draft';
  const chunkUnitLabel = splitDraftMode ? '部分' : '分块';
  const sectionSplitLabel = splitDraftMode ? '分段' : '分块';

  const chunkTitles = useMemo(() => (
    new Map(chunkSyntheses.map((chunk) => [chunk.index, chunk.title || `${chunkUnitLabel} ${chunk.index + 1}`]))
  ), [chunkSyntheses, chunkUnitLabel]);

  const coveredChunkCount = useMemo(() => {
    const usedChunks = new Set(draftScenes.flatMap((scene) => parseChunkIndexes(scene.chunkIndexesText)));
    return usedChunks.size;
  }, [draftScenes]);

  const sceneInsights = useMemo(() => (
    draftScenes.map((scene, index) => buildSceneInsight(scene, index, draftScenes.length, chunkUnitLabel))
  ), [chunkUnitLabel, draftScenes]);

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
      toast.success('场景大纲已确认，已进入写作前准备并生成全书统稿');
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
              整书综合已经完成。请先检查并编辑场景划分；确认后会先自动生成写作前全书统稿，再进入章节写作。
            </CardDescription>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">场景 {draftScenes.length}</Badge>
            <Badge variant="outline">覆盖{chunkUnitLabel} {coveredChunkCount} / {chunkSyntheses.length}</Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {draftScenes.map((scene, index) => {
          const chunkIndexes = parseChunkIndexes(scene.chunkIndexesText);
          const sceneInsight = sceneInsights[index];
          const isExpanded = expandedSceneIndex === index;

          return (
            <div key={scene.sceneId || `scene-${index}`} className="space-y-3 rounded-xl border bg-background/90 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">场景 {index + 1}</div>
                <div className="flex flex-wrap gap-2">
                  {index > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2"
                      onClick={() => {
                        setDraftScenes((prev) => {
                          const previous = prev[index - 1];
                          const current = prev[index];
                          if (!previous || !current) {
                            return prev;
                          }

                          const merged = mergeDraftScenes(previous, current, index);
                          return prev
                            .map((item, sceneIndex) => {
                              if (sceneIndex === index - 1) {
                                return merged;
                              }
                              return item;
                            })
                            .filter((_, sceneIndex) => sceneIndex !== index)
                            .map((item, sceneIndex) => ({
                              ...item,
                              sceneId: `scene-${sceneIndex + 1}`,
                            }));
                        });
                        setExpandedSceneIndex(null);
                        setDirty(true);
                      }}
                      disabled={disabled}
                    >
                      合并到上一场
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-destructive"
                    onClick={() => {
                      setDraftScenes((prev) => prev.filter((_, sceneIndex) => sceneIndex !== index));
                      setExpandedSceneIndex(null);
                      setDirty(true);
                    }}
                    disabled={disabled || draftScenes.length <= 1}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    删除
                  </Button>
                </div>
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
                    <Label>关联{chunkUnitLabel}</Label>
                    <Input
                      value={scene.chunkIndexesText}
                      onChange={(event) => updateScene(index, { chunkIndexesText: event.target.value })}
                      placeholder="例如：1,2,3"
                      disabled={disabled}
                    />
                    <p className="text-xs text-muted-foreground">
                      用{chunkUnitLabel}编号填写，按 1 开始。例如 `1,2,3` 表示引用第 1 到第 3 个{chunkUnitLabel}。
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label>场景摘要</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 px-2.5"
                      onClick={() => setExpandedSceneIndex((prev) => (prev === index ? null : index))}
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp className="mr-1 h-3.5 w-3.5" />
                          收起
                        </>
                      ) : (
                        <>
                          <ChevronDown className="mr-1 h-3.5 w-3.5" />
                          详情
                        </>
                      )}
                    </Button>
                  </div>
                  {isExpanded ? (
                    <Textarea
                      value={scene.summary}
                      onChange={(event) => updateScene(index, { summary: event.target.value })}
                      disabled={disabled}
                      className="min-h-32 max-h-80 resize-y overflow-y-auto leading-6 [field-sizing:fixed]"
                    />
                  ) : (
                    <div className="rounded-lg border bg-muted/20 px-3 py-2">
                      <div className="max-h-24 overflow-hidden whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                        {scene.summary.trim() || '暂无摘要'}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{sectionSplitLabel} {sceneInsight.chunkCount}</Badge>
                <Badge variant="outline">摘要 {sceneInsight.summaryLength} 字</Badge>
                {chunkIndexes.map((chunkIndex) => (
                  <Badge key={`${scene.sceneId}-${chunkIndex}`} variant="secondary">
                    #{chunkIndex + 1} {chunkTitles.get(chunkIndex) || `${chunkUnitLabel} ${chunkIndex + 1}`}
                  </Badge>
                ))}
              </div>

              {sceneInsight.hint ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                  {sceneInsight.hint}
                </div>
              ) : null}
            </div>
          );
        })}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDraftScenes((prev) => [...prev, buildNextScene()]);
              setExpandedSceneIndex(draftScenes.length);
              setDirty(true);
            }}
            disabled={disabled}
            data-action="add-scene-outline-item"
          >
            <Plus className="mr-1 h-4 w-4" />
            新增场景
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const nextScenes = optimizeDraftScenes(draftScenes, chunkUnitLabel);
              const changed = JSON.stringify(nextScenes) !== JSON.stringify(draftScenes);
              setDraftScenes(nextScenes);
              setExpandedSceneIndex(null);
              if (changed) {
                setDirty(true);
                toast.success('已按较短场景自动整理');
              }
            }}
            disabled={disabled || draftScenes.length <= 1}
            data-action="optimize-scene-outline"
          >
            智能整理
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={handleSave}
            disabled={disabled || !dirty}
            data-action="save-scene-outline"
          >
            <Save className="mr-1 h-4 w-4" />
            保存修改
          </Button>

          <Button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={disabled || confirming}
            data-action="confirm-outline-continue"
          >
            <Check className="mr-1 h-4 w-4" />
            {confirming ? '确认中...' : '确认并生成统稿'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
