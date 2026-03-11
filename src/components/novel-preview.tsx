'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { BookOpen, Download, Copy, Check } from 'lucide-react';
import { useState, useCallback } from 'react';
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

  const completedChunks = taskState.chunks.filter((c) => c.status === 'success');

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-3 shrink-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="h-4 w-4" />
          小说预览
          <div className="ml-auto flex flex-wrap gap-1">
              <Button variant="outline" size="sm" className="h-7" onClick={handleCopy} disabled={!taskState.fullNovel}>
                {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                {copied ? '已复制' : '复制'}
              </Button>
              <Button variant="outline" size="sm" className="h-7" onClick={() => onExport('txt')} disabled={!taskState.fullNovel}>
                <Download className="h-3 w-3 mr-1" />
                下载 TXT
              </Button>
              <Button variant="outline" size="sm" className="h-7" onClick={() => onExport('md')} disabled={!taskState.fullNovel}>
                <Download className="h-3 w-3 mr-1" />
                下载 MD
              </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0">
        {taskState.fullNovel ? (
          <ScrollArea className="h-[500px]">
            <div className="space-y-4 pr-4">
              {completedChunks.map((chunk) => (
                <div key={chunk.index}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
                      第{chunk.index + 1}块
                    </span>
                    <Separator className="flex-1" />
                  </div>
                  <div className="text-sm leading-7 whitespace-pre-wrap">
                    {chunk.novelText}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <div className="flex items-center justify-center h-[200px] text-muted-foreground">
            <div className="text-center">
              <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">生成的小说将在此处实时预览</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
