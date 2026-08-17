import type { AgentReplyDisplayLevel } from '@lovstudio/yoda-protocol/agent-reply-display';
import type {
  MobileSessionDetail,
  MobileSessionTranscriptBlock,
} from '@lovstudio/yoda-protocol/mobile-api';
import type { TokenBuckets } from './stats';

export const YODA_SESSION_SHARE_KIND = 'yoda-session-share' as const;
export const YODA_SESSION_SHARE_VERSION = 1 as const;
export const YODA_SESSION_SHARE_ASSET_MAX_COUNT = 8;
export const YODA_SESSION_SHARE_ASSET_MAX_BYTES = 20 * 1024 * 1024;
export const YODA_SESSION_SHARE_ASSET_TOTAL_MAX_BYTES = 40 * 1024 * 1024;

export type YodaSessionShareAssetContentType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/gif'
  | 'application/pdf'
  | 'text/plain'
  | 'text/markdown'
  | 'application/json'
  | 'text/csv'
  | 'application/zip'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  | 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export type YodaSessionShareAssetUpload = {
  id: string;
  fileName: string;
  contentType: YodaSessionShareAssetContentType;
  dataBase64: string;
};

/**
 * What the shared session burned. Provider CLIs write no cost into their
 * transcripts, so `costUsd` is priced from the bundled list-rate table: an
 * estimate, and a floor when `costPartial` is true because some model had no
 * rate on file. Null cost means "nothing could be priced", which is different
 * from a genuine zero.
 */
export type YodaSessionShareUsage = {
  tokens: TokenBuckets;
  costUsd: number | null;
  costPartial: boolean;
};

export type YodaSessionShareUpload = {
  kind: typeof YODA_SESSION_SHARE_KIND;
  version: typeof YODA_SESSION_SHARE_VERSION;
  title: string;
  runtimeId: string;
  sessionStartedAt: string | null;
  blocks: MobileSessionTranscriptBlock[];
  truncated: boolean;
  assets: YodaSessionShareAssetUpload[];
  omittedAssetCount: number;
  /** Absent when the runtime exposes no usage, or the transcript is gone. */
  usage?: YodaSessionShareUsage;
};

export type YodaSessionShareResponse = {
  id: string;
  url: string;
  createdAt: string;
  assetCount: number;
  omittedAssetCount: number;
};

/** Query parameter the share page reads to pick its transcript depth. */
export const SESSION_SHARE_DISPLAY_LEVEL_PARAM = 'detail';

/** Bakes the display level into a share URL so recipients open it at the intended depth. */
export function withSessionShareDisplayLevel(url: string, level: AgentReplyDisplayLevel): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set(SESSION_SHARE_DISPLAY_LEVEL_PARAM, level);
    return parsed.toString();
  } catch {
    return url;
  }
}

function normalizedTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

export function createYodaSessionShareUpload(
  detail: MobileSessionDetail,
  usage?: YodaSessionShareUsage | null
): YodaSessionShareUpload {
  const blocks = detail.transcript
    .filter((block) => block.content.trim().length > 0)
    .map((block, index) => ({
      id: `block-${index + 1}`,
      role: block.role,
      ...(block.agentPhase ? { agentPhase: block.agentPhase } : {}),
      ...(block.title?.trim() ? { title: block.title.trim().slice(0, 160) } : {}),
      timestamp: normalizedTimestamp(block.timestamp),
      format: block.format,
      content: block.content,
    }));

  if (blocks.length === 0 && detail.content.trim()) {
    blocks.push({
      id: 'block-1',
      role: 'status',
      timestamp: null,
      format: 'plain',
      content: detail.content,
    });
  }

  return {
    kind: YODA_SESSION_SHARE_KIND,
    version: YODA_SESSION_SHARE_VERSION,
    title: detail.session.title.trim().slice(0, 200) || 'Yoda Session',
    runtimeId: detail.session.runtimeId,
    sessionStartedAt: normalizedTimestamp(detail.session.createdAt),
    blocks,
    truncated: detail.transcript.length > 0 ? detail.transcriptTruncated : detail.truncated,
    assets: [],
    omittedAssetCount: 0,
    ...(usage ? { usage } : {}),
  };
}
