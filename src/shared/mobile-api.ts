import type { RuntimeId } from './runtime-registry';

export const MOBILE_GATEWAY_DEFAULT_PORT = 3879;
export const MOBILE_GATEWAY_DEFAULT_DEV_TOKEN = 'dev-mobile-token';
export const MOBILE_APP_SCHEME = 'yodamobile';
export const MOBILE_APP_DEFAULT_INSTALL_URL = 'https://lovstudio.ai/yoda/mobile';
export const MOBILE_SESSION_CONTENT_MAX_CHARS = 120_000;
export const MOBILE_SESSION_TRANSCRIPT_MAX_CHARS = 240_000;
export const MOBILE_SESSION_INPUT_MAX_CHARS = 20_000;
export const MOBILE_INPUT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
/** Keeps the base64 JSON request below the gateway's 128 KiB and Relay's 180k frame limits. */
export const MOBILE_INPUT_ATTACHMENT_CHUNK_BYTES = 90 * 1024;
export const MOBILE_SPEECH_CONTEXT_MAX_STRINGS = 50;

const MOBILE_SPEECH_BASE_CONTEXTUAL_STRINGS = [
  'Yoda',
  'Yoda Mobile',
  'LovStudio',
  '手工川',
  '手工川工作室',
  'Agent',
  'Codex',
  'Claude',
  'ChatGPT',
  'OpenAI',
  'Git',
  'GitHub',
  'worktree',
  'MCP',
  'TypeScript',
  'JavaScript',
  'React',
  'React Native',
  'Expo',
  'Electron',
  'pnpm',
  'Vercel',
  'Tauri',
  'macOS',
  'iOS',
  'Android',
] as const;

type MobileSpeechLocale = {
  language: string;
  region: string | null;
  tag: string;
};

const MOBILE_SPEECH_LANGUAGE_DEFAULTS: Record<string, string> = {
  de: 'de-DE',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  it: 'it-IT',
  pt: 'pt-BR',
  yue: 'yue-CN',
  zh: 'zh-CN',
};

function parseMobileSpeechLocale(value: string): MobileSpeechLocale | null {
  const tag = value.trim().replace(/_/g, '-');
  if (!tag) return null;
  const parts = tag.split('-').filter(Boolean);
  const language = parts[0]?.toLowerCase() ?? '';
  if (!/^[a-z]{2,3}$/.test(language)) return null;
  const regionPart = parts.slice(1).find((part) => /^[a-z]{2}$|^\d{3}$/i.test(part));
  return {
    language,
    region: regionPart?.toUpperCase() ?? null,
    tag,
  };
}

export function resolveMobileSpeechLocale(
  preferredLocales: readonly string[],
  supportedLocales: readonly string[]
): string {
  const preferred = preferredLocales
    .map(parseMobileSpeechLocale)
    .filter((locale): locale is MobileSpeechLocale => locale !== null);
  const supported = supportedLocales
    .map(parseMobileSpeechLocale)
    .filter((locale): locale is MobileSpeechLocale => locale !== null);

  for (const candidate of preferred) {
    const exact = supported.find(
      (locale) => locale.tag.toLowerCase() === candidate.tag.toLowerCase()
    );
    if (exact) return exact.tag;
  }
  for (const candidate of preferred) {
    if (!candidate.region) continue;
    const regional = supported.find(
      (locale) => locale.language === candidate.language && locale.region === candidate.region
    );
    if (regional) return regional.tag;
  }
  for (const candidate of preferred) {
    const languageDefault = MOBILE_SPEECH_LANGUAGE_DEFAULTS[candidate.language];
    const preferredDefault = supported.find(
      (locale) => locale.tag.toLowerCase() === languageDefault?.toLowerCase()
    );
    if (preferredDefault) return preferredDefault.tag;
    const languageMatch = supported.find((locale) => locale.language === candidate.language);
    if (languageMatch) return languageMatch.tag;
  }

  const chineseFallback = supported.find((locale) => locale.tag.toLowerCase() === 'zh-cn');
  if (chineseFallback) return chineseFallback.tag;
  if (supported[0]) return supported[0].tag;
  const firstPreferred = preferred[0];
  return firstPreferred
    ? (MOBILE_SPEECH_LANGUAGE_DEFAULTS[firstPreferred.language] ?? firstPreferred.tag)
    : 'zh-CN';
}

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

export function mergeMobileVoiceRecognitionResult(
  committedTranscript: string,
  transcript: string,
  isFinal: boolean
): { committedTranscript: string; visibleTranscript: string } {
  const nextCommittedTranscript = isFinal
    ? appendMobileVoiceTranscript(committedTranscript, transcript)
    : committedTranscript;
  return {
    committedTranscript: nextCommittedTranscript,
    visibleTranscript: isFinal
      ? nextCommittedTranscript
      : appendMobileVoiceTranscript(nextCommittedTranscript, transcript),
  };
}

