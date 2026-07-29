import type { SearchItem } from './search';

export type LovcodeAvailability =
  | { status: 'available'; version: string | null; source: 'cli' | 'desktop' }
  | { status: 'not-installed' };

export type LovcodeSearchResult =
  | { status: 'not-installed' }
  | { status: 'desktop-only'; version: string | null }
  | { status: 'error' }
  | { status: 'ok'; items: SearchItem[] };

export const LOVCODE_REPO_URL = 'https://github.com/lovstudio/lovcode';
export const LOVCODE_DOWNLOAD_URL = `${LOVCODE_REPO_URL}/releases/latest`;
