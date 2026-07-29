import type { MobileSessionDetail, MobileSessionTranscriptBlock } from './mobile-api';

export const YODA_SESSION_SHARE_KIND = 'yoda-session-share' as const;
export const YODA_SESSION_SHARE_VERSION = 1 as const;

export type YodaSessionShareUpload = {
  kind: typeof YODA_SESSION_SHARE_KIND;
  version: typeof YODA_SESSION_SHARE_VERSION;
  title: string;
  runtimeId: string;
  sessionStartedAt: string | null;
  blocks: MobileSessionTranscriptBlock[];
  truncated: boolean;
};

export type YodaSessionShareResponse = {
  id: string;
  url: string;
  createdAt: string;
};

function normalizedTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

export function createYodaSessionShareUpload(detail: MobileSessionDetail): YodaSessionShareUpload {
  const blocks = detail.transcript
    .filter((block) => block.content.trim().length > 0)
    .map((block, index) => ({
      id: `block-${index + 1}`,
      role: block.role,
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
  };
}
