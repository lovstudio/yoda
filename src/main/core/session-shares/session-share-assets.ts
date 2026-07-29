import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  YODA_SESSION_SHARE_ASSET_MAX_BYTES,
  YODA_SESSION_SHARE_ASSET_MAX_COUNT,
  YODA_SESSION_SHARE_ASSET_TOTAL_MAX_BYTES,
  type YodaSessionShareAssetContentType,
  type YodaSessionShareAssetUpload,
  type YodaSessionShareUpload,
} from '@shared/session-share';

const MIME_BY_EXTENSION: Record<string, YodaSessionShareAssetContentType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const SUPPORTED_EXTENSION_PATTERN = '(?:png|jpe?g|webp|gif|pdf|txt|md|json|csv|zip|docx|xlsx|pptx)';
const MARKDOWN_LINK_PATTERN = /(!?\[([^\]\n]*)\]\()(<[^>\n]+>|[^)\n]+)(\))/g;
const IMAGE_TAG_PATTERN =
  /<image\s+name=(?:"([^"]+)"|(\[[^\]]+\])|([^\s>]+))\s+path=(?:"([^"]+)"|'([^']+)')\s*\/?>/gi;
const AT_PATH_PATTERN = new RegExp(
  `@((?:~\\/|\\/|[A-Za-z]:[\\\\/])[^\\n]*?\\.${SUPPORTED_EXTENSION_PATTERN})(?=$|[\\s,，。；;！!？?])`,
  'giu'
);

type AssetReference =
  | { kind: 'public'; token: string; fileName: string; image: boolean }
  | { kind: 'unavailable'; fileName: string }
  | { kind: 'external' };

export async function attachLocalSessionAssets(
  upload: YodaSessionShareUpload,
  cwd: string
): Promise<YodaSessionShareUpload> {
  const assets: YodaSessionShareAssetUpload[] = [];
  const resolvedByPath = new Map<string, Promise<AssetReference>>();
  let totalBytes = 0;
  let omittedAssetCount = 0;

  const resolveAsset = async (rawDestination: string): Promise<AssetReference> => {
    const localPath = resolveLocalPath(rawDestination, cwd);
    if (!localPath) return { kind: 'external' };
    const cached = resolvedByPath.get(localPath);
    if (cached) return cached;

    const pending = (async (): Promise<AssetReference> => {
      const fileName = path.basename(localPath);
      const contentType = MIME_BY_EXTENSION[path.extname(localPath).toLowerCase()];
      if (!contentType || assets.length >= YODA_SESSION_SHARE_ASSET_MAX_COUNT) {
        omittedAssetCount += 1;
        return { kind: 'unavailable', fileName };
      }

      try {
        const metadata = await stat(localPath);
        if (
          !metadata.isFile() ||
          metadata.size <= 0 ||
          metadata.size > YODA_SESSION_SHARE_ASSET_MAX_BYTES ||
          totalBytes + metadata.size > YODA_SESSION_SHARE_ASSET_TOTAL_MAX_BYTES
        ) {
          throw new Error('Session share asset exceeds upload limits');
        }
        const data = await readFile(localPath);
        const assetId = `asset-${assets.length + 1}`;
        assets.push({
          id: assetId,
          fileName,
          contentType,
          dataBase64: data.toString('base64'),
        });
        totalBytes += data.byteLength;
        return {
          kind: 'public',
          token: `yoda-share-asset:${assetId}`,
          fileName,
          image: contentType.startsWith('image/'),
        };
      } catch {
        omittedAssetCount += 1;
        return { kind: 'unavailable', fileName };
      }
    })();
    resolvedByPath.set(localPath, pending);
    return pending;
  };

  const blocks = [];
  for (const block of upload.blocks) {
    blocks.push({
      ...block,
      content:
        block.format === 'markdown'
          ? await rewriteMarkdownAssets(block.content, resolveAsset)
          : block.content,
    });
  }

  return {
    ...upload,
    blocks,
    assets,
    omittedAssetCount,
  };
}

async function rewriteMarkdownAssets(
  content: string,
  resolveAsset: (destination: string) => Promise<AssetReference>
): Promise<string> {
  let rewritten = await replaceAsync(
    content,
    MARKDOWN_LINK_PATTERN,
    async (match, prefix, label, rawDestination, suffix) => {
      const reference = await resolveAsset(rawDestination);
      if (reference.kind === 'external') return match;
      if (reference.kind === 'unavailable') {
        return `${label || reference.fileName}（本地素材未同步）`;
      }
      return `${prefix}<${reference.token}>${suffix}`;
    }
  );

  rewritten = await replaceAsync(
    rewritten,
    IMAGE_TAG_PATTERN,
    async (match, quotedName, bracketedName, plainName, doubleQuotedPath, singleQuotedPath) => {
      const label = (quotedName || bracketedName || plainName || '图片').replace(/^\[|\]$/g, '');
      const reference = await resolveAsset(doubleQuotedPath || singleQuotedPath);
      if (reference.kind === 'external') return match;
      if (reference.kind === 'unavailable') return `${label}（本地素材未同步）`;
      return `![${escapeMarkdownLabel(label)}](<${reference.token}>)`;
    }
  );

  return replaceAsync(rewritten, AT_PATH_PATTERN, async (_match, rawPath) => {
    const reference = await resolveAsset(rawPath);
    if (reference.kind === 'external') return `@${rawPath}`;
    if (reference.kind === 'unavailable') {
      return `${reference.fileName}（本地素材未同步）`;
    }
    const label = escapeMarkdownLabel(reference.fileName);
    return reference.image
      ? `![${label}](<${reference.token}>)`
      : `[${label}](<${reference.token}>)`;
  });
}

function resolveLocalPath(rawDestination: string, cwd: string): string | null {
  let destination = rawDestination.trim();
  if (destination.startsWith('<') && destination.endsWith('>')) {
    destination = destination.slice(1, -1).trim();
  }
  if (!destination || destination.startsWith('yoda-share-asset:')) return null;
  if (/^(?:https?:|mailto:|data:|blob:|#)/i.test(destination)) return null;

  if (destination.startsWith('file://')) {
    try {
      destination = decodeURIComponent(new URL(destination).pathname);
    } catch {
      return null;
    }
  } else if (destination.startsWith('sandbox:')) {
    destination = destination.slice('sandbox:'.length);
  }

  if (destination.startsWith('~/')) {
    return path.resolve(homedir(), destination.slice(2));
  }
  if (path.isAbsolute(destination) || path.win32.isAbsolute(destination)) {
    return path.normalize(destination);
  }
  if (MIME_BY_EXTENSION[path.extname(destination).toLowerCase()]) {
    return path.resolve(cwd, destination);
  }
  return null;
}

async function replaceAsync(
  value: string,
  pattern: RegExp,
  replacer: (match: string, ...groups: string[]) => Promise<string>
): Promise<string> {
  const matches = [...value.matchAll(pattern)];
  if (matches.length === 0) return value;
  const replacements: string[] = [];
  for (const match of matches) {
    replacements.push(await replacer(match[0], ...(match.slice(1) as string[])));
  }
  let cursor = 0;
  let result = '';
  matches.forEach((match, index) => {
    result += value.slice(cursor, match.index);
    result += replacements[index];
    cursor = (match.index ?? 0) + match[0].length;
  });
  return result + value.slice(cursor);
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/[[\]\\]/g, '\\$&');
}
