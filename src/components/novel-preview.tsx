'use client';

import { useCallback, useMemo, useState } from 'react';
import { BookOpen, Check, ChevronDown, ChevronUp, Copy, Download, Expand } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import type { TaskState } from '@/lib/types';

interface NovelPreviewProps {
  taskState: TaskState;
  onExport: (format?: 'txt' | 'md') => void;
}

export function NovelPreview({ taskState, onExport }: NovelPreviewProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(taskState.fullNovel);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [taskState.fullNovel]);

  const visibleSections = taskState.novelSections.filter((section) => (
    section.status !== 'error' && Boolean(section.markdownBody?.trim())
  ));
  const pendingSections = taskState.novelSections.filter((section) => (
    section.status === 'pending' && Boolean(section.markdownBody?.trim())
  ));
  const hasFinalPolish = taskState.finalPolish.status === 'success' && Boolean(taskState.finalPolish.markdownBody?.trim());
  const previewHeightClass = 'h-[56vh] min-h-[320px] md:h-[62vh]';
  const fullscreenHeightClass = 'h-[72vh] min-h-[420px]';
  const previewSummary = useMemo(() => {
    if (hasFinalPolish && taskState.finalPolish.markdownBody?.trim()) {
      return '已生成全书润色版，点击展开即可阅读全文。';
    }

    if (visibleSections.length > 0) {
      const lastSection = visibleSections[visibleSections.length - 1];
      const excerpt = String(lastSection?.markdownBody || '')
        .trim()
        .replace(/\n{2,}/g, '\n')
        .slice(0, 140);
      return excerpt ? `${excerpt}${excerpt.length >= 140 ? '...' : ''}` : '已生成章节内容，点击展开即可继续阅读。';
    }

    return '章节写作结果会在这里实时预览。';
  }, [hasFinalPolish, taskState.finalPolish.markdownBody, visibleSections]);

  const renderPreviewBody = (heightClass: string) => {
    if (hasFinalPolish) {
      return (
        <ScrollArea className={heightClass}>
          <div className="space-y-4 pr-4">
            <div className="flex items-center gap-2">
              <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                全书润色版
              </span>
              <Separator className="flex-1" />
            </div>
            <div className="whitespace-pre-wrap text-sm leading-7">
              {taskState.finalPolish.markdownBody}
            </div>
          </div>
        </ScrollArea>
      );
    }

    if (visibleSections.length > 0) {
      return (
        <ScrollArea className={heightClass}>
          <div className="space-y-4 pr-4">
            {visibleSections.map((section) => (
              <div key={section.index}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground">
                    第 {section.index + 1} 节
                  </span>
                  <span className="truncate text-sm font-medium">{section.title}</span>
                  <Separator className="flex-1" />
                </div>
                <div className="whitespace-pre-wrap text-sm leading-7">
                  {section.markdownBody}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      );
    }

    return (
      <div className="flex h-[220px] items-center justify-center rounded-xl border border-dashed bg-muted/10 text-muted-foreground">
        <div className="text-center">
          <BookOpen className="mx-auto mb-3 h-10 w-10 opacity-20" />
          <p className="text-sm">章节写作结果会在这里实时预览</p>
        </div>
      </div>
    );
  };

  return (
    <>
      <Card
        className="flex flex-col"
        data-panel="novel-preview"
        data-preview-mode={hasFinalPolish ? 'final-polish' : visibleSections.length > 0 ? 'sections' : 'empty'}
      >
        <CardHeader className="shrink-0 space-y-3 pb-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="h-4 w-4" />
                小说预览
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                {hasFinalPolish ? (
                  <Badge variant="default">全书润色版</Badge>
                ) : visibleSections.length > 0 ? (
                  <Badge variant="secondary">章节实时预览</Badge>
                ) : (
                  <Badge variant="outline">等待正文生成</Badge>
                )}
                {visibleSections.length > 0 ? (
                  <Badge variant="outline">可预览 {visibleSections.length} 节</Badge>
                ) : null}
                {pendingSections.length > 0 ? (
                  <Badge variant="outline">含待刷新章节</Badge>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => setExpanded((prev) => !prev)}
                data-action="toggle-novel-preview"
                data-expanded={expanded ? 'true' : 'false'}
              >
                {expanded ? <ChevronUp className="mr-1 h-3 w-3" /> : <ChevronDown className="mr-1 h-3 w-3" />}
                {expanded ? '收起预览' : '展开预览'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => setFullscreenOpen(true)}
                disabled={!taskState.fullNovel}
                data-action="open-novel-preview-fullscreen"
              >
                <Expand className="mr-1 h-3 w-3" />
                全屏查看
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={handleCopy}
                disabled={!taskState.fullNovel}
                data-action="copy-novel-preview"
              >
                {copied ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
                {copied ? '已复制' : '复制'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => onExport('txt')}
                disabled={!taskState.fullNovel}
                data-action="export-novel-txt"
              >
                <Download className="mr-1 h-3 w-3" />
                下载 TXT
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => onExport('md')}
                disabled={!taskState.fullNovel}
                data-action="export-novel-md"
              >
                <Download className="mr-1 h-3 w-3" />
                下载 MD
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {!expanded ? (
            <div className="rounded-xl border bg-muted/10 px-4 py-3">
              <div className="text-sm leading-7 text-muted-foreground">{previewSummary}</div>
            </div>
          ) : renderPreviewBody(previewHeightClass)}
        </CardContent>
      </Card>

      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>小说预览</DialogTitle>
          </DialogHeader>
          {renderPreviewBody(fullscreenHeightClass)}
        </DialogContent>
      </Dialog>
    </>
  );
}
