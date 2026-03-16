'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  Layers,
  Loader2,
  SkipForward,
  TimerReset,
  XCircle,
} from 'lucide-react';
import { getTroubleshootingAdvice } from '@/lib/error-hints';
import type { ChunkStatus, PageAnalysis, PipelineStage, RequestStage, TaskState } from '@/lib/types';

interface ProgressPanelProps {
  taskState: TaskState;
  onRegenerateItem?: (stage: RequestStage, itemIndex: number) => Promise<void>;
}

type ActiveItem = {
  key: string;
  stage: RequestStage;
  itemIndex: number;
  label: string;
  meta: string;
  status: ChunkStatus;
  error?: string;
  detailTitle: string;
  detailContent: string;
  previewContent: string;
};

type StagePreview = {
  stage: RequestStage;
  title: string;
  description: string;
  emptyText: string;
  items: ActiveItem[];
};

type StatusPresentation = {
  compactLabel: string;
  secondaryLabel?: string;
};

function ChunkStatusIcon({ status }: { status: ChunkStatus }) {
  switch (status) {
    case 'success':
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case 'error':
      return <XCircle className="h-4 w-4 text-red-500" />;
    case 'processing':
      return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
    case 'skipped':
      return <SkipForward className="h-4 w-4 text-yellow-500" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function statusLabel(
  status: ChunkStatus,
  options?: {
    stage?: RequestStage;
    hasFallbackContent?: boolean;
  }
): string {
  const labels: Record<ChunkStatus, string> = {
    pending: '等待',
    processing: '处理中',
    success: '完成',
    error: '失败',
    skipped: '已跳过',
  };

  if (
    status === 'skipped'
    && (
      options?.hasFallbackContent
      || options?.stage === 'synthesize-chunks'
      || options?.stage === 'synthesize-story'
    )
  ) {
    return '已跳过（兜底综合）';
  }

  return labels[status];
}

function buildSkippedFallbackNotice(stage: RequestStage): string | null {
  switch (stage) {
    case 'synthesize-chunks':
      return '说明：当前内容来自跳过后的兜底分块综合，不是本阶段模型成功返回。';
    case 'synthesize-story':
      return '说明：当前内容来自跳过后的兜底整书综合，不是本阶段模型成功返回。';
    case 'polish-novel':
      return '说明：当前全书统稿阶段被跳过，因此导出内容仍然是章节写作完成后的拼接正文。';
    default:
      return null;
  }
}

function buildDualStateNotice(stage: RequestStage): string | null {
  switch (stage) {
    case 'synthesize-chunks':
      return '双状态：本阶段失败；流程已改用兜底分块综合继续。当前内容不是本阶段模型成功返回。';
    case 'synthesize-story':
      return '双状态：本阶段失败；流程已改用兜底整书综合继续。当前内容不是本阶段模型成功返回。';
    case 'polish-novel':
      return '双状态：本阶段已跳过；当前正文沿用章节写作结果。当前内容不是全书统稿模型输出。';
    default:
      return null;
  }
}

function getStatusPresentation(
  status: ChunkStatus,
  options?: {
    stage?: RequestStage;
    hasFallbackContent?: boolean;
  }
): StatusPresentation {
  const compactLabel = status === 'skipped' ? '已跳过' : statusLabel(status, options);

  if (status !== 'skipped') {
    return { compactLabel };
  }

  if (options?.stage === 'synthesize-chunks') {
    return {
      compactLabel,
      secondaryLabel: '本阶段失败，已用兜底分块综合继续',
    };
  }

  if (options?.stage === 'synthesize-story' || options?.hasFallbackContent) {
    return {
      compactLabel,
      secondaryLabel: '本阶段失败，已用兜底整书综合继续',
    };
  }

  if (options?.stage === 'polish-novel') {
    return {
      compactLabel,
      secondaryLabel: '本阶段已跳过，当前正文沿用章节写作结果',
    };
  }

  return { compactLabel };
}

function stageLabel(stage: PipelineStage): string {
  const labels: Record<PipelineStage, string> = {
    idle: '空闲',
    'analyze-pages': '逐页分析',
    'synthesize-chunks': '分块综合',
    'synthesize-story': '整书综合',
    'write-sections': '章节写作',
    'polish-novel': '全书统稿',
  };
  return labels[stage];
}

function countCompleted(items: Array<{ status: ChunkStatus }>): number {
  return items.filter((item) => item.status === 'success' || item.status === 'skipped').length;
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function joinValues(values: Array<string | undefined>, fallback = '无'): string {
  const filtered = values
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return filtered.length > 0 ? filtered.join('、') : fallback;
}

function extractPreview(text: string | undefined, maxLength = 180): string {
  const normalized = String(text || '')
    .trim()
    .replace(/\n{3,}/g, '\n\n');

  if (!normalized) {
    return '暂无';
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trim()}...`
    : normalized;
}

function speakerConfidenceLabel(confidence?: 'high' | 'medium' | 'low'): string {
  const labels = {
    high: '高',
    medium: '中',
    low: '低',
  } as const;

  return confidence ? labels[confidence] : '未标注';
}

function formatPageRange(pageNumbers: number[]): string {
  if (pageNumbers.length === 0) {
    return '暂无页码';
  }

  const sorted = [...pageNumbers].sort((left, right) => left - right);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  return first === last ? `第 ${first} 页` : `第 ${first}-${last} 页`;
}

function buildPageMeta(page: PageAnalysis): string {
  const parts = [page.location, page.timeHint].filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : '尚未提取场景信息';
}

function buildPagePreview(page: PageAnalysis): string {
  const dialoguePreview = page.dialogue
    .slice(0, 2)
    .map((line) => `${line.speaker}：${line.text}`)
    .join('\n');

  return [
    `摘要：${page.summary || '暂无'}`,
    `关键事件：${joinValues(page.keyEvents, '无')}`,
    `角色：${joinValues(page.characters.map((character) => character.name), '无')}`,
    dialoguePreview ? `对白预览：\n${dialoguePreview}` : '对白预览：无',
  ].join('\n\n');
}

function buildPageDetail(page: PageAnalysis): string {
  const characterLines = page.characters.length > 0
    ? page.characters.map((character) => (
        [
          `- ${character.name}（${character.role || '作用未明'}）`,
          `  特征：${joinValues(character.traits, '无')}`,
          `  关系线索：${joinValues(character.relationshipHints, '无')}`,
          `  证据：${joinValues(character.evidence, '无')}`,
        ].join('\n')
      )).join('\n')
    : '无';
  const dialogueLines = page.dialogue.length > 0
    ? page.dialogue.map((line) => (
        [
          `- ${line.speaker}：${line.text}`,
          line.speakerEvidence ? `  归属证据：${line.speakerEvidence}` : '',
          `  置信度：${speakerConfidenceLabel(line.speakerConfidence)}`,
        ].filter(Boolean).join('\n')
      )).join('\n')
    : '无';
  const narrationLines = page.narrationText.length > 0 ? page.narrationText.join('\n') : '无';
  const visualTextLines = page.visualText.length > 0 ? page.visualText.join('\n') : '无';

  return [
    `摘要：${page.summary || '暂无'}`,
    `地点：${page.location || '未知'}`,
    `时间：${page.timeHint || '未知'}`,
    `关键事件：${joinValues(page.keyEvents, '无')}`,
    `对白：\n${dialogueLines}`,
    `旁白/内心独白：\n${narrationLines}`,
    `画面文字：\n${visualTextLines}`,
    `角色：\n${characterLines}`,
    page.error ? `错误：${page.error}` : '',
  ].filter(Boolean).join('\n\n');
}

function buildChunkPreview(chunk: TaskState['chunkSyntheses'][number]): string {
  const skippedNotice = chunk.status === 'skipped'
    ? buildDualStateNotice('synthesize-chunks')
    : null;

  return [
    skippedNotice,
    `摘要：${chunk.summary || '暂无'}`,
    `情节推进：${joinValues(chunk.keyDevelopments, '无')}`,
    `承接摘要：${chunk.continuitySummary || '暂无'}`,
  ].filter(Boolean).join('\n\n');
}

function buildChunkDetail(chunk: TaskState['chunkSyntheses'][number]): string {
  const skippedNotice = chunk.status === 'skipped'
    ? buildDualStateNotice('synthesize-chunks')
    : null;

  return [
    skippedNotice,
    `页码范围：${formatPageRange(chunk.pageNumbers)}`,
    `摘要：${chunk.summary || '暂无'}`,
    `情节推进：${joinValues(chunk.keyDevelopments, '无')}`,
    `承接摘要：${chunk.continuitySummary || '暂无'}`,
    chunk.error ? `错误：${chunk.error}` : '',
  ].filter(Boolean).join('\n\n');
}

function buildStoryPreview(taskState: TaskState): string {
  const scenePreview = taskState.globalSynthesis.sceneOutline
    .slice(0, 3)
    .map((scene) => `- ${scene.title}（分块 ${scene.chunkIndexes.map((index) => index + 1).join('、')}）`)
    .join('\n');
  const skippedNotice = taskState.globalSynthesis.status === 'skipped'
    ? buildDualStateNotice('synthesize-story')
    : null;

  return [
    skippedNotice,
    `全书概览：${extractPreview(taskState.globalSynthesis.storyOverview, 220)}`,
    `人物关系：${extractPreview(taskState.globalSynthesis.characterGuide, 160)}`,
    scenePreview ? `场景预览：\n${scenePreview}` : '场景预览：暂无',
  ].filter(Boolean).join('\n\n');
}

function buildStoryDetail(taskState: TaskState): string {
  const sceneLines = taskState.globalSynthesis.sceneOutline.length > 0
    ? taskState.globalSynthesis.sceneOutline.map((scene) => (
        `- ${scene.title}（分块 ${scene.chunkIndexes.map((index) => index + 1).join('、')}）\n  ${scene.summary || '暂无摘要'}`
      )).join('\n')
    : '无';
  const skippedNotice = taskState.globalSynthesis.status === 'skipped'
    ? buildDualStateNotice('synthesize-story')
    : null;

  return [
    skippedNotice,
    `全书概览：${taskState.globalSynthesis.storyOverview || '暂无'}`,
    `世界说明：${taskState.globalSynthesis.worldGuide || '暂无'}`,
    `人物说明：${taskState.globalSynthesis.characterGuide || '暂无'}`,
    `sceneOutline 确认：${taskState.globalSynthesis.outlineConfirmed ? '已确认' : '待确认'}`,
    `场景大纲：\n${sceneLines}`,
    `写作约束：${joinValues(taskState.globalSynthesis.writingConstraints, '无')}`,
    taskState.globalSynthesis.error ? `错误：${taskState.globalSynthesis.error}` : '',
  ].filter(Boolean).join('\n\n');
}

function buildFinalPolishPreview(taskState: TaskState): string {
  const skippedNotice = taskState.finalPolish.status === 'skipped'
    ? buildDualStateNotice('polish-novel')
    : null;

  return [
    skippedNotice,
    `统稿正文：${extractPreview(taskState.finalPolish.markdownBody || taskState.fullNovel, 260)}`,
  ].filter(Boolean).join('\n\n');
}

function buildFinalPolishDetail(taskState: TaskState): string {
  const skippedNotice = taskState.finalPolish.status === 'skipped'
    ? buildDualStateNotice('polish-novel')
    : null;

  return [
    skippedNotice,
    taskState.finalPolish.markdownBody || taskState.fullNovel || '尚未生成统稿正文',
    taskState.finalPolish.error ? `错误：${taskState.finalPolish.error}` : '',
  ].filter(Boolean).join('\n\n');
}

function buildSectionPreview(section: TaskState['novelSections'][number]): string {
  return [
    `正文预览：${extractPreview(section.markdownBody, 220)}`,
    section.continuitySummary ? `承接摘要：${extractPreview(section.continuitySummary, 120)}` : '承接摘要：暂无',
  ].join('\n\n');
}

function buildSectionDetail(section: TaskState['novelSections'][number]): string {
  return [
    `关联分块：${section.chunkIndexes.length > 0 ? section.chunkIndexes.map((index) => index + 1).join('、') : '无'}`,
    section.markdownBody || '尚未生成正文',
    section.continuitySummary ? `承接摘要：${section.continuitySummary}` : '',
    section.error ? `错误：${section.error}` : '',
  ].filter(Boolean).join('\n\n');
}

function buildTroubleshootingSummary(error?: string): string {
  const advice = getTroubleshootingAdvice(error);
  return advice ? `${advice.categoryLabel}：${advice.summary}` : '';
}

function getReplayActionCopy(stage: RequestStage): { buttonLabel: string; description: string } {
  switch (stage) {
    case 'analyze-pages':
      return {
        buttonLabel: '重新分析此页',
        description: '只会补跑当前页，并把受影响的后续综合标记为待更新，不会立刻把后面的内容一起重跑。',
      };
    case 'synthesize-chunks':
      return {
        buttonLabel: '重新综合此块',
        description: '只会重做当前分块，并把受影响的后续综合与章节写作标记为待更新，方便你确认后再继续。',
      };
    case 'synthesize-story':
      return {
        buttonLabel: '重新生成整书综合',
        description: '只会重做整书综合，并把章节写作标记为待更新，不会立刻把正文一起重写。',
      };
    case 'write-sections':
      return {
        buttonLabel: '重新生成此节',
        description: '只会重写当前节，并把后续章节标记为待更新，方便按顺序继续补跑。',
      };
    case 'polish-novel':
      return {
        buttonLabel: '重新全书统稿',
        description: '只会重跑最后的全书统稿/润色阶段，不会重写前面的章节正文。',
      };
    default:
      return {
        buttonLabel: '重新处理',
        description: '会只重做当前选中项，并保留前面不受影响的结果。',
      };
  }
}

function canRegenerateItem(
  item: ActiveItem | null,
  taskStatus: TaskState['status'],
  onRegenerateItem?: (stage: RequestStage, itemIndex: number) => Promise<void>
): item is ActiveItem {
  return Boolean(
    item
    && (item.status !== 'pending' || item.stage === 'polish-novel')
    && item.status !== 'processing'
    && onRegenerateItem
    && taskStatus !== 'running'
    && taskStatus !== 'preparing'
  );
}

function buildStageItems(taskState: TaskState, stage: RequestStage): ActiveItem[] {
  switch (stage) {
    case 'analyze-pages':
      return taskState.pageAnalyses.map((page) => ({
        key: `page-${page.index}`,
        stage,
        itemIndex: page.index,
        label: `第 ${page.pageNumber} 页`,
        meta: buildPageMeta(page),
        status: page.status,
        error: page.error,
        detailTitle: `第 ${page.pageNumber} 页详情`,
        detailContent: buildPageDetail(page),
        previewContent: buildPagePreview(page),
      }));
    case 'synthesize-chunks':
      return taskState.chunkSyntheses.map((chunk) => ({
        key: `chunk-${chunk.index}`,
        stage,
        itemIndex: chunk.index,
        label: chunk.title || `第 ${chunk.index + 1} 块`,
        meta: `${formatPageRange(chunk.pageNumbers)} · ${chunk.pageNumbers.length} 页`,
        status: chunk.status,
        error: chunk.error,
        detailTitle: chunk.title || `第 ${chunk.index + 1} 块`,
        detailContent: buildChunkDetail(chunk),
        previewContent: buildChunkPreview(chunk),
      }));
    case 'synthesize-story':
      return [
        {
          key: 'story-synthesis',
          stage,
          itemIndex: 0,
          label: '整书综合',
          meta: `${taskState.chunkSyntheses.length} 个分块 · ${taskState.globalSynthesis.sceneOutline.length} 个场景`,
          status: taskState.globalSynthesis.status,
          error: taskState.globalSynthesis.error,
          detailTitle: '整书综合详情',
          detailContent: buildStoryDetail(taskState),
          previewContent: buildStoryPreview(taskState),
        },
      ];
    case 'write-sections':
      return taskState.novelSections.map((section) => ({
        key: `section-${section.index}`,
        stage,
        itemIndex: section.index,
        label: section.title || `第 ${section.index + 1} 节`,
        meta: `关联 ${section.chunkIndexes.length} 个分块`,
        status: section.status,
        error: section.error,
        detailTitle: section.title || `第 ${section.index + 1} 节`,
        detailContent: buildSectionDetail(section),
        previewContent: buildSectionPreview(section),
      }));
    case 'polish-novel':
      return [
        {
          key: 'final-polish',
          stage,
          itemIndex: 0,
          label: '全书统稿 / 润色',
          meta: taskState.finalPolish.markdownBody?.trim()
            ? '已生成最终稿'
            : '基于章节正文做全书层面的统一润色',
          status: taskState.finalPolish.status,
          error: taskState.finalPolish.error,
          detailTitle: '全书统稿详情',
          detailContent: buildFinalPolishDetail(taskState),
          previewContent: buildFinalPolishPreview(taskState),
        },
      ];
    default:
      return [];
  }
}

function buildStagePreview(taskState: TaskState, stage: RequestStage): StagePreview {
  const items = buildStageItems(taskState, stage);

  switch (stage) {
    case 'analyze-pages':
      return {
        stage,
        title: '逐页分析预览',
        description: '查看每一页抽取出的摘要、对白、角色和画面文字。',
        emptyText: '逐页分析完成后，这里会显示每页的预览。',
        items,
      };
    case 'synthesize-chunks':
      return {
        stage,
        title: '分块综合预览',
        description: '查看每个分块的剧情摘要、推进点和承接信息。',
        emptyText: '分块综合完成后，这里会显示每个分块的预览。',
        items,
      };
    case 'synthesize-story':
      return {
        stage,
        title: '整书综合预览',
        description: '查看整书级的故事概览、人物关系和场景大纲。',
        emptyText: '整书综合完成后，这里会显示全书预览。',
        items,
      };
    case 'write-sections':
      return {
        stage,
        title: '章节写作预览',
        description: '查看每个章节的正文片段和承接摘要。',
        emptyText: '章节写作开始后，这里会显示章节预览。',
        items,
      };
    case 'polish-novel':
      return {
        stage,
        title: '全书统稿预览',
        description: '查看最终统稿后的全书正文，或确认当前是否跳过了最后统稿阶段。',
        emptyText: '启用全书统稿后，这里会显示最终稿预览。',
        items,
      };
    default:
      return {
        stage,
        title: '阶段预览',
        description: '',
        emptyText: '暂无内容。',
        items,
      };
  }
}

function getCurrentItemsStage(stage: PipelineStage): RequestStage {
  return stage === 'idle' ? 'analyze-pages' : stage;
}

export function ProgressPanel({ taskState, onRegenerateItem }: ProgressPanelProps) {
  const [selectedItem, setSelectedItem] = useState<ActiveItem | null>(null);
  const [selectedStage, setSelectedStage] = useState<RequestStage | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [regeneratingItemKey, setRegeneratingItemKey] = useState<string | null>(null);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [expandedStagePreviewKeys, setExpandedStagePreviewKeys] = useState<string[]>([]);
  const [detailReturnStage, setDetailReturnStage] = useState<RequestStage | null>(null);

  useEffect(() => {
    if (taskState.status !== 'running' || !taskState.lastAIRequest?.sentAt) {
      return;
    }

    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [taskState.lastAIRequest?.sentAt, taskState.status]);

  useEffect(() => {
    setSummaryExpanded(false);
  }, [taskState.globalSynthesis.storyOverview, taskState.memory.globalSummary]);

  useEffect(() => {
    setExpandedStagePreviewKeys([]);
  }, [selectedStage]);

  const totalSections = taskState.novelSections.length > 0
    ? taskState.novelSections.length
    : taskState.chunkSyntheses.length;
  const finalPolishUnitCount = taskState.config.enableFinalPolish ? 1 : 0;
  const totalUnits = taskState.pageAnalyses.length + taskState.chunkSyntheses.length + 1 + totalSections + finalPolishUnitCount;
  const completedUnits = countCompleted(taskState.pageAnalyses)
    + countCompleted(taskState.chunkSyntheses)
    + (taskState.globalSynthesis.status === 'success' || taskState.globalSynthesis.status === 'skipped' ? 1 : 0)
    + countCompleted(taskState.novelSections)
    + (
      taskState.config.enableFinalPolish
        && (taskState.finalPolish.status === 'success' || taskState.finalPolish.status === 'skipped')
        ? 1
        : 0
    );
  const progress = totalUnits > 0 ? (completedUnits / totalUnits) * 100 : 0;

  const requestElapsedMs = (() => {
    if (taskState.status !== 'running' || !taskState.lastAIRequest?.sentAt) {
      return 0;
    }

    const startedAt = Date.parse(taskState.lastAIRequest.sentAt);
    if (Number.isNaN(startedAt)) {
      return 0;
    }

    return Math.max(0, now - startedAt);
  })();

  const requestHint = (() => {
    if (!requestElapsedMs || !taskState.lastAIRequest) {
      return null;
    }

    if (requestElapsedMs >= 90000) {
      return {
        tone: 'destructive' as const,
        text: '当前请求已经明显偏慢，可能是模型排队、代理容量不足或上游卡住。可考虑暂停后重试或跳过。',
      };
    }

    if (requestElapsedMs >= 45000) {
      return {
        tone: 'warning' as const,
        text: '当前请求偏慢，但仍可能成功返回。建议先继续等待一会，再决定是否暂停处理。',
      };
    }

    if (requestElapsedMs >= 20000) {
      return {
        tone: 'muted' as const,
        text: '当前请求耗时比平时长，正在等待模型返回。',
      };
    }

    return null;
  })();

  const getItemStatusPresentation = (item: ActiveItem): StatusPresentation => {
    const hasFallbackContent = item.stage === 'synthesize-story'
      ? Boolean(taskState.globalSynthesis.storyOverview?.trim())
      : item.stage === 'polish-novel'
        ? Boolean((taskState.finalPolish.markdownBody || taskState.fullNovel || '').trim())
        : false;

    return getStatusPresentation(item.status, {
      stage: item.stage,
      hasFallbackContent,
    });
  };

  const globalSynthesisStatus = getStatusPresentation(taskState.globalSynthesis.status, {
    stage: 'synthesize-story',
    hasFallbackContent: Boolean(taskState.globalSynthesis.storyOverview?.trim()),
  });
  const finalPolishStatus = getStatusPresentation(taskState.finalPolish.status, {
    stage: 'polish-novel',
    hasFallbackContent: Boolean((taskState.finalPolish.markdownBody || taskState.fullNovel || '').trim()),
  });

  const stageCards: Array<{ stage: RequestStage; title: string; value: string; hint: string; secondary?: string }> = [
    {
      stage: 'analyze-pages',
      title: '逐页分析',
      value: `${countCompleted(taskState.pageAnalyses)} / ${taskState.pageAnalyses.length}`,
      hint: '点击查看分页预览',
    },
    {
      stage: 'synthesize-chunks',
      title: '分块综合',
      value: `${countCompleted(taskState.chunkSyntheses)} / ${taskState.chunkSyntheses.length}`,
      hint: '点击查看分块预览',
    },
    {
      stage: 'synthesize-story',
      title: '整书综合',
      value: globalSynthesisStatus.compactLabel,
      secondary: globalSynthesisStatus.secondaryLabel,
      hint: '点击查看全书预览',
    },
    {
      stage: 'write-sections',
      title: '章节写作',
      value: `${countCompleted(taskState.novelSections)} / ${taskState.novelSections.length}`,
      hint: '点击查看章节预览',
    },
    ...(taskState.config.enableFinalPolish ? [{
      stage: 'polish-novel' as const,
      title: '全书统稿',
      value: finalPolishStatus.compactLabel,
      secondary: finalPolishStatus.secondaryLabel,
      hint: '点击查看最终稿预览',
    }] : []),
  ];
  const activeItems = buildStageItems(taskState, getCurrentItemsStage(taskState.currentStage));
  const activeErrorItem = activeItems.find((item) => item.status === 'error' && item.error);
  const activeErrorAdvice = activeErrorItem?.error ? getTroubleshootingAdvice(activeErrorItem.error) : null;
  const selectedStagePreview = selectedStage ? buildStagePreview(taskState, selectedStage) : null;
  const selectedItemAdvice = selectedItem?.error ? getTroubleshootingAdvice(selectedItem.error) : null;
  const selectedItemStatusPresentation = selectedItem ? getItemStatusPresentation(selectedItem) : null;
  const canRegenerateSelectedItem = canRegenerateItem(selectedItem, taskState.status, onRegenerateItem);
  const selectedItemReplayAction = selectedItem ? getReplayActionCopy(selectedItem.stage) : null;
  const summaryTitle = taskState.globalSynthesis.storyOverview ? '全书概览' : (
    taskState.memory.globalSummary ? '当前剧情摘要' : null
  );
  const summaryContent = taskState.globalSynthesis.storyOverview || taskState.memory.globalSummary || '';

  const handleRegenerateItem = async () => {
    if (!selectedItem || !onRegenerateItem) {
      return;
    }

    setRegeneratingItemKey(selectedItem.key);
    try {
      await onRegenerateItem(selectedItem.stage, selectedItem.itemIndex);
      setSelectedItem(null);
      setDetailReturnStage(null);
    } finally {
      setRegeneratingItemKey(null);
    }
  };

  const toggleStagePreviewItem = (itemKey: string) => {
    setExpandedStagePreviewKeys((prev) => (
      prev.includes(itemKey)
        ? prev.filter((key) => key !== itemKey)
        : [...prev, itemKey]
    ));
  };

  const openItemDetail = (item: ActiveItem, returnStage?: RequestStage) => {
    setSelectedItem(item);
    setDetailReturnStage(returnStage || null);
  };

  const closeItemDetail = () => {
    setSelectedItem(null);
    setDetailReturnStage(null);
  };

  const returnToStagePreview = () => {
    if (!detailReturnStage) {
      return;
    }

    setSelectedItem(null);
    setSelectedStage(detailReturnStage);
    setDetailReturnStage(null);
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4" />
            处理进度
            <Badge
              variant={
                taskState.status === 'running'
                  ? 'default'
                  : taskState.status === 'completed'
                    ? 'default'
                    : taskState.status === 'paused'
                      ? 'destructive'
                      : 'secondary'
              }
              className="ml-auto"
            >
              {taskState.status === 'idle'
                ? '就绪'
                : taskState.status === 'preparing'
                  ? '预处理图片'
                  : taskState.status === 'running'
                    ? '处理中'
                    : taskState.status === 'paused'
                      ? '已暂停'
                      : taskState.status === 'completed'
                        ? '完成'
                        : '错误'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>{completedUnits} / {totalUnits || 0} 个阶段单元</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>当前阶段</span>
              <span>{taskState.status === 'completed' ? '全部完成' : stageLabel(taskState.currentStage)}</span>
            </div>
          </div>

          {taskState.status === 'running' && taskState.lastAIRequest ? (
            <div
              className={`rounded-lg border px-3 py-2 text-xs ${
                requestHint?.tone === 'destructive'
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : requestHint?.tone === 'warning'
                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                    : 'border-border bg-muted/20 text-muted-foreground'
              }`}
            >
              <div className="flex items-center gap-2 font-medium">
                <TimerReset className="h-3.5 w-3.5" />
                <span>当前请求：{taskState.lastAIRequest.itemLabel}</span>
                <span className="ml-auto">{formatDuration(requestElapsedMs)}</span>
              </div>
              {requestHint ? (
                <p className="mt-1 leading-relaxed">{requestHint.text}</p>
              ) : (
                <p className="mt-1 leading-relaxed">请求已发出，正在等待模型返回。</p>
              )}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            {stageCards.map((card) => (
              <button
                key={card.stage}
                type="button"
                onClick={() => setSelectedStage(card.stage)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  taskState.currentStage === card.stage
                    ? 'border-primary/30 bg-primary/5'
                    : 'bg-muted/20 hover:bg-muted/40'
                }`}
              >
                <div className="text-muted-foreground">{card.title}</div>
                <div className="mt-1 font-medium">{card.value}</div>
                {card.secondary ? (
                  <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-amber-700">
                    {card.secondary}
                  </div>
                ) : null}
                <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Eye className="h-3 w-3" />
                  {card.hint}
                </div>
              </button>
            ))}
          </div>

          {activeErrorItem?.error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-xs text-red-700">
              <div className="font-medium">当前失败项：{activeErrorItem.label}</div>
              <div className="mt-1 break-words">{activeErrorItem.error}</div>
              {activeErrorAdvice ? (
                <div className="mt-2 space-y-1 text-amber-700">
                  <Badge
                    variant="outline"
                    className="border-amber-300 bg-amber-100/80 text-[11px] text-amber-900"
                  >
                    {activeErrorAdvice.categoryLabel}
                  </Badge>
                  <div className="font-medium">{activeErrorAdvice.title}</div>
                  <div>{activeErrorAdvice.summary}</div>
                  <div className="space-y-1">
                    {activeErrorAdvice.checks.map((check) => (
                      <div key={check}>- {check}</div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {activeItems.length > 0 ? (
            <div className="max-h-[280px] overflow-y-auto overscroll-contain pr-2">
              <div className="space-y-1.5">
                {activeItems.map((item) => {
                  const statusPresentation = getItemStatusPresentation(item);

                  return (
                    <button
                    key={item.key}
                    type="button"
                    onClick={() => openItemDetail(item)}
                    className={`w-full rounded p-2 text-left text-sm transition-colors ${
                      item.status === 'processing' && taskState.status === 'running'
                        ? 'border border-primary/20 bg-primary/5'
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <ChunkStatusIcon status={item.status} />
                      <span className="truncate">{item.label}</span>
                      <Badge variant="outline" className="ml-auto text-xs">
                        {statusPresentation.compactLabel}
                      </Badge>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{item.meta}</span>
                      <span className="ml-auto inline-flex items-center gap-1">
                        <Eye className="h-3 w-3" />
                        点击查看
                      </span>
                    </div>
                    {statusPresentation.secondaryLabel ? (
                      <div className="mt-1 text-xs text-amber-700">
                        {statusPresentation.secondaryLabel}
                      </div>
                    ) : null}
                    {item.error ? (
                      <div className="mt-1 space-y-1 text-xs">
                        <div className="truncate text-red-500" title={item.error}>
                          {item.error}
                        </div>
                        {buildTroubleshootingSummary(item.error) ? (
                          <div className="line-clamp-2 text-amber-600">
                            {buildTroubleshootingSummary(item.error)}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">
              添加图片后会在这里显示多阶段处理进度
            </p>
          )}

          {summaryTitle && summaryContent ? (
            <>
              <Separator />
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setSummaryExpanded((prev) => !prev)}
                  className="flex w-full items-center justify-between rounded-lg border bg-muted/20 px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40"
                >
                  <span>{summaryTitle}</span>
                  <span className="inline-flex items-center gap-1">
                    {summaryExpanded ? '收起' : '展开'}
                    {summaryExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </span>
                </button>
                {summaryExpanded ? (
                  <p className="rounded bg-muted/50 p-2 text-xs leading-relaxed">
                    {summaryContent}
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={Boolean(selectedStagePreview)} onOpenChange={(open) => !open && setSelectedStage(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{selectedStagePreview?.title || '阶段预览'}</DialogTitle>
            <DialogDescription>{selectedStagePreview?.description || ''}</DialogDescription>
          </DialogHeader>
          {selectedStagePreview && selectedStagePreview.items.length > 0 ? (
            <ScrollArea className="h-[65vh] pr-4">
              <div className="space-y-3">
                {selectedStagePreview.items.map((item) => {
                  const statusPresentation = getItemStatusPresentation(item);

                  return (
                    <div
                    key={item.key}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      item.status === 'processing' && taskState.status === 'running'
                        ? 'border-primary/20 bg-primary/5'
                        : 'bg-muted/20'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <ChunkStatusIcon status={item.status} />
                      <span className="truncate text-sm font-medium">{item.label}</span>
                      <Badge variant="outline" className="ml-auto text-xs">
                        {statusPresentation.compactLabel}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.meta}</div>
                    {statusPresentation.secondaryLabel ? (
                      <div className="mt-1 text-xs text-amber-700">
                        {statusPresentation.secondaryLabel}
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        onClick={() => toggleStagePreviewItem(item.key)}
                      >
                        {expandedStagePreviewKeys.includes(item.key) ? (
                          <ChevronUp className="mr-1 h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="mr-1 h-3.5 w-3.5" />
                        )}
                        {expandedStagePreviewKeys.includes(item.key) ? '收起预览' : '展开预览'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        onClick={() => {
                          setSelectedStage(null);
                          openItemDetail(item, selectedStagePreview.stage);
                        }}
                      >
                        <Eye className="mr-1 h-3.5 w-3.5" />
                        查看详情
                      </Button>
                    </div>
                    {expandedStagePreviewKeys.includes(item.key) ? (
                      <>
                        <p className="mt-3 whitespace-pre-wrap break-words text-xs leading-6 text-muted-foreground">
                          {item.previewContent}
                        </p>
                        {item.error ? (
                          <div className="mt-2 space-y-1 text-xs">
                            <div className="text-red-500">{item.error}</div>
                            {buildTroubleshootingSummary(item.error) ? (
                              <div className="text-amber-600">{buildTroubleshootingSummary(item.error)}</div>
                            ) : null}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          ) : (
            <div className="rounded-lg border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
              {selectedStagePreview?.emptyText || '暂无内容'}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedItem)} onOpenChange={(open) => !open && closeItemDetail()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            {detailReturnStage ? (
              <div className="mb-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={returnToStagePreview}
                >
                  <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                  返回上一步
                </Button>
              </div>
            ) : null}
            <DialogTitle>{selectedItem?.detailTitle || '详情预览'}</DialogTitle>
            <DialogDescription>
              {selectedItem ? `${selectedItem.meta} · ${statusLabel(selectedItem.status, { stage: selectedItem.stage })}` : ''}
            </DialogDescription>
          </DialogHeader>
          {selectedItemStatusPresentation?.secondaryLabel ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {selectedItemStatusPresentation.secondaryLabel}
            </div>
          ) : null}
          {selectedItemAdvice ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800">
              <Badge
                variant="outline"
                className="border-amber-300 bg-amber-100/80 text-[11px] text-amber-900"
              >
                {selectedItemAdvice.categoryLabel}
              </Badge>
              <div className="font-medium">{selectedItemAdvice.title}</div>
              <div className="mt-1">{selectedItemAdvice.summary}</div>
              <div className="mt-2 space-y-1">
                {selectedItemAdvice.checks.map((check) => (
                  <div key={check}>- {check}</div>
                ))}
              </div>
            </div>
          ) : null}
          {canRegenerateSelectedItem && selectedItemReplayAction ? (
            <div className="rounded-lg border bg-muted/20 px-3 py-3">
              <div className="text-xs leading-5 text-muted-foreground">
                {selectedItemReplayAction.description}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => {
                  void handleRegenerateItem();
                }}
                disabled={regeneratingItemKey !== null}
              >
                {regeneratingItemKey === selectedItem?.key ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : null}
                {selectedItemReplayAction.buttonLabel}
              </Button>
            </div>
          ) : null}
          <ScrollArea className="h-[60vh] rounded-lg border bg-muted/20 p-3">
            <pre className="whitespace-pre-wrap break-words pr-4 text-xs leading-6">
              {selectedItem?.detailContent || '暂无内容'}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
