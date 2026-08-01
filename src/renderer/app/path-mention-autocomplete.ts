export interface ActivePathMention {
  start: number;
  end: number;
  query: string;
}

export interface PathMentionQueryParts {
  pathKind: 'relative' | 'absolute' | 'home';
  directoryPath: string;
  namePrefix: string;
  preserveDotSlash: boolean;
}

export interface PathCompletionEntry {
  path: string;
  type: 'file' | 'dir' | 'directory';
}

export interface PathCompletionItem {
  path: string;
  name: string;
  type: 'file' | 'dir';
  insertText: string;
}

export interface PathCompletionRequest {
  pathKind: PathMentionQueryParts['pathKind'];
  directoryPath: string;
}

const WINDOWS_DRIVE_ABSOLUTE_RE = /^[A-Za-z]:[\\/]/;

export function findActivePathMention(value: string, caret: number): ActivePathMention | null {
  const beforeCaret = value.slice(0, caret);
  const match = /(^|[\s([{,])@([^\s@]*)$/.exec(beforeCaret);
  if (!match) return null;

  const query = match[2] ?? '';
  return {
    start: caret - query.length - 1,
    end: caret,
    query,
  };
}

export function splitPathMentionQuery(query: string): PathMentionQueryParts {
  const normalized = query.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  const isAbsolute =
    normalized.startsWith('/') || WINDOWS_DRIVE_ABSOLUTE_RE.test(query) || query.startsWith('\\\\');
  const isHome = normalized === '~' || normalized.startsWith('~/');
  const pathKind = isHome ? 'home' : isAbsolute ? 'absolute' : 'relative';
  const preserveDotSlash = normalized.startsWith('./');

  if (isHome) {
    const homeRelativeQuery = normalized === '~' ? '' : normalized.slice(2);
    const homeLastSlash = homeRelativeQuery.lastIndexOf('/');
    return {
      pathKind,
      directoryPath: homeLastSlash === -1 ? '.' : homeRelativeQuery.slice(0, homeLastSlash) || '.',
      namePrefix:
        homeLastSlash === -1 ? homeRelativeQuery : homeRelativeQuery.slice(homeLastSlash + 1),
      preserveDotSlash,
    };
  }

  if (lastSlash === -1) {
    return {
      pathKind,
      directoryPath: '.',
      namePrefix: normalized,
      preserveDotSlash,
    };
  }

  const rawDirectory = normalized.slice(0, lastSlash);
  const directoryPath =
    rawDirectory.length === 0 && normalized.startsWith('/') ? '/' : rawDirectory || '.';

  return {
    pathKind,
    directoryPath,
    namePrefix: normalized.slice(lastSlash + 1),
    preserveDotSlash,
  };
}

export function buildPathCompletionItems(
  entries: PathCompletionEntry[],
  parts: PathMentionQueryParts
): PathCompletionItem[] {
  const lowerPrefix = parts.namePrefix.toLowerCase();

  return entries
    .map((entry) => {
      const path = entry.path.replace(/\\/g, '/');
      const name = pathBaseName(path);
      const type = entry.type === 'directory' ? 'dir' : entry.type;
      const insertBase =
        parts.pathKind === 'home'
          ? `~/${path}`
          : parts.preserveDotSlash && parts.pathKind === 'relative' && !path.startsWith('./')
            ? `./${path}`
            : path;
      const insertText = type === 'dir' ? ensureTrailingSlash(insertBase) : insertBase;
      return { path, name, type, insertText };
    })
    .filter((item) => {
      if (item.name.startsWith('.') && !parts.namePrefix.startsWith('.')) return false;
      return item.name.toLowerCase().startsWith(lowerPrefix);
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export function buildPathCompletionRequest(
  parts: PathMentionQueryParts,
  localHomeDirectory?: string
): PathCompletionRequest {
  if (parts.pathKind !== 'home' || !localHomeDirectory) {
    return { pathKind: parts.pathKind, directoryPath: parts.directoryPath };
  }

  const home = trimTrailingSlash(localHomeDirectory.replace(/\\/g, '/'));
  return {
    pathKind: 'absolute',
    directoryPath: parts.directoryPath === '.' ? home : `${home}/${parts.directoryPath}`,
  };
}

export function rebaseHomePathCompletionEntries(
  entries: PathCompletionEntry[],
  parts: PathMentionQueryParts,
  localHomeDirectory?: string
): PathCompletionEntry[] {
  if (parts.pathKind !== 'home' || !localHomeDirectory) return entries;

  const home = trimTrailingSlash(localHomeDirectory.replace(/\\/g, '/'));
  const homePrefix = `${home}/`;
  return entries.flatMap((entry) => {
    const normalizedPath = entry.path.replace(/\\/g, '/');
    if (!normalizedPath.startsWith(homePrefix)) return [];
    return [{ ...entry, path: normalizedPath.slice(homePrefix.length) }];
  });
}

export function applyPathCompletion(
  value: string,
  mention: ActivePathMention,
  insertText: string
): { value: string; caret: number } {
  const before = value.slice(0, mention.start + 1);
  const after = value.slice(mention.end);
  const nextValue = `${before}${insertText}${after}`;
  return {
    value: nextValue,
    caret: before.length + insertText.length,
  };
}

function pathBaseName(path: string): string {
  const trimmed = path.replace(/\/$/, '');
  const index = trimmed.lastIndexOf('/');
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

function ensureTrailingSlash(path: string): string {
  return path.endsWith('/') ? path : `${path}/`;
}

function trimTrailingSlash(path: string): string {
  return path.replace(/\/+$/, '');
}
