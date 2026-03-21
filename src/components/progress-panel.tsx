'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle,
  Clock,
  Eye,
  Loader2,
  Pencil,
  RefreshCw,
  SkipForward,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  applyDialogueResolutionMap,
  createDialogueResolutionMap,
} from '@/lib/dialogue-resolution';
import { getTroubleshootingAdvice } from '@/lib/error-hints';
import type { ChunkStatus, PipelineStage, RequestStage, TaskState } from '@/lib/types';

interface ProgressPanelProps {
  taskState: TaskState;
  onRegenerateItem?: (stage: RequestStage, itemIndex: number) => Promise<void>;
  onUpdateItem?: (stage: RequestStage, itemIndex: number, value: unknown) => Promise<void>;
}

type StageCard = {
  stage: RequestStage;
  title: string;
  value: string;
  hint: string;
  secondary?: string;
};

type ProgressItem = {
  key: string;
  stage: RequestStage;
  itemIndex: number;
  batchIndex?: number;
  runtimeScope?: 'item' | 'batch';
  label: string;
  meta: string;
  status: ChunkStatus;
  runtimeMs: number;
  runtimeStartedAt?: string;
  preview: string;
  detail: string;
  error?: string;
};

function isSplitDraftMode(taskState: TaskState): boolean {
  return taskState.config.workflowMode === 'split-draft';
}

function isCompletedStatus(status: ChunkStatus, error?: string): boolean {
  return status === 'success' || (status === 'skipped' && !String(error || '').trim());
}

function countCompleted(items: Array<{ status: ChunkStatus; error?: string }>): number {
  return items.filter((item) => isCompletedStatus(item.status, item.error)).length;
}

function statusLabel(status: ChunkStatus): string {
  switch (status) {
    case 'processing':
      return '处理中';
    case 'success':
      return '完成';
    case 'error':
      return '失败';
    case 'skipped':
      return '已跳过';
    default:
      return '等待中';
  }
}

