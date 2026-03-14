/**
 * ImagePipeline —— 本地图像预处理引擎
 * 当前策略改为原图直传：
 *   1. 不缩放
 *   2. 不转码
 *   3. 直接输出原始文件的 base64 用于 API 请求
 */

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`无法读取图片: ${file.name}`));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => {
      reject(new Error(`无法读取图片: ${file.name}`));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * 处理单张图片：原图 → base64
 * @returns { base64, mime, compressedSize }
 */
export async function processImage(
  file: File
): Promise<{ base64: string; mime: string; compressedSize: number }> {
  const dataUrl = await readFileAsDataUrl(file);
  const [header, base64 = ''] = dataUrl.split(',', 2);
  const mimeMatch = header.match(/^data:(.*?);base64$/i);
  const mime = mimeMatch?.[1] || file.type || 'application/octet-stream';

  if (!base64) {
    throw new Error(`图片编码失败: ${file.name}`);
  }

  return {
    base64,
    mime,
    compressedSize: file.size,
  };
}

/**
 * 批量处理图片，支持进度回调
 */
export async function processImages(
  files: File[],
  onProgress?: (index: number, total: number) => void
): Promise<Array<{ base64: string; mime: string; compressedSize: number }>> {
  const results: Array<{ base64: string; mime: string; compressedSize: number }> = [];
  for (let i = 0; i < files.length; i++) {
    const result = await processImage(files[i]);
    results.push(result);
    onProgress?.(i + 1, files.length);
  }
  return results;
}

/**
 * 为 File 创建预览 URL
 */
export function createPreviewUrl(file: File): string {
  return URL.createObjectURL(file);
}

/**
 * 释放预览 URL
 */
export function revokePreviewUrl(url: string): void {
  URL.revokeObjectURL(url);
}
