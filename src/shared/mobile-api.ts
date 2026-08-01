import type { RuntimeId } from './runtime-registry';

export const MOBILE_GATEWAY_DEFAULT_PORT = 3879;
export const MOBILE_GATEWAY_DEFAULT_DEV_TOKEN = 'dev-mobile-token';
export const MOBILE_APP_SCHEME = 'yodamobile';
export const MOBILE_APP_DEFAULT_INSTALL_URL = 'https://lovstudio.ai/yoda/mobile';
export const MOBILE_SESSION_CONTENT_MAX_CHARS = 120_000;
export const MOBILE_SESSION_TRANSCRIPT_MAX_CHARS = 240_000;
export const MOBILE_SESSION_INPUT_MAX_CHARS = 20_000;
export const MOBILE_INPUT_ATTACHMENT_MAX_COUNT = 4;
export const MOBILE_INPUT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
/** Keeps the base64 JSON request comfortably below the gateway and Relay 128 KiB limit. */
export const MOBILE_INPUT_ATTACHMENT_CHUNK_BYTES = 48 * 1024;

export function appendMobileVoiceTranscript(baseValue: string, transcript: string): string {
  const normalized = transcript.trim();
  if (!normalized) return baseValue;
  if (!baseValue) return normalized;
  if (/\s$/.test(baseValue)) return `${baseValue}${normalized}`;
  const previous = baseValue.at(-1) ?? '';
  const next = normalized[0] ?? '';
  const joinsWithoutSpace =
    /[\p{Script=Han}，。！？：；、]/u.test(previous) ||
    /[\p{Script=Han}，。！？：；、]/u.test(next);
  return `${baseValue}${joinsWithoutSpace ? '' : ' '}${normalized}`;
}

export type MobilePairingConnection = {
  baseUrl: string;
  token: string;
};

export function createMobilePairingUrl(connection: MobilePairingConnection): string {
  const params = new URLSearchParams({
    baseUrl: connection.baseUrl,
    token: connection.token,
  });
  return `${MOBILE_APP_SCHEME}://connect?${params.toString()}`;
}

export function createExpoGoPairingUrl(
  expoUrl: string,
  connection: MobilePairingConnection
): string {
  const url = new URL(expoUrl);
  url.pathname = '/--/connect';
  url.searchParams.set('baseUrl', connection.baseUrl);
  url.searchParams.set('token', connection.token);
  return url.toString();
}

export function parseMobilePairingUrl(rawUrl: string): MobilePairingConnection | null {
  try {
    const url = new URL(rawUrl);
    const isMobileScheme =
      url.protocol === `${MOBILE_APP_SCHEME}:` ||
      url.protocol === 'exp:' ||
      url.protocol === 'http:' ||
      url.protocol === 'https:';
    const pathParts = url.pathname.split('/').filter(Boolean);
    const isConnectAction =
      url.hostname === 'connect' || pathParts[pathParts.length - 1] === 'connect';
    if (!isMobileScheme || !isConnectAction) return null;

    const baseUrl = url.searchParams.get('baseUrl')?.trim() ?? '';
    const token = url.searchParams.get('token')?.trim() ?? '';
    if (!baseUrl || !token) return null;

    return { baseUrl, token };
  } catch {
    return null;
  }
}

export type MobileTaskBootstrapStatus =
  | { status: 'ready' }
  | { status: 'bootstrapping' }
  | { status: 'error'; message: string }
  | { status: 'not-started' };

export type MobileTaskActivityStatus =
  | 'working'
  | 'awaiting-input'
  | 'error'
  | 'completed'
  | 'idle'
  | 'bootstrapping'
  | 'review'
  | 'done'
  | 'cancelled'
  | 'todo';

export type MobileProjectSummary = {
  id: string;
  name: string;
  displayName: string;
  type: 'local' | 'ssh';
  path: string;
  isInternal: boolean;
  isOpen: boolean;
  updatedAt: string;
  /** Latest task interaction or project metadata update. Optional for older desktop gateways. */
  lastActivityAt?: string;
};

export type MobileProjectSortMode = 'recent' | 'name' | 'open';

const MOBILE_SQLITE_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

