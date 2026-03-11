/**
 * ImagePipeline —— 本地图像预处理引擎
 * 使用原生 Canvas API 实现：
 *   1. 长边缩放至 1568px（适配多模态模型最优输入）
 *   2. 转换为 WebP 格式以节省带宽
 *   3. 输出 base64 用于 API 请求
 */

const MAX_LONG_SIDE = 1568;
const WEBP_QUALITY = 0.85;

/**
 * 将 File 对象加载为 HTMLImageElement
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`无法加载图片: ${file.name}`));
    };
    img.src = url;
  });
}

/**
 * 计算缩放后的尺寸，保持长边不超过 MAX_LONG_SIDE
 */
function computeScaledSize(
  width: number,
  height: number
): { width: number; height: number } {
  const longSide = Math.max(width, height);
  if (longSide <= MAX_LONG_SIDE) return { width, height };
  const scale = MAX_LONG_SIDE / longSide;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

/**
 * 处理单张图片：缩放 + WebP 编码 → base64
 * @returns { base64, mime, compressedSize }
 */
export async function processImage(
  file: File
): Promise<{ base64: string; mime: string; compressedSize: number }> {
  const img = await loadImage(file);
  const { width, height } = computeScaledSize(img.width, img.height);

  // 使用 OffscreenCanvas 如果可用，否则 fallback 到 document canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, width, height);

  // 尝试 WebP，不支持则降级为 JPEG
  let dataUrl = canvas.toDataURL('image/webp', WEBP_QUALITY);
  let mime = 'image/webp';
  if (!dataUrl.startsWith('data:image/webp')) {
    dataUrl = canvas.toDataURL('image/jpeg', WEBP_QUALITY);
    mime = 'image/jpeg';
  }

  // 提取纯 base64（去除 data:xxx;base64, 前缀）
  const base64 = dataUrl.split(',')[1];
  const compressedSize = Math.round((base64.length * 3) / 4);

  return { base64, mime, compressedSize };
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
