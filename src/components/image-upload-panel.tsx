'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ImagePlus, X, GripVertical, Trash2, FolderOpen } from 'lucide-react';
import type { ImageItem } from '@/lib/types';

interface ImageUploadPanelProps {
  images: ImageItem[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onClear: () => void;
  disabled?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImageUploadPanel({
  images, onAdd, onRemove, onReorder, onClear, disabled,
}: ImageUploadPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    const input = folderInputRef.current;
    if (!input) return;
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
  }, []);

  const sortFiles = useCallback((files: File[]) => {
    return [...files].sort((a, b) => {
      const pathA = a.webkitRelativePath || a.name;
      const pathB = b.webkitRelativePath || b.name;
      return pathA.localeCompare(pathB, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, []);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;
      const files = sortFiles(Array.from(fileList).filter((f) => f.type.startsWith('image/')));
      if (files.length > 0) onAdd(files);
    },
    [onAdd, sortFiles]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (disabled) return;
      handleFiles(e.dataTransfer.files);
    },
    [disabled, handleFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  // 排序拖拽
  const handleItemDragStart = (index: number) => setDragIndex(index);
  const handleItemDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== index) {
      onReorder(dragIndex, index);
      setDragIndex(index);
    }
  };
  const handleItemDragEnd = () => setDragIndex(null);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ImagePlus className="h-4 w-4" />
          漫画图片
          <Badge variant="secondary" className="ml-auto">{images.length} 张</Badge>
          {images.length > 0 && (
            <Button variant="ghost" size="sm" onClick={onClear} disabled={disabled} className="h-7 px-2">
              <Trash2 className="h-3 w-3 mr-1" />
              清空
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* 拖拽上传区 */}
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer
            ${isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => !disabled && fileInputRef.current?.click()}
        >
          <ImagePlus className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            拖拽图片到此处，或 <span className="text-primary underline">点击选择</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1">支持 JPG/PNG/WebP，也支持直接选择整個文件夹</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}>
              <ImagePlus className="h-3.5 w-3.5 mr-1" />
              上传图片
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={(e) => {
              e.stopPropagation();
              folderInputRef.current?.click();
            }}>
              <FolderOpen className="h-3.5 w-3.5 mr-1" />
              上传文件夹
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
            disabled={disabled}
          />
          <input
            ref={folderInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
            disabled={disabled}
          />
        </div>

        {/* 图片列表 */}
        {images.length > 0 && (
          <ScrollArea className="mt-4 max-h-[300px]">
            <div className="space-y-1">
              {images.map((img, index) => (
                <div
                  key={img.id}
                  className="flex items-center gap-2 p-1.5 rounded-md hover:bg-muted/50 group"
                  draggable={!disabled}
                  onDragStart={() => handleItemDragStart(index)}
                  onDragOver={(e) => handleItemDragOver(e, index)}
                  onDragEnd={handleItemDragEnd}
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab shrink-0" />
                  <span className="text-xs text-muted-foreground w-6 text-right shrink-0">
                    {index + 1}
                  </span>
                  <img
                    src={img.previewUrl}
                    alt={`第${index + 1}页`}
                    className="h-10 w-8 object-cover rounded border shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs truncate" title={img.file.webkitRelativePath || img.file.name}>
                      {img.file.webkitRelativePath || img.file.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatSize(img.originalSize)}
                      {img.compressedSize && (
                        <span className="text-green-600 ml-1">
                          → {formatSize(img.compressedSize)}
                        </span>
                      )}
                    </p>
                  </div>
                  <Badge
                    variant={
                      img.status === 'ready' ? 'default' :
                      img.status === 'error' ? 'destructive' :
                      img.status === 'processing' ? 'secondary' : 'outline'
                    }
                    className="text-xs shrink-0"
                  >
                    {img.status === 'ready' ? '就绪' :
                     img.status === 'error' ? '错误' :
                     img.status === 'processing' ? '处理中' : '等待'}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 shrink-0"
                    onClick={() => onRemove(img.id)}
                    disabled={disabled}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