function normalizeMobileSpeechContext(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function splitMobileSpeechContext(value: string): string[] {
  const normalized = normalizeMobileSpeechContext(value);
  if (!normalized) return [];
  if (normalized.length <= 64) return [normalized];

  return normalized
    .split(/[，。！？；：,.!?;:]+/u)
    .map(normalizeMobileSpeechContext)
    .filter((candidate) => candidate.length >= 2 && candidate.length <= 64);
}

/**
 * Builds the native speech recognizer's biasing vocabulary. Current project/session context takes
 * priority over the stable product and development vocabulary when the platform enforces a limit.
 */
export function buildMobileSpeechContextualStrings(
  contextValues: readonly (string | null | undefined)[]
): string[] {
  const contextualStrings: string[] = [];
  const seen = new Set<string>();

  for (const value of [...contextValues, ...MOBILE_SPEECH_BASE_CONTEXTUAL_STRINGS]) {
    if (!value) continue;
    for (const candidate of splitMobileSpeechContext(value)) {
      const key = candidate.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      contextualStrings.push(candidate);
      if (contextualStrings.length === MOBILE_SPEECH_CONTEXT_MAX_STRINGS) {
        return contextualStrings;
      }
    }
  }

  return contextualStrings;
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

function matchesMobileSearchQuery(query: string, values: readonly string[]): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const searchableText = values.join('\n').toLocaleLowerCase();
  return terms.every((term) => searchableText.includes(term));
}

/** Filters projects by their user-facing and source names while preserving the current sort order. */
export function filterMobileProjects(
  projects: readonly MobileProjectSummary[],
  query: string
): MobileProjectSummary[] {
  return projects.filter((project) =>
    matchesMobileSearchQuery(query, [project.displayName, project.name])
  );
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

/**
 * Orders tasks for the mobile attribution picker. Long-term work is the most
 * useful parent for follow-up tasks, then pinned and recently active work.
 */
export function sortMobileTaskAttributionCandidates(
  tasks: readonly MobileTaskSummary[]
): MobileTaskSummary[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return tasks
    .map((task, index) => ({
      task,
      index,
      activityAt: parseMobileTimestamp(task.lastInteractedAt ?? task.updatedAt),
    }))
    .sort(
      (a, b) =>
        Number(b.task.isLongTerm) - Number(a.task.isLongTerm) ||
        Number(b.task.isPinned) - Number(a.task.isPinned) ||
        b.activityAt - a.activityAt ||
        collator.compare(a.task.name, b.task.name) ||
        a.index - b.index
    )
    .map(({ task }) => task);
}

/** Filters task choices by name while preserving long-term, pinned, and activity ordering. */
export function filterMobileTasks(
  tasks: readonly MobileTaskSummary[],
  query: string
): MobileTaskSummary[] {
  return tasks.filter((task) => matchesMobileSearchQuery(query, [task.name]));
}

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

/**
 * The mobile-only account overview. It intentionally contains display data
 * and aggregate counters only; credentials and desktop settings never leave
 * the desktop gateway.
 */
export type MobileProfileSnapshot = {
  generatedAt: string;
  account: {
    state: 'signed-in' | 'signed-out' | 'session-expired';
    displayName: string | null;
    email: string | null;
    avatarUrl: string | null;
  };
  usage: {
    totalTokens: number | null;
    sessionCount: number;
    tasksTotal: number;
    tasksArchived: number;
    linesAdded: number;
    linesDeleted: number;
  };
  cloud: {
    relay: {
      status: 'none' | 'trial' | 'active' | 'expired' | 'revoked';
      configured: boolean;
      accessEndsAt: string | null;
      deviceCount: number;
      onlineDeviceCount: number;
    } | null;
    settings: {
      signedIn: boolean;
      autoSyncEnabled: boolean;
      lastSyncedAt: string | null;
      cloudUpdatedAt: string | null;
    };
  };
};

export type MobileCreateDemandRequest = {
  projectId?: string | null;
  /** Parent task for context-aware creation from a task detail on mobile. */
  parentTaskId?: string;
  prompt: string;
  title?: string;
  provider?: string;
  attachmentIds?: string[];
};

export type MobileCreateDemandResponse = {
  task: MobileTaskSummary;
  sessionId: string;
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
  /** A provider process is currently attached to this conversation. */
  running: boolean;
  /** The current provider process can receive input immediately. */
  acceptsInput: boolean;
  /** The persisted provider session can be restored for a new follow-up turn. */
  resumable: boolean;
  tmuxEnabled: boolean;
  sessionId: string;
  sessionTitle?: string;
};

export function canContinueMobileSession(
  session: Pick<MobileSessionSummary, 'acceptsInput' | 'resumable'> | null | undefined
): boolean {
  return Boolean(session?.acceptsInput || session?.resumable);
}

export type MobileTaskSessionsResponse = {
  projectId: string;
  taskId: string;
  sessions: MobileSessionSummary[];
};

export type MobileSessionContentSource = 'live' | 'history' | 'empty';

export type MobileSessionTranscriptRole = 'user' | 'assistant' | 'tool' | 'status';
export type MobileSessionTranscriptFormat = 'markdown' | 'code' | 'plain';
export type MobileSessionTranscriptAgentPhase = 'commentary' | 'final';
export type MobileSessionTranscriptToolStatus = 'running' | 'completed';

export type MobileSessionTranscriptBlock = {
  id: string;
  role: MobileSessionTranscriptRole;
  /** Present for Agent text when the runtime exposes reply-phase metadata. */
  agentPhase?: MobileSessionTranscriptAgentPhase;
  /** Present for tool blocks when the transcript exposes call/result boundaries. */
  toolStatus?: MobileSessionTranscriptToolStatus;
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
