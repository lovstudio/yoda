export type MobileExternalFileKind = 'image' | 'text' | 'unsupported';

export type MobileExternalFile = {
  kind: MobileExternalFileKind;
  name: string;
  uri: string;
  source?: 'document' | 'share-extension';
  shareToken?: string;
};

export const MOBILE_SHARE_MARKER_PREFIX = 'YODA_MOBILE_SHARE|';

const IMAGE_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'gif',
  'heic',
  'heif',
  'jpeg',
  'jpg',
  'png',
  'tif',
  'tiff',
  'webp',
]);

const TEXT_EXTENSIONS = new Set([
  'c',
  'cc',
  'conf',
  'cpp',
  'css',
  'csv',
  'env',
  'h',
  'hpp',
  'html',
  'java',
  'js',
  'json',
  'log',
  'md',
  'mdx',
  'py',
  'scss',
  'sh',
  'sql',
  'swift',
  'toml',
  'ts',
  'tsx',
  'txt',
  'xml',
  'yaml',
  'yml',
]);

/** Parse an iOS Share Extension, Open In, or Android document URI. */
export function parseMobileExternalFileUrl(rawUrl: string): MobileExternalFile | null {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol === 'yodamobile:' && url.hostname === 'share') {
    const source = url.searchParams.get('source');
    const kind = url.searchParams.get('kind');
    const token = url.searchParams.get('token')?.trim();
    if (
      source !== 'share-extension' ||
      (kind !== 'image' && kind !== 'text') ||
      !token ||
      token.length > 128
    ) {
      return null;
    }

    const fallbackName = kind === 'image' ? '共享图片.png' : '共享文本.txt';
    const name = url.searchParams.get('name')?.trim() || fallbackName;
    return {
      kind,
      name: name.slice(0, 240),
      shareToken: token,
      source: 'share-extension',
      uri: rawUrl,
    };
  }

  if (url.protocol !== 'file:' && url.protocol !== 'content:') return null;

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    decodedPath = url.pathname;
  }

  const name = decodedPath.split(/[\\/]/).filter(Boolean).pop()?.trim() || '打开的文件';
  const extension = name.split('.').pop()?.toLocaleLowerCase() ?? '';
  const kind = IMAGE_EXTENSIONS.has(extension)
    ? 'image'
    : TEXT_EXTENSIONS.has(extension)
      ? 'text'
      : 'unsupported';

  return { kind, name, uri: rawUrl };
}

/** Recover a pending Share Extension handoff after the user returns to the app manually. */
export function parseMobileShareExtensionClipboard(value: string): MobileExternalFile | null {
  const marker = value.split(/\r?\n/, 1)[0] ?? '';
  if (!marker.startsWith(MOBILE_SHARE_MARKER_PREFIX)) return null;
  const match = /^([A-Za-z0-9-]{1,128})\|(image|text)$/.exec(
    marker.slice(MOBILE_SHARE_MARKER_PREFIX.length)
  );
  if (!match) return null;

  const token = match[1];
  const kind = match[2] as 'image' | 'text';
  const name = kind === 'image' ? '共享图片.png' : '共享文本.txt';
  const query = new URLSearchParams({
    source: 'share-extension',
    kind,
    token,
    name,
  });
  return {
    kind,
    name,
    shareToken: token,
    source: 'share-extension',
    uri: `yodamobile://share?${query.toString()}`,
  };
}

/** Read the optional instruction carried after a Share Extension marker. */
export function parseMobileShareExtensionClipboardPayload(
  value: string
): { file: MobileExternalFile; payload: string } | null {
  const marker = value.split(/\r?\n/, 1)[0] ?? '';
  const file = parseMobileShareExtensionClipboard(value);
  if (!file) return null;
  return {
    file,
    payload: value.slice(marker.length).replace(/^\r?\n/, ''),
  };
}
