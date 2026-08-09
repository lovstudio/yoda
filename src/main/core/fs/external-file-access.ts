import { promises as nativeFs } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_EXTERNAL_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_EXTERNAL_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_AUTHORIZED_PATHS = 512;

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

const authorizedPaths = new Map<string, number>();

/** Normalize a file path supplied by macOS, a desktop file manager, or a URL. */
export function normalizeExternalFilePath(rawPath: string): string | null {
  if (typeof rawPath !== 'string') return null;

  const value = rawPath.trim();
  if (!value || value.startsWith('-')) return null;

  if (value.startsWith('file://')) {
    try {
      return resolve(fileURLToPath(value));
    } catch {
      return null;
    }
  }

  // Keep Windows drive-letter paths intact while rejecting other URI schemes.
  if (/^[a-zA-Z]:[\\/]/.test(value)) return resolve(value);
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return null;

  return resolve(value);
}

/** Grant the renderer access to a path that was explicitly opened by the user. */
export function authorizeExternalFilePath(rawPath: string): string | null {
  const normalized = normalizeExternalFilePath(rawPath);
  if (!normalized) return null;

  authorizedPaths.delete(normalized);
  authorizedPaths.set(normalized, Date.now());
  while (authorizedPaths.size > MAX_AUTHORIZED_PATHS) {
    const oldest = authorizedPaths.keys().next().value;
    if (typeof oldest !== 'string') break;
    authorizedPaths.delete(oldest);
  }
  return normalized;
}

export function isExternalFilePath(rawPath: string): boolean {
  const normalized = normalizeExternalFilePath(rawPath);
  if (!normalized || !authorizedPaths.has(normalized)) return false;
  const timestamp = authorizedPaths.get(normalized) ?? Date.now();
  authorizedPaths.delete(normalized);
  authorizedPaths.set(normalized, timestamp);
  return true;
}

/** Read a user-opened external text file without widening the workspace FS API. */
export async function readExternalFile(
  rawPath: string,
  maxBytes?: number
): Promise<{ content: string; truncated: boolean; totalSize: number }> {
  const filePath = requireAuthorizedPath(rawPath);
  const fileStat = await nativeFs.stat(filePath);
  if (!fileStat.isFile()) throw new Error(`Path is not a file: ${filePath}`);

  const limit = Math.min(
    MAX_EXTERNAL_TEXT_BYTES,
    Math.max(1, Number.isFinite(maxBytes) ? Number(maxBytes) : MAX_EXTERNAL_TEXT_BYTES)
  );
  const truncated = fileStat.size > limit;
  if (!truncated) {
    return {
      content: await nativeFs.readFile(filePath, 'utf8'),
      truncated: false,
      totalSize: fileStat.size,
    };
  }

  const handle = await nativeFs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(limit);
    await handle.read(buffer, 0, limit, 0);
    return { content: buffer.toString('utf8'), truncated: true, totalSize: fileStat.size };
  } finally {
    await handle.close();
  }
}

/** Read a user-opened image or PDF as a data URL for the existing previewers. */
export async function readExternalImage(rawPath: string): Promise<{
  success: boolean;
  dataUrl?: string;
  mimeType?: string;
  size?: number;
  error?: string;
}> {
  const filePath = requireAuthorizedPath(rawPath);
  const ext = extname(filePath).toLowerCase();
  const mimeType = IMAGE_MIME_TYPES[ext];
  if (!mimeType) return { success: false, error: `Unsupported preview format: ${ext}` };

  const fileStat = await nativeFs.stat(filePath);
  if (!fileStat.isFile()) return { success: false, error: `Path is not a file: ${filePath}` };

  const maxSize = ext === '.pdf' ? 50 * 1024 * 1024 : MAX_EXTERNAL_IMAGE_BYTES;
  if (fileStat.size > maxSize) {
    return { success: false, error: `File is too large to preview: ${fileStat.size} bytes` };
  }

  const buffer = await nativeFs.readFile(filePath);
  return {
    success: true,
    dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
    mimeType,
    size: fileStat.size,
  };
}

export async function writeExternalFile(
  rawPath: string,
  content: string
): Promise<{
  success: true;
  bytesWritten: number;
}> {
  const filePath = requireAuthorizedPath(rawPath);
  await nativeFs.writeFile(filePath, content, 'utf8');
  const fileStat = await nativeFs.stat(filePath);
  return { success: true, bytesWritten: fileStat.size };
}

/** Test-only reset; the access registry is intentionally process-local. */
export function clearExternalFileAccessForTests(): void {
  authorizedPaths.clear();
}

function requireAuthorizedPath(rawPath: string): string {
  const filePath = normalizeExternalFilePath(rawPath);
  if (!filePath || !isExternalFilePath(filePath)) {
    throw new Error('The file was not opened through Yoda.');
  }
  return filePath;
}
