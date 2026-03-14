'use client';

import { useCallback, useState } from 'react';
import { BookOpen, Check, Copy, Download, LibraryBig } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import type { TaskState } from '@/lib/types';

interface NovelPreviewProps {
  taskState: TaskState;
  onExport: (format?: 'txt' | 'md') => void;
}

export function NovelPreview({ taskState, onExport }: NovelPreviewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(taskState.fullNovel);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [taskState.fullNovel]);

  const completedSections = taskState.novelSections.filter((section) => section.status === 'success');

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="shrink-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="h-4 w-4" />
          小说预览
          <div className="ml-auto flex flex-wrap gap-1">
            <Button variant="outline" size="sm" className="h-7" onClick={handleCopy} disabled={!taskState.fullNovel}>
              {copied ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
              {copied ? '已复制' : '复制'}
            </Button>
            <Button variant="outline" size="sm" className="h-7" onClick={() => onExport('txt')} disabled={!taskState.fullNovel}>
              <Download className="mr-1 h-3 w-3" />
              下载 TXT
            </Button>
            <Button variant="outline" size="sm" className="h-7" onClick={() => onExport('md')} disabled={!taskState.fullNovel}>
              <Download className="mr-1 h-3 w-3" />
              下载 MD
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 space-y-4">
        {taskState.globalSynthesis.sceneOutline.length > 0 ? (
          <div className="rounded-xl border bg-muted/20 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <LibraryBig className="h-4 w-4" />
              场景规划
            </div>
            <div className="space-y-2 text-xs text-muted-foreground">
              {taskState.globalSynthesis.sceneOutline.map((scene) => (
                <div key={scene.sceneId} className="rounded-lg bg-background/70 p-2">
                  <div className="font-medium text-foreground">{scene.title}</div>
                  <div className="mt-1 leading-relaxed">{scene.summary}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {taskState.fullNovel ? (
          <ScrollArea className="h-[500px]">
            <div className="space-y-4 pr-4">
              {completedSections.map((section) => (
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
        ) : (
          <div className="flex h-[220px] items-center justify-center text-muted-foreground">
            <div className="text-center">
              <BookOpen className="mx-auto mb-3 h-10 w-10 opacity-20" />
              <p className="text-sm">章节写作结果会在这里实时预览</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
