export type MobileExternalFileKind = 'image' | 'text' | 'unsupported';

export type MobileExternalFile = {
  kind: MobileExternalFileKind;
  name: string;
  uri: string;
  source?: 'document' | 'share-extension';
  shareToken?: string;
};

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
