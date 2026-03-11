'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  CheckCircle, XCircle, Loader2, SkipForward, Clock, Layers,
} from 'lucide-react';
import type { TaskState, ImageChunk } from '@/lib/types';

interface ProgressPanelProps {
  taskState: TaskState;
}

function ChunkStatusIcon({ status }: { status: ImageChunk['status'] }) {
  switch (status) {
    case 'success': return <CheckCircle className="h-4 w-4 text-green-500" />;
    case 'error': return <XCircle className="h-4 w-4 text-red-500" />;
    case 'processing': return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
    case 'skipped': return <SkipForward className="h-4 w-4 text-yellow-500" />;
    default: return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function statusLabel(status: ImageChunk['status']): string {
  const map = { pending: '等待', processing: '处理中', success: '完成', error: '失败', skipped: '已跳过' };
  return map[status];
}

export function ProgressPanel({ taskState }: ProgressPanelProps) {
  const { chunks, status, currentChunkIndex } = taskState;
  const completed = chunks.filter((c) => c.status === 'success').length;
  const total = chunks.length;
  const progress = total > 0 ? (completed / total) * 100 : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4" />
          处理进度
          <Badge
            variant={
              status === 'running' ? 'default' :
              status === 'completed' ? 'default' :
              status === 'error' || status === 'paused' ? 'destructive' : 'secondary'
            }
            className="ml-auto"
          >
            {status === 'idle' ? '就绪' :
             status === 'preparing' ? '预处理图片...' :
             status === 'running' ? '处理中' :
             status === 'paused' ? '已暂停' :
             status === 'completed' ? '完成' : '错误'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {total > 0 && (
          <>
            <div className="flex items-center justify-between text-sm">
              <span>{completed} / {total} 块</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />

            <ScrollArea className="max-h-[200px]">
              <div className="space-y-1.5">
                {chunks.map((chunk) => (
                  <div
                    key={chunk.index}
                    className={`flex items-center gap-2 p-2 rounded text-sm
                      ${chunk.index === currentChunkIndex && status === 'running' ? 'bg-primary/5 border border-primary/20' : 'hover:bg-muted/50'}`}
                  >
                    <ChunkStatusIcon status={chunk.status} />
                    <span className="font-mono text-xs w-16 shrink-0">
                      第{chunk.index + 1}块
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {chunk.images.length}张图
                    </span>
                    <Badge variant="outline" className="ml-auto text-xs">
                      {statusLabel(chunk.status)}
                    </Badge>
                    {chunk.error && (
                      <span className="text-xs text-red-500 truncate max-w-[200px]" title={chunk.error}>
                        {chunk.error}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        )}

        {total === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            添加图片并点击开始后，进度将在此显示
          </p>
        )}

        {/* 上下文状态预览 */}
        {taskState.memory.globalSummary && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">📖 当前剧情摘要</p>
              <p className="text-xs bg-muted/50 p-2 rounded leading-relaxed">
                {taskState.memory.globalSummary}
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
