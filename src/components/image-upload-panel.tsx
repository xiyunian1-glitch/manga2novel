'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ImagePlus, X, GripVertical, Trash2, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
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

function getFilePath(file: File): string {
  return file.webkitRelativePath || file.name;
}

function withRelativePath(file: File, relativePath: string): File {
  try {
    Object.defineProperty(file, 'webkitRelativePath', {
      configurable: true,
      value: relativePath,
    });
  } catch {
    // Ignore if the browser does not allow redefining the property.
  }
  return file;
}

function supportsDirectoryInput(input: HTMLInputElement | null): boolean {
  if (!input) {
    return false;
  }

  return 'webkitdirectory' in input || 'webkitEntries' in input || 'directory' in input;
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
      const pathA = getFilePath(a);
      const pathB = getFilePath(b);
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

  const openFilePicker = useCallback(() => {
    const input = fileInputRef.current;
    if (!input || disabled) return;
    input.value = '';
    input.click();
  }, [disabled]);

  const collectDirectoryFiles = useCallback(async (directoryHandle: FileSystemDirectoryHandle, parentPath = ''): Promise<File[]> => {
    const files: File[] = [];
    const entries = (directoryHandle as FileSystemDirectoryHandle & {
      values: () => AsyncIterable<
        FileSystemDirectoryHandle | (FileSystemFileHandle & { kind: 'file'; name: string })
      >;
    }).values();

    for await (const entry of entries) {
      const relativePath = `${parentPath}${entry.name}`;
      if (entry.kind === 'file') {
        const file = await entry.getFile();
        if (file.type.startsWith('image/')) {
          files.push(withRelativePath(file, relativePath));
        }
        continue;
      }

      files.push(...await collectDirectoryFiles(entry, `${relativePath}/`));
    }

    return files;
  }, []);

  const openFolderPicker = useCallback(async () => {
    if (disabled) return;

    const canUseDirectoryPicker = typeof window !== 'undefined'
      && typeof (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker === 'function';

    if (canUseDirectoryPicker) {
      try {
        const directoryHandle = await (window as unknown as {
          showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
        }).showDirectoryPicker();
        const files = sortFiles(await collectDirectoryFiles(directoryHandle));
        if (files.length === 0) {
          toast.warning('所选文件夹中没有可用图片');
          return;
        }
        onAdd(files);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        toast.error(error instanceof Error ? error.message : '读取文件夹失败');
      }
      return;
    }

    const input = folderInputRef.current;
    if (input && supportsDirectoryInput(input)) {
      input.value = '';
      input.click();
      return;
    }

    toast.info('当前浏览器不支持直接选择文件夹，已切换为多图上传。手机端建议优先尝试较新的 Chrome、Edge 或 Firefox。');
    openFilePicker();
  }, [collectDirectoryFiles, disabled, onAdd, openFilePicker, sortFiles]);

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
          onClick={(event) => {
            if (disabled) return;
            const target = event.target as HTMLElement;
            if (target.closest('[data-picker-control="true"]')) return;
            openFilePicker();
          }}
        >
          <ImagePlus className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            拖拽图片到此处，或 <span className="text-primary underline">点击选择</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            支持 JPG/PNG/WebP，也支持直接选择整个文件夹。手机端是否能选文件夹取决于当前浏览器。
          </p>
          <div
            className="mt-3 flex flex-wrap items-center justify-center gap-2"
            data-picker-control="true"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={openFilePicker}>
              <ImagePlus className="h-3.5 w-3.5 mr-1" />
              上传图片
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => {
              void openFolderPicker();
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
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
            disabled={disabled}
          />
        </div>

        {/* 图片列表 */}
        {images.length > 0 && (
          <div className="mt-4 max-h-[300px] overflow-y-auto overscroll-contain pr-2">
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
                    <p className="text-xs truncate" title={getFilePath(img.file)}>
                      {getFilePath(img.file)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatSize(img.originalSize)}
                      {img.compressedSize && img.compressedSize !== img.originalSize && (
                        <span className="text-green-600 ml-1">
                          → {formatSize(img.compressedSize)}
                        </span>
                      )}
                      {img.status === 'ready' && img.compressedSize === img.originalSize && (
                        <span className="text-sky-700 ml-1">· 原图直传</span>
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
