/**
 * CryptoStore —— 基于 Web Crypto API 的 AES-GCM 加密 LocalStorage
 * 使用 PBKDF2 从固定应用盐派生密钥，保护用户 API Key
 */

const STORAGE_PREFIX = 'manga2novel_';
const SALT = new Uint8Array([109, 50, 110, 95, 115, 97, 108, 116, 95, 118, 49, 48, 48, 50, 54, 51]);

async function deriveKey(): Promise<CryptoKey> {
  // 使用 origin 作为密码源，保证同域下可解密
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(window.location.origin + '_manga2novel_key'),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: SALT, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** 加密并存储到 LocalStorage */
export async function secureSet(key: string, value: string): Promise<void> {
  const cryptoKey = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(value);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    encoded
  );
  // 将 iv + ciphertext 拼接后 base64 存储
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  localStorage.setItem(
    STORAGE_PREFIX + key,
    btoa(String.fromCharCode(...combined))
  );
}

/** 从 LocalStorage 解密读取 */
export async function secureGet(key: string): Promise<string | null> {
  const stored = localStorage.getItem(STORAGE_PREFIX + key);
  if (!stored) return null;
  try {
    const combined = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const cryptoKey = await deriveKey();
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    // 解密失败则清除损坏数据
    localStorage.removeItem(STORAGE_PREFIX + key);
    return null;
  }
}

/** 删除存储的值 */
export function secureRemove(key: string): void {
  localStorage.removeItem(STORAGE_PREFIX + key);
}

/** 非敏感数据直接 JSON 存储 */
export function setJSON<T>(key: string, value: T): void {
  localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
}

export function getJSON<T>(key: string): T | null {
  const stored = localStorage.getItem(STORAGE_PREFIX + key);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as T;
  } catch {
    return null;
  }
}
