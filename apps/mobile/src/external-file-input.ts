export type MobileExternalFileKind = 'image' | 'text' | 'unsupported';

export type MobileExternalFile = {
  kind: MobileExternalFileKind;
  name: string;
  uri: string;
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

/** Parse an iOS Open In / Android document URI without trusting it as a desktop path. */
export function parseMobileExternalFileUrl(rawUrl: string): MobileExternalFile | null {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
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
