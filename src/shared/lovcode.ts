import type { SearchItem } from './search';

export type LovcodeAvailability =
  | { status: 'available'; version: string }
  | { status: 'upgrade-required'; version: string }
  | { status: 'desktop-only'; version: string | null }
  | { status: 'not-installed' };

export type LovcodeSearchResult =
  | { status: 'not-installed' }
  | { status: 'desktop-only'; version: string | null }
  | { status: 'upgrade-required'; version: string }
  | { status: 'error' }
  | { status: 'ok'; items: SearchItem[] };

export const LOVCODE_REPO_URL = 'https://github.com/lovstudio/lovcode';
export const LOVCODE_DOWNLOAD_URL = `${LOVCODE_REPO_URL}/releases/latest`;
export const LOVCODE_MIN_SEARCH_VERSION = '0.40.0';
