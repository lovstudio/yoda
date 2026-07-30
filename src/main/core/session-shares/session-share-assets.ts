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
import type { CodexRolloutShareImageGroup } from '@main/core/conversations/codex-rollout-terminal-history';

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
const EMBEDDED_IMAGE_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
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
  cwd: string,
  embeddedImages: readonly CodexRolloutShareImageGroup[] = []
): Promise<YodaSessionShareUpload> {
  const assets: YodaSessionShareAssetUpload[] = [];
  const resolvedByPath = new Map<string, Promise<AssetReference>>();
  const pendingEmbeddedImages = [...embeddedImages];
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

  const resolveEmbeddedImage = (
    image: CodexRolloutShareImageGroup['images'][number]
  ): AssetReference => {
    const extension = EMBEDDED_IMAGE_EXTENSION[image.contentType];
    if (!extension || assets.length >= YODA_SESSION_SHARE_ASSET_MAX_COUNT) {
      omittedAssetCount += 1;
      return { kind: 'unavailable', fileName: image.label };
    }

    const data = Buffer.from(image.dataBase64, 'base64');
    const normalizedInput = image.dataBase64.replace(/=+$/, '');
    if (
      data.byteLength <= 0 ||
      data.byteLength > YODA_SESSION_SHARE_ASSET_MAX_BYTES ||
      totalBytes + data.byteLength > YODA_SESSION_SHARE_ASSET_TOTAL_MAX_BYTES ||
      data.toString('base64').replace(/=+$/, '') !== normalizedInput ||
      !hasExpectedImageSignature(data, image.contentType)
    ) {
      omittedAssetCount += 1;
      return { kind: 'unavailable', fileName: image.label };
    }

    const assetId = `asset-${assets.length + 1}`;
    const fileName = `${safeEmbeddedFileName(image.label)}.${extension}`;
    assets.push({
      id: assetId,
      fileName,
      contentType: image.contentType as YodaSessionShareAssetContentType,
      dataBase64: image.dataBase64,
    });
    totalBytes += data.byteLength;
    return {
      kind: 'public',
      token: `yoda-share-asset:${assetId}`,
      fileName,
      image: true,
    };
  };

  const blocks = [];
  for (const block of upload.blocks) {
    let content = block.content;
    if (block.role === 'user' && block.format === 'markdown') {
      const embeddedGroupIndex = findEmbeddedImageGroupIndex(pendingEmbeddedImages, block);
      if (embeddedGroupIndex >= 0) {
        const [embeddedGroup] = pendingEmbeddedImages.splice(embeddedGroupIndex, 1);
        if (embeddedGroup) {
          content = rewriteEmbeddedImages(content, embeddedGroup, resolveEmbeddedImage);
        }
      }
    }
    blocks.push({
      ...block,
      content:
        block.format === 'markdown' ? await rewriteMarkdownAssets(content, resolveAsset) : content,
    });
  }

  return {
    ...upload,
    blocks,
    assets,
    omittedAssetCount,
  };
}

function findEmbeddedImageGroupIndex(
  groups: readonly CodexRolloutShareImageGroup[],
  block: YodaSessionShareUpload['blocks'][number]
): number {
  const content = block.content.trim();
  const exactMatch = groups.findIndex((group) => group.message.trim() === content);
  if (exactMatch >= 0) return exactMatch;

  const blockTime = block.timestamp ? Date.parse(block.timestamp) : Number.NaN;
  return groups.findIndex((group) => {
    const groupTime = group.timestamp ? Date.parse(group.timestamp) : Number.NaN;
    return (
      Number.isFinite(blockTime) &&
      Number.isFinite(groupTime) &&
      Math.abs(blockTime - groupTime) <= 2_000 &&
      group.images.some((image) => content.includes(`[${image.label}]`))
    );
  });
}

function rewriteEmbeddedImages(
  content: string,
  group: CodexRolloutShareImageGroup,
  resolveImage: (image: CodexRolloutShareImageGroup['images'][number]) => AssetReference
): string {
  let rewritten = content;
  const prepended: string[] = [];

  for (const image of group.images) {
    const markdownPlaceholder = `![${escapeMarkdownLabel(image.label)}]`;
    if (rewritten.includes(markdownPlaceholder)) continue;
    const placeholder = `[${image.label}]`;
    const reference = resolveImage(image);
    const rendered =
      reference.kind === 'public'
        ? `![${escapeMarkdownLabel(image.label)}](<${reference.token}>)`
        : `${image.label}（本地素材未同步）`;
    if (rewritten.includes(placeholder)) {
      rewritten = rewritten.replace(placeholder, rendered);
    } else {
      prepended.push(rendered);
    }
  }

  return prepended.length > 0 ? `${prepended.join('\n\n')}\n\n${rewritten}` : rewritten;
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

function safeEmbeddedFileName(value: string): string {
  return (
    value
      .trim()
      .replace(/[^\p{L}\p{N}._-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 180) || 'image'
  );
}

function hasExpectedImageSignature(data: Buffer, contentType: string): boolean {
  if (contentType === 'image/png') {
    return data
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (contentType === 'image/jpeg') {
    return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (contentType === 'image/webp') {
    return (
      data.subarray(0, 4).toString('ascii') === 'RIFF' &&
      data.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  if (contentType === 'image/gif') {
    return /^GIF8[79]a$/.test(data.subarray(0, 6).toString('ascii'));
  }
  return false;
}