export function parseMobileTimestamp(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const normalized = MOBILE_SQLITE_TIMESTAMP_RE.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

export function getMobileProjectActivityById(
  projects: readonly Pick<MobileProjectSummary, 'id' | 'updatedAt' | 'lastActivityAt'>[],
  tasks: readonly {
    projectId: string;
    createdAt?: string | null;
    updatedAt?: string | null;
    lastInteractedAt?: string | null;
  }[]
): Map<string, string> {
  const activityByProjectId = new Map(
    projects.map((project) => [project.id, project.lastActivityAt ?? project.updatedAt] as const)
  );

  for (const task of tasks) {
    const activityAt = task.lastInteractedAt ?? task.createdAt ?? task.updatedAt;
    if (!activityAt) continue;
    const currentActivityAt = activityByProjectId.get(task.projectId);
    if (parseMobileTimestamp(activityAt) > parseMobileTimestamp(currentActivityAt)) {
      activityByProjectId.set(task.projectId, activityAt);
    }
  }

  return activityByProjectId;
}

function mobileProjectActivityAt(project: MobileProjectSummary): number {
  return parseMobileTimestamp(project.lastActivityAt ?? project.updatedAt);
}

export function sortMobileProjects(
  projects: readonly MobileProjectSummary[],
  mode: MobileProjectSortMode
): MobileProjectSummary[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return projects
    .map((project, index) => ({
      project,
      index,
      activityAt: mobileProjectActivityAt(project),
    }))
    .sort((a, b) => {
      if (mode === 'name') {
        return (
          collator.compare(
            a.project.displayName || a.project.name,
            b.project.displayName || b.project.name
          ) || a.index - b.index
        );
      }
      if (mode === 'open') {
        return (
          Number(b.project.isOpen) - Number(a.project.isOpen) ||
          b.activityAt - a.activityAt ||
          a.index - b.index
        );
      }
      return b.activityAt - a.activityAt || a.index - b.index;
    })
    .map(({ project }) => project);
}

export type MobileTaskSummary = {
  id: string;
  projectId: string;
  name: string;
  status: string;
  activityStatus: MobileTaskActivityStatus;
  bootstrapStatus: MobileTaskBootstrapStatus;
  taskBranch?: string;
  updatedAt: string;
  lastInteractedAt?: string;
  needsReview: boolean;
  isPinned: boolean;
  isLongTerm: boolean;
  conversationCount: number;
  runtimeCounts: Record<string, number>;
};

export type MobileDashboardMetrics = {
  projectCount: number;
  openProjectCount: number;
  activeTaskCount: number;
  inProgressTaskCount: number;
  reviewTaskCount: number;
};

export type MobileDashboardSnapshot = {
  generatedAt: string;
  projects: MobileProjectSummary[];
  tasks: MobileTaskSummary[];
  metrics: MobileDashboardMetrics;
};

export type MobileCreateDemandRequest = {
  projectId?: string | null;
  prompt: string;
  title?: string;
  provider?: string;
  attachmentIds?: string[];
};

export type MobileCreateDemandResponse = {
  task: MobileTaskSummary;
  warning?: string;
};

export type MobileSessionRuntimeStatus =
  | 'idle'
  | 'working'
  | 'awaiting-input'
  | 'error'
  | 'completed';

export type MobileSessionSummary = {
  id: string;
  projectId: string;
  taskId: string;
  title: string;
  runtimeId: RuntimeId;
  createdAt?: string;
  updatedAt?: string;
  lastInteractedAt: string | null;
  isInitialConversation: boolean | null;
  runtimeStatus: MobileSessionRuntimeStatus;
  running: boolean;
  acceptsInput: boolean;
  tmuxEnabled: boolean;
  sessionId: string;
  sessionTitle?: string;
};

export type MobileTaskSessionsResponse = {
  projectId: string;
  taskId: string;
  sessions: MobileSessionSummary[];
};

export type MobileSessionContentSource = 'live' | 'history' | 'empty';

export type MobileSessionTranscriptRole = 'user' | 'assistant' | 'tool' | 'status';
export type MobileSessionTranscriptFormat = 'markdown' | 'code' | 'plain';
export type MobileSessionTranscriptAgentPhase = 'commentary' | 'final';

export type MobileSessionTranscriptBlock = {
  id: string;
  role: MobileSessionTranscriptRole;
  /** Present for Agent text when the runtime exposes reply-phase metadata. */
  agentPhase?: MobileSessionTranscriptAgentPhase;
  title?: string;
  timestamp: string | null;
  format: MobileSessionTranscriptFormat;
  content: string;
};

export type MobileSessionDetail = {
  generatedAt: string;
  session: MobileSessionSummary;
  content: string;
  contentLength: number;
  truncated: boolean;
  source: MobileSessionContentSource;
  transcript: MobileSessionTranscriptBlock[];
  transcriptTruncated: boolean;
};

export type MobileSessionInputRequest = {
  input: string;
  submit?: boolean;
  attachmentIds?: string[];
};

export type MobileSessionInputResponse = {
  ok: true;
  generatedAt: string;
};

export type MobileInputAttachmentKind = 'image';

export type MobileInputAttachment = {
  id: string;
  kind: MobileInputAttachmentKind;
  name: string;
  mimeType: string;
  sizeBytes: number;
};

export type MobileInputAttachmentCreateRequest = Omit<MobileInputAttachment, 'id'>;

export type MobileInputAttachmentCreateResponse = {
  attachmentId: string;
  chunkSizeBytes: number;
};

export type MobileInputAttachmentChunkRequest = {
  offset: number;
  dataBase64: string;
};

export type MobileInputAttachmentChunkResponse = {
  attachmentId: string;
  receivedBytes: number;
};

export type MobileInputAttachmentCompleteResponse = {
  attachment: MobileInputAttachment;
};

export type MobileInputAttachmentDiscardResponse = {
  ok: true;
};

export type MobileGatewayMode = 'development' | 'production';

export type MobileGatewayConnectionInfo = {
  enabled: boolean;
  running: boolean;
  /** Runtime mode of the host app — drives the default Dev/Prod view selection. */
  mode: MobileGatewayMode;
  host: string;
  port: number;
  token: string | null;
  urls: string[];
  connectionKind: 'tailscale' | 'lan' | 'local';
  localExpoUrl: string | null;
  installUrl: string;
  pairingUrl: string | null;
};

export type MobileApiError = {
  error: {
    code: string;
    message: string;
  };
};