function formatRuntime(runtimeMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(runtimeMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getLiveRuntimeMs(runtimeMs: number, runtimeStartedAt: string | undefined, nowMs: number): number {
  const startedAtMs = runtimeStartedAt ? Date.parse(runtimeStartedAt) : Number.NaN;
  return runtimeMs + (
    Number.isFinite(startedAtMs)
      ? Math.max(0, nowMs - startedAtMs)
      : 0
  );
}

function hasAnyItemRuntimeInProgress(taskState: TaskState): boolean {
  return taskState.pageAnalyses.some((page) => Boolean(page.runtimeStartedAt))
    || taskState.chunkSyntheses.some((chunk) => Boolean(chunk.runtimeStartedAt))
    || Boolean(taskState.globalSynthesis.runtimeStartedAt)
    || Boolean(taskState.writingPreparation.runtimeStartedAt)
    || taskState.novelSections.some((section) => Boolean(section.runtimeStartedAt))
    || Boolean(taskState.finalPolish.runtimeStartedAt);
}

function formatItemRuntimeLabel(item: ProgressItem, nowMs: number): string | null {
  const runtimeMs = getLiveRuntimeMs(item.runtimeMs, item.runtimeStartedAt, nowMs);
  if (runtimeMs <= 0) {
    return null;
  }

  const isBatchRuntime = item.runtimeScope === 'batch';
  if (item.status === 'processing') {
    return `${isBatchRuntime ? '本批运行时间' : '运行时间'} ${formatRuntime(runtimeMs)}`;
  }

  return `${isBatchRuntime ? '本批用时' : '用时'} ${formatRuntime(runtimeMs)}`;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function formatItemRuntimeLabelLegacy(item: ProgressItem, nowMs: number): string | null {
  const runtimeMs = getLiveRuntimeMs(item.runtimeMs, item.runtimeStartedAt, nowMs);
  if (runtimeMs <= 0) {
    return null;
  }

  return `${item.status === 'processing' ? '运行时间' : '用时'} ${formatRuntime(runtimeMs)}`;
}

function StatusIcon({ status }: { status: ChunkStatus }) {
  switch (status) {
    case 'processing':
      return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
    case 'success':
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case 'error':
      return <XCircle className="h-4 w-4 text-red-500" />;
    case 'skipped':
      return <SkipForward className="h-4 w-4 text-amber-500" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function stageLabel(stage: PipelineStage): string {
  if (stage === 'idle') {
    return '空闲';
  }

  const labels: Record<RequestStage, string> = {
    'analyze-pages': '逐页分析',
    'synthesize-chunks': '分块综合',
    'synthesize-story': '整书综合',
    'write-sections': '章节写作',
    'polish-novel': '全书润色',
  };

  return labels[stage];
}

function getDisplayStage(taskState: TaskState): RequestStage {
  if (taskState.currentStage !== 'idle') {
    return taskState.currentStage;
  }

  return 'analyze-pages';
}

function formatPageRange(pageNumbers: number[]): string {
  if (pageNumbers.length === 0) {
    return '无页码';
  }

  const sorted = [...pageNumbers].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return first === last ? `第 ${first} 页` : `第 ${first}-${last} 页`;
}

function extractPreview(text: string | undefined, maxLength = 180): string {
  const normalized = String(text || '').trim().replace(/\n{3,}/g, '\n\n');
  if (!normalized) {
    return '暂无';
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trim()}...`
    : normalized;
}

function joinValues(values: Array<string | undefined>, fallback = '无'): string {
  const normalized = values.map((value) => String(value || '').trim()).filter(Boolean);
  return normalized.length > 0 ? normalized.join(' / ') : fallback;
}

function buildChunkPreview(
  chunk: TaskState['chunkSyntheses'][number],
  splitDraftMode: boolean
): string {
  const primaryLine = chunk.summary?.trim()
    ? `摘要：${chunk.summary}`
    : chunk.draftText?.trim()
      ? `草稿片段：${extractPreview(chunk.draftText, splitDraftMode ? 90 : 140)}`
      : '';
  const previewLines = [
    primaryLine,
    chunk.keyDevelopments.length > 0 ? `推进：${joinValues(chunk.keyDevelopments)}` : '',
    chunk.dialogueResolutions.length > 0 ? `对白修正：${chunk.dialogueResolutions.length} 条` : '',
    chunk.continuitySummary?.trim() ? `承接：${chunk.continuitySummary}` : '',
  ].filter(Boolean);

  if (previewLines.length > 0) {
    return previewLines.slice(0, splitDraftMode ? 2 : 3).join('\n');
  }

  switch (chunk.status) {
    case 'processing':
      return '这一部分正在生成中，完成后会在这里显示摘要。';
    case 'error':
      return '这一部分生成失败，可点“详情”查看原因。';
    case 'success':
      return '这一部分已生成，可点“详情”查看内容。';
    default:
      return splitDraftMode
        ? '这一部分开始生成后，会在这里显示摘要。'
        : '等待生成后显示摘要。';
  }
}

function buildDialogueLineText(
  speaker: string,
  text: string,
  marker = ''
): string {
  return `${speaker}${marker}：${text}`;
}

function buildResolutionDetail(
  chunk: TaskState['chunkSyntheses'][number]
): string {
  if (chunk.dialogueResolutions.length === 0) {
    return '无';
  }

  return chunk.dialogueResolutions.map((resolution) => {
    const evidence = resolution.speakerEvidence?.trim()
      ? `（依据：${resolution.speakerEvidence.trim()}）`
      : '';
    return `第 ${resolution.pageNumber} 页 #${resolution.lineIndex} ${buildDialogueLineText(
      resolution.speaker,
      resolution.text
    )}${evidence}`;
  }).join('\n');
}

function buildPageItem(taskState: TaskState): ProgressItem[] {
  const dialogueResolutionMap = createDialogueResolutionMap(taskState.chunkSyntheses);
  const batchSizeByIndex = taskState.pageAnalyses.reduce<Map<number, number>>((result, page) => {
    result.set(page.analysisBatchIndex, (result.get(page.analysisBatchIndex) || 0) + 1);
    return result;
  }, new Map());

  return taskState.pageAnalyses.map((page) => {
    const resolvedDialogue = applyDialogueResolutionMap(
      page.pageNumber,
      page.dialogue,
      dialogueResolutionMap
    );
    const correctedLineCount = resolvedDialogue.reduce((count, line, index) => (
      page.dialogue[index]?.speaker?.trim() !== line.speaker.trim()
        ? count + 1
        : count
    ), 0);

    return {
      key: `page-${page.index}`,
      stage: 'analyze-pages',
      itemIndex: page.index,
      batchIndex: page.analysisBatchIndex,
      runtimeScope: (batchSizeByIndex.get(page.analysisBatchIndex) || 0) > 1 ? 'batch' : 'item',
      label: `第 ${page.pageNumber} 页`,
      meta: [page.location, page.timeHint].filter(Boolean).join(' / ') || '等待提取场景信息',
      status: page.status,
      runtimeMs: page.runtimeMs,
      runtimeStartedAt: page.runtimeStartedAt,
      error: page.error,
      preview: [
        `摘要：${page.summary || '暂无'}`,
        `关键事件：${joinValues(page.keyEvents)}`,
        `角色：${joinValues(page.characters.map((character) => character.name))}`,
        correctedLineCount > 0 ? `对白修正：${correctedLineCount} 条` : '',
      ].join('\n'),
      detail: [
        `页码：第 ${page.pageNumber} 页`,
        `摘要：${page.summary || '暂无'}`,
        `地点：${page.location || '未知'}`,
        `时间：${page.timeHint || '未知'}`,
        `关键事件：${joinValues(page.keyEvents)}`,
        `对白：${resolvedDialogue.map((line, index) => {
          const originalSpeaker = page.dialogue[index]?.speaker?.trim() || '';
          const marker = originalSpeaker !== line.speaker.trim() ? '（修正）' : '';
          return buildDialogueLineText(line.speaker, line.text, marker);
        }).join('\n') || '无'}`,
        `画面文字：${page.visualText.join('\n') || '无'}`,
        correctedLineCount > 0 ? `已应用块级对白归属修正：${correctedLineCount} 条` : '',
        page.error ? `错误：${page.error}` : '',
      ].filter(Boolean).join('\n\n'),
    };
  });
}

function buildChunkItems(taskState: TaskState): ProgressItem[] {
  return taskState.chunkSyntheses.map((chunk) => {
    const label = chunk.title || (isSplitDraftMode(taskState) ? `第 ${chunk.index + 1} 部分` : `第 ${chunk.index + 1} 块`);
    return {
      key: `chunk-${chunk.index}`,
      stage: 'synthesize-chunks',
      itemIndex: chunk.index,
      label,
      meta: `${formatPageRange(chunk.pageNumbers)} · ${chunk.pageNumbers.length} 页`,
      status: chunk.status,
      runtimeMs: chunk.runtimeMs,
      runtimeStartedAt: chunk.runtimeStartedAt,
      error: chunk.error,
      preview: buildChunkPreview(chunk, isSplitDraftMode(taskState)),
      detail: [
        `范围：${formatPageRange(chunk.pageNumbers)}`,
        `摘要：${chunk.summary || '暂无'}`,
        chunk.draftText ? `分段草稿：\n${chunk.draftText}` : '',
        `推进：${joinValues(chunk.keyDevelopments)}`,
        `对白归属修正：${buildResolutionDetail(chunk)}`,
        `承接：${chunk.continuitySummary || '暂无'}`,
        chunk.error ? `错误：${chunk.error}` : '',
      ].filter(Boolean).join('\n\n'),
    };
  });
}

function buildStoryItem(taskState: TaskState): ProgressItem[] {
  const splitDraftMode = isSplitDraftMode(taskState);
  const sceneCount = taskState.globalSynthesis.sceneOutline.length;
  const outlineDetail = taskState.globalSynthesis.sceneOutline.map((scene) => {
    const scopeLabel = splitDraftMode
      ? ''
      : `（分块 ${scene.chunkIndexes.map((index) => index + 1).join(' / ')}）`;
    return `\n- ${scene.title}${scopeLabel}`;
  }).join('');

  return [{
    key: 'story-synthesis',
    stage: 'synthesize-story',
    itemIndex: 0,
    label: '整书综合',
    meta: splitDraftMode
      ? `${taskState.pageAnalyses.length} 页逐页分析 / ${sceneCount} 个场景`
      : `${taskState.chunkSyntheses.length} 个分块 / ${sceneCount} 个场景`,
    status: taskState.globalSynthesis.status,
    runtimeMs: taskState.globalSynthesis.runtimeMs,
    runtimeStartedAt: taskState.globalSynthesis.runtimeStartedAt,
    error: taskState.globalSynthesis.error,
    preview: [
      `故事概览：${extractPreview(taskState.globalSynthesis.storyOverview, 220)}`,
      `人物关系：${extractPreview(taskState.globalSynthesis.characterGuide, 180)}`,
      `写作约束：${joinValues(taskState.globalSynthesis.writingConstraints)}`,
    ].join('\n'),
    detail: [
      `故事概览：${taskState.globalSynthesis.storyOverview || '暂无'}`,
      `世界说明：${taskState.globalSynthesis.worldGuide || '暂无'}`,
      `人物说明：${taskState.globalSynthesis.characterGuide || '暂无'}`,
      `场景大纲：${
        outlineDetail
        || '\n- 暂无'
      }`,
      `写作约束：${joinValues(taskState.globalSynthesis.writingConstraints)}`,
      taskState.globalSynthesis.error ? `错误：${taskState.globalSynthesis.error}` : '',
    ].filter(Boolean).join('\n\n'),
  }];
}

function buildSectionItems(taskState: TaskState): ProgressItem[] {
  const preparation: ProgressItem = {
    key: 'writing-preparation',
    stage: 'write-sections',
    itemIndex: -1,
    label: '写作前全书统稿',
    meta: taskState.writingPreparation.voiceGuide?.trim() ? '已生成写作前统稿指引' : '等待生成写作前统稿指引',
    status: taskState.writingPreparation.status,
    runtimeMs: taskState.writingPreparation.runtimeMs,
    runtimeStartedAt: taskState.writingPreparation.runtimeStartedAt,
    error: taskState.writingPreparation.error,
    preview: extractPreview(taskState.writingPreparation.voiceGuide, 240),
    detail: taskState.writingPreparation.voiceGuide || '暂无写作指引',
  };

  const sections = taskState.novelSections.map((section) => ({
    key: `section-${section.index}`,
    stage: 'write-sections' as const,
    itemIndex: section.index,
    label: section.title || `第 ${section.index + 1} 节`,
    meta: isSplitDraftMode(taskState)
      ? `关联 ${section.chunkIndexes.length} 个场景单元`
      : `关联 ${section.chunkIndexes.length} 个分块`,
    status: section.status,
    runtimeMs: section.runtimeMs,
    runtimeStartedAt: section.runtimeStartedAt,
    error: section.error,
    preview: [
      `正文：${extractPreview(section.markdownBody, 220)}`,
      section.continuitySummary ? `承接：${extractPreview(section.continuitySummary, 120)}` : '',
    ].filter(Boolean).join('\n'),
    detail: [
      section.markdownBody || '暂无正文',
      section.continuitySummary ? `承接摘要：${section.continuitySummary}` : '',
      section.error ? `错误：${section.error}` : '',
    ].filter(Boolean).join('\n\n'),
  }));

  return [preparation, ...sections];
}

function buildPolishItem(taskState: TaskState): ProgressItem[] {
  const body = taskState.finalPolish.markdownBody || '';
  return [{
    key: 'final-polish',
    stage: 'polish-novel',
    itemIndex: 0,
    label: '全书润色',
    meta: body.trim() ? '已生成润色结果' : '等待全书润色',
    status: taskState.finalPolish.status,
    runtimeMs: taskState.finalPolish.runtimeMs,
    runtimeStartedAt: taskState.finalPolish.runtimeStartedAt,
    error: taskState.finalPolish.error,
    preview: extractPreview(body, 280),
    detail: [
      body || '暂无润色正文',
      taskState.finalPolish.error ? `错误：${taskState.finalPolish.error}` : '',
    ].filter(Boolean).join('\n\n'),
  }];
}

function buildStageItems(taskState: TaskState, stage: RequestStage): ProgressItem[] {
  switch (stage) {
    case 'analyze-pages':
      return buildPageItem(taskState);
    case 'synthesize-chunks':
      if (isSplitDraftMode(taskState)) {
        return [];
      }
      return buildChunkItems(taskState);
    case 'synthesize-story':
      return buildStoryItem(taskState);
    case 'write-sections':
      return buildSectionItems(taskState);
    case 'polish-novel':
      return buildPolishItem(taskState);
    default:
      return [];
  }
}

function buildEditablePayload(taskState: TaskState, item: ProgressItem): unknown {
  switch (item.stage) {
    case 'analyze-pages': {
      const page = taskState.pageAnalyses[item.itemIndex];
      return page
        ? {
            summary: page.summary || '',
            location: page.location || '未知',
            timeHint: page.timeHint || '未知',
            keyEvents: [...page.keyEvents],
            dialogue: page.dialogue.map((line) => ({ ...line })),
            narrationText: [...page.narrationText],
            visualText: [...page.visualText],
            characters: page.characters.map((character) => ({
              ...character,
              traits: [...character.traits],
              relationshipHints: [...character.relationshipHints],
              evidence: [...character.evidence],
            })),
          }
        : {};
    }
    case 'synthesize-chunks': {
      const chunk = taskState.chunkSyntheses[item.itemIndex];
      return chunk
        ? {
            title: chunk.title || '',
            summary: chunk.summary || '',
            draftText: chunk.draftText || '',
            keyDevelopments: [...chunk.keyDevelopments],
            dialogueResolutions: chunk.dialogueResolutions.map((resolution) => ({ ...resolution })),
            continuitySummary: chunk.continuitySummary || '',
          }
        : {};
    }
    case 'synthesize-story':
      return {
        storyOverview: taskState.globalSynthesis.storyOverview || '',
        worldGuide: taskState.globalSynthesis.worldGuide || '',
        characterGuide: taskState.globalSynthesis.characterGuide || '',
        sceneOutline: taskState.globalSynthesis.sceneOutline.map((scene) => ({
          ...scene,
          chunkIndexes: [...scene.chunkIndexes],
        })),
        writingConstraints: [...taskState.globalSynthesis.writingConstraints],
      };
    case 'write-sections':
      if (item.itemIndex < 0) {
        return {
          voiceGuide: taskState.writingPreparation.voiceGuide || '',
        };
      }

      return taskState.novelSections[item.itemIndex]
        ? {
            title: taskState.novelSections[item.itemIndex].title || '',
            markdownBody: taskState.novelSections[item.itemIndex].markdownBody || '',
            continuitySummary: taskState.novelSections[item.itemIndex].continuitySummary || '',
          }
        : {};
    case 'polish-novel':
      return {
        markdownBody: taskState.finalPolish.markdownBody || '',
        voiceGuide: taskState.finalPolish.voiceGuide || '',
      };
    default:
      return {};
  }
}

function getEditDescription(item: ProgressItem): string {
  switch (item.stage) {
    case 'analyze-pages':
      return '修改这页的识别结果。保持 JSON 结构，只改需要的字段即可。';
    case 'synthesize-chunks':
      return '修改这一块的综合结果。保存后会刷新整书综合及后续阶段。';
    case 'synthesize-story':
      return '修改整书综合。若 sceneOutline 有变化，写作前统稿与后续章节会按新大纲重新刷新。';
    case 'write-sections':
      return item.itemIndex < 0
        ? '修改写作前统稿。保存后后续章节会标记为待刷新。'
        : '修改章节内容。保存后后续章节与终稿会重新衔接。';
    case 'polish-novel':
      return '修改最终润色稿。保存后会直接更新右侧预览。';
    default:
      return '修改当前内容。';
  }
}

function buildStageCards(taskState: TaskState): StageCard[] {
  const splitDraftMode = isSplitDraftMode(taskState);
  const expectedSectionCount = taskState.novelSections.length > 0
    ? taskState.novelSections.length
    : (splitDraftMode ? taskState.chunkSyntheses.length : 0);
  const cards: StageCard[] = [];

  cards.push({
    stage: 'analyze-pages',
    title: '逐页分析',
    value: `${countCompleted(taskState.pageAnalyses)} / ${taskState.pageAnalyses.length}`,
    hint: splitDraftMode ? '整书综合会直接使用这些逐页结果' : '查看每页识别结果',
  });

  if (!splitDraftMode) {
    cards.push({
      stage: 'synthesize-chunks',
      title: '分块综合',
      value: `${countCompleted(taskState.chunkSyntheses)} / ${taskState.chunkSyntheses.length}`,
      hint: '查看每一块的综合结果',
    });
  }

  cards.push({
    stage: 'synthesize-story',
    title: '整书综合',
    value: statusLabel(taskState.globalSynthesis.status),
    secondary: taskState.globalSynthesis.sceneOutline.length > 0
      ? `已生成 ${taskState.globalSynthesis.sceneOutline.length} 个场景`
      : undefined,
    hint: splitDraftMode ? '基于逐页分析直接做整书综合' : '查看全书故事综合',
  });

  cards.push({
    stage: 'write-sections',
    title: '章节写作',
    value: `${countCompleted(taskState.novelSections)} / ${expectedSectionCount}`,
    secondary: taskState.writingPreparation.voiceGuide?.trim() ? '写作前全书统稿已完成' : undefined,
    hint: '查看各章节正文',
  });

  if (taskState.config.enableFinalPolish) {
    cards.push({
      stage: 'polish-novel',
      title: '全书润色',
      value: statusLabel(taskState.finalPolish.status),
      hint: '查看润色结果',
    });
  }

  return cards;
}

function canRegenerate(
  item: ProgressItem | null,
  taskState: TaskState,
  onRegenerateItem?: (stage: RequestStage, itemIndex: number) => Promise<void>
): item is ProgressItem {
  const isReplayablePreparation = item?.stage === 'write-sections' && item.itemIndex === -1;

  return Boolean(
    item
    && (item.itemIndex >= 0 || isReplayablePreparation)
    && item.status !== 'processing'
    && taskState.status !== 'running'
    && taskState.status !== 'preparing'
    && onRegenerateItem
  );
}

function getRegenerateActionLabel(item: ProgressItem): string {
  if (item.stage === 'write-sections' && item.itemIndex === -1 && item.status === 'pending') {
    return '开始';
  }

  return '重跑';
}

function canEditItem(
  item: ProgressItem | null,
  taskState: TaskState,
  onUpdateItem?: (stage: RequestStage, itemIndex: number, value: unknown) => Promise<void>
): item is ProgressItem {
  return Boolean(
    item
    && item.status !== 'processing'
    && taskState.status !== 'running'
    && taskState.status !== 'preparing'
    && onUpdateItem
  );
}

export function ProgressPanel({ taskState, onRegenerateItem, onUpdateItem }: ProgressPanelProps) {
  const [selectedStage, setSelectedStage] = useState<RequestStage | null>(null);
  const [selectedItem, setSelectedItem] = useState<ProgressItem | null>(null);
  const [editingItem, setEditingItem] = useState<ProgressItem | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [regeneratingKey, setRegeneratingKey] = useState<string | null>(null);
  const [anchoredItemKey, setAnchoredItemKey] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingRestoreScrollTopRef = useRef<number | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const stageCards = useMemo(() => buildStageCards(taskState), [taskState]);
  const availableStages = useMemo(() => stageCards.map((card) => card.stage), [stageCards]);

  useEffect(() => {
    if (!selectedStage || !availableStages.includes(selectedStage)) {
      setSelectedStage(getDisplayStage(taskState));
    }
  }, [availableStages, selectedStage, taskState]);

  useEffect(() => {
    if (!hasAnyItemRuntimeInProgress(taskState)) {
      return;
    }

    setNowMs(Date.now());
    const timerId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [taskState]);

  const displayStage = selectedStage || getDisplayStage(taskState);
  const activeStageItems = useMemo(() => (
    taskState.currentStage === 'idle' ? [] : buildStageItems(taskState, taskState.currentStage)
  ), [taskState]);
  const items = useMemo(() => buildStageItems(taskState, displayStage), [displayStage, taskState]);
  const useCompactChunkCards = isSplitDraftMode(taskState) && displayStage === 'synthesize-chunks';
  const useDenseListLayout = useCompactChunkCards || items.length > 1;
  const activeRuntimeItem = activeStageItems.find((item) => item.status === 'processing') || null;
  const primaryProcessingPageKeys = useMemo(() => {
    const keys = new Set<string>();
    const seenBatchIndexes = new Set<number>();

    taskState.pageAnalyses.forEach((page) => {
      if (page.status !== 'processing' || seenBatchIndexes.has(page.analysisBatchIndex)) {
        return;
      }

      seenBatchIndexes.add(page.analysisBatchIndex);
      keys.add(`page-${page.index}`);
    });

    return keys;
  }, [taskState.pageAnalyses]);
  const activeRuntimeDescriptor = useMemo(() => {
    if (taskState.currentStage === 'analyze-pages') {
      const processingPages = taskState.pageAnalyses.filter((page) => page.status === 'processing');
      if (processingPages.length > 0) {
        const processingBatches = Array.from(
          processingPages.reduce<Map<number, typeof processingPages>>((result, page) => {
            const existingPages = result.get(page.analysisBatchIndex);
            if (existingPages) {
              existingPages.push(page);
            } else {
              result.set(page.analysisBatchIndex, [page]);
            }
            return result;
          }, new Map()).entries()
        ).sort(([leftBatchIndex, leftPages], [rightBatchIndex, rightPages]) => {
          const leftStartedAtMs = Date.parse(leftPages[0]?.runtimeStartedAt || '');
          const rightStartedAtMs = Date.parse(rightPages[0]?.runtimeStartedAt || '');
          const hasLeftStartedAt = Number.isFinite(leftStartedAtMs);
          const hasRightStartedAt = Number.isFinite(rightStartedAtMs);

          if (hasLeftStartedAt && hasRightStartedAt && leftStartedAtMs !== rightStartedAtMs) {
            return leftStartedAtMs - rightStartedAtMs;
          }

          if (hasLeftStartedAt !== hasRightStartedAt) {
            return hasLeftStartedAt ? -1 : 1;
          }

          return leftBatchIndex - rightBatchIndex;
        });
        const batchPages = processingBatches[0]?.[1] || [];
        const primaryPage = batchPages[0];
        const firstPageNumber = batchPages[0]?.pageNumber ?? primaryPage?.pageNumber;
        const lastPageNumber = batchPages[batchPages.length - 1]?.pageNumber ?? primaryPage?.pageNumber;
        const runtimeLabel = primaryPage
          ? formatRuntime(getLiveRuntimeMs(primaryPage.runtimeMs, primaryPage.runtimeStartedAt, nowMs))
          : null;

        return {
          label: batchPages.length > 1
            ? `当前批次：第 ${firstPageNumber}-${lastPageNumber} 页`
            : primaryPage
              ? `当前页：第 ${primaryPage.pageNumber} 页`
              : '当前项',
          runtimeLabel,
        };
      }
    }

    return activeRuntimeItem
      ? {
          label: `当前项：${activeRuntimeItem.label}`,
          runtimeLabel: formatRuntime(getLiveRuntimeMs(activeRuntimeItem.runtimeMs, activeRuntimeItem.runtimeStartedAt, nowMs)),
        }
      : null;
  }, [activeRuntimeItem, nowMs, taskState.currentStage, taskState.pageAnalyses]);

  const includeChunkStage = !isSplitDraftMode(taskState);
  const totalUnits = taskState.pageAnalyses.length
    + (includeChunkStage ? taskState.chunkSyntheses.length : 0)
    + 1
    + (taskState.novelSections.length > 0 ? 1 : 0)
    + taskState.novelSections.length
    + (taskState.config.enableFinalPolish ? 1 : 0);
  const completedUnits = countCompleted(taskState.pageAnalyses)
    + (includeChunkStage ? countCompleted(taskState.chunkSyntheses) : 0)
    + (isCompletedStatus(taskState.globalSynthesis.status, taskState.globalSynthesis.error) ? 1 : 0)
    + (
      taskState.novelSections.length > 0
      && isCompletedStatus(taskState.writingPreparation.status, taskState.writingPreparation.error)
        ? 1
        : 0
    )
    + countCompleted(taskState.novelSections)
    + (
      taskState.config.enableFinalPolish
      && isCompletedStatus(taskState.finalPolish.status, taskState.finalPolish.error)
        ? 1
        : 0
    );
  const progress = totalUnits > 0 ? (completedUnits / totalUnits) * 100 : 0;

  const currentErrorItem = items.find((item) => item.status === 'error' && item.error);
  const currentErrorAdvice = currentErrorItem?.error ? getTroubleshootingAdvice(currentErrorItem.error) : null;

  useEffect(() => {
    if (!anchoredItemKey) {
      return;
    }

    if (!items.some((item) => item.key === anchoredItemKey)) {
      setAnchoredItemKey(null);
    }
  }, [anchoredItemKey, items]);

  useEffect(() => {
    if (pendingRestoreScrollTopRef.current === null) {
      return;
    }

    const nextScrollTop = pendingRestoreScrollTopRef.current;
    const restoreId = window.requestAnimationFrame(() => {
      if (listScrollRef.current && nextScrollTop !== null) {
        listScrollRef.current.scrollTop = nextScrollTop;
      }
      pendingRestoreScrollTopRef.current = null;
    });

    return () => window.cancelAnimationFrame(restoreId);
  }, [items, regeneratingKey]);

  useEffect(() => {
    if (!anchoredItemKey || regeneratingKey) {
      return;
    }

    const target = itemRefs.current[anchoredItemKey];
    if (!target) {
      return;
    }

    const scrollId = window.requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'nearest' });
    });

    return () => window.cancelAnimationFrame(scrollId);
  }, [anchoredItemKey, items, regeneratingKey]);

  const handleRegenerate = async (item: ProgressItem) => {
    if (!onRegenerateItem) {
      return;
    }

    pendingRestoreScrollTopRef.current = listScrollRef.current?.scrollTop ?? null;
    setAnchoredItemKey(item.key);
    setRegeneratingKey(item.key);
    try {
      await onRegenerateItem(item.stage, item.itemIndex);
      setSelectedItem(null);
    } finally {
      setRegeneratingKey(null);
    }
  };

  const handleStartEdit = (item: ProgressItem) => {
    setEditingItem(item);
    setEditDraft(JSON.stringify(buildEditablePayload(taskState, item), null, 2));
    setEditError(null);
  };

  const handleSaveEdit = async () => {
    if (!editingItem || !onUpdateItem) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(editDraft);
    } catch {
      setEditError('请输入合法的 JSON。');
      return;
    }

    setSavingEdit(true);
    setEditError(null);
    try {
      await onUpdateItem(editingItem.stage, editingItem.itemIndex, parsed);
      setEditingItem(null);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : '保存失败，请稍后再试。');
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <Card>
      <CardHeader className="space-y-2.5 pb-4">
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">处理进度</CardTitle>
          <Badge variant={taskState.status === 'completed' ? 'default' : 'outline'}>
            {taskState.status === 'completed' ? '全部完成' : stageLabel(taskState.currentStage)}
          </Badge>
        </div>
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground sm:text-sm">
            <span>{Math.round(progress)}%</span>
            <span
              className="max-w-[15rem] truncate text-center sm:max-w-[20rem]"
              title={activeRuntimeDescriptor ? `${activeRuntimeDescriptor.label} · ${activeRuntimeDescriptor.runtimeLabel || '--'}` : '当前没有正在处理的条目'}
            >
              {activeRuntimeDescriptor ? `${activeRuntimeDescriptor.label} · ${activeRuntimeDescriptor.runtimeLabel || '--'}` : '当前项用时 --'}
            </span>
            <span>{completedUnits} / {totalUnits || 0}</span>
          </div>
          <Progress value={progress} />
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {currentErrorItem ? (
          <div className="rounded-lg border border-red-200 bg-red-50/70 p-2.5 text-sm">
            <div className="min-w-0 [overflow-wrap:anywhere] font-medium text-red-700">{currentErrorItem.label}</div>
            <div className="mt-1.5 whitespace-pre-wrap text-red-700 [overflow-wrap:anywhere]">{currentErrorItem.error}</div>
            {currentErrorAdvice ? (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-amber-900">
                <div className="font-medium">{currentErrorAdvice.title}</div>
                <div className="mt-1 text-sm [overflow-wrap:anywhere]">{currentErrorAdvice.summary}</div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-2.5 md:grid-cols-2 2xl:grid-cols-4">
          {stageCards.map((card) => (
            <button
              key={card.stage}
              type="button"
              className={`rounded-lg border p-2.5 text-left transition ${
                displayStage === card.stage
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-background hover:bg-muted/30'
              }`}
              onClick={() => setSelectedStage(card.stage)}
            >
              <div className="text-sm font-medium">{card.title}</div>
              <div className="mt-0.5 text-base font-semibold">{card.value}</div>
              {card.secondary ? (
                <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{card.secondary}</div>
              ) : null}
              <div className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{card.hint}</div>
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-lg border">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div>
              <div className="text-sm font-medium">{stageLabel(displayStage)}</div>
              <div className="text-[11px] leading-4 text-muted-foreground">
                {isSplitDraftMode(taskState) && displayStage === 'analyze-pages'
                  ? '这些逐页结果会直接进入整书综合，跳过分块综合'
                  : '点击条目可查看详情'}
              </div>
            </div>
          </div>
          <div
            ref={listScrollRef}
            className="max-h-[min(460px,calc(100vh-19rem))] overflow-y-auto overscroll-contain"
          >
            <div className={useDenseListLayout ? 'space-y-2 p-2.5' : 'space-y-2.5 p-3'}>
              {items.length === 0 ? (
                <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-center text-sm text-muted-foreground">
                  当前阶段还没有可展示的内容。
                </div>
              ) : items.map((item) => (
                <div
                  key={item.key}
                  ref={(node) => {
                    itemRefs.current[item.key] = node;
                  }}
                  className={
                    useDenseListLayout
                      ? `rounded-lg border p-2.5 ${anchoredItemKey === item.key ? 'border-primary bg-primary/5' : ''}`
                      : `rounded-xl border p-3 ${anchoredItemKey === item.key ? 'border-primary bg-primary/5' : ''}`
                  }
                >
                  <div className={useDenseListLayout ? 'flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between' : 'flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between'}>
                    <div className={useDenseListLayout ? 'min-w-0 flex-1 space-y-0.5' : 'min-w-0 flex-1 space-y-1'}>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusIcon status={item.status} />
                        <span className="font-medium">{item.label}</span>
                        <Badge variant="outline">{statusLabel(item.status)}</Badge>
                      </div>
                      <div className="text-[11px] leading-4 text-muted-foreground [overflow-wrap:anywhere]">{item.meta}</div>
                      {(item.stage !== 'analyze-pages' || item.status !== 'processing' || primaryProcessingPageKeys.has(item.key)) && formatItemRuntimeLabel(item, nowMs) ? (
                        <div className="text-[11px] leading-4 text-muted-foreground [overflow-wrap:anywhere]">
                          {formatItemRuntimeLabel(item, nowMs)}
                        </div>
                      ) : null}
                      <div
                        className={useDenseListLayout
                          ? 'max-h-11 overflow-hidden whitespace-pre-wrap text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]'
                          : 'whitespace-pre-wrap text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]'}
                      >
                        {item.preview}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2.5"
                        onClick={() => setSelectedItem(item)}
                      >
                        <Eye className="mr-1 h-3.5 w-3.5" />
                        详情
                      </Button>
                      {canEditItem(item, taskState, onUpdateItem) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-2.5"
                          onClick={() => handleStartEdit(item)}
                        >
                          <Pencil className="mr-1 h-3.5 w-3.5" />
                          修改
                        </Button>
                      ) : null}
                      {canRegenerate(item, taskState, onRegenerateItem) ? (
                        <Button
                          size="sm"
                        variant="outline"
                        className="h-8 px-2.5"
                        onClick={() => handleRegenerate(item)}
                        disabled={regeneratingKey === item.key}
                        title={getRegenerateActionLabel(item)}
                      >
                          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${regeneratingKey === item.key ? 'animate-spin' : ''}`} />
                          重跑
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {item.error ? (
                    <>
                      <Separator className="my-2" />
                      <div className="text-xs leading-5 text-red-600 whitespace-pre-wrap [overflow-wrap:anywhere]">{item.error}</div>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>

      <Dialog
        open={Boolean(editingItem)}
        onOpenChange={(open) => {
          if (!open && !savingEdit) {
            setEditingItem(null);
            setEditError(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden">
          {editingItem ? (
            <>
              <DialogHeader>
                <DialogTitle>{editingItem.label} · 修改</DialogTitle>
                <div className="text-xs leading-5 text-muted-foreground">
                  {getEditDescription(editingItem)}
                </div>
              </DialogHeader>
              <div className="flex min-h-0 flex-col gap-3">
                <Textarea
                  value={editDraft}
                  onChange={(event) => {
                    setEditDraft(event.target.value);
                    if (editError) {
                      setEditError(null);
                    }
                  }}
                  spellCheck={false}
                  className="h-[65vh] min-h-[18rem] max-h-[38rem] resize-y overflow-y-auto font-mono text-xs leading-6 [field-sizing:fixed]"
                />
                <div className="text-[11px] leading-5 text-muted-foreground">
                  保存时会校验 JSON，并把修改写回当前阶段；缺失字段会沿用原值。
                </div>
                {editError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {editError}
                  </div>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditingItem(null);
                      setEditError(null);
                    }}
                    disabled={savingEdit}
                  >
                    取消
                  </Button>
                  <Button type="button" onClick={handleSaveEdit} disabled={savingEdit}>
                    {savingEdit ? '保存中...' : '保存修改'}
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedItem)} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="max-w-3xl">
          {selectedItem ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" onClick={() => setSelectedItem(null)}>
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <div>
                    <DialogTitle>{selectedItem.label}</DialogTitle>
                    <div className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{selectedItem.meta}</div>
                  </div>
                </div>
              </DialogHeader>
              <ScrollArea className="max-h-[65vh] pr-4">
                <div className="whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">{selectedItem.detail}</div>
              </ScrollArea>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
