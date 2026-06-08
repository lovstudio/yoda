import type { AgentProviderId } from './agent-provider-registry';

export const MOBILE_GATEWAY_DEFAULT_PORT = 3879;
export const MOBILE_GATEWAY_DEFAULT_DEV_TOKEN = 'dev-mobile-token';
export const MOBILE_APP_SCHEME = 'yodamobile';
export const MOBILE_APP_DEFAULT_INSTALL_URL = 'https://lovstudio.ai/yoda/mobile';
export const MOBILE_SESSION_CONTENT_MAX_CHARS = 120_000;

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

export type MobileProjectSummary = {
  id: string;
  name: string;
  displayName: string;
  type: 'local' | 'ssh';
  path: string;
  isInternal: boolean;
  isOpen: boolean;
  updatedAt: string;
};

export type MobileTaskSummary = {
  id: string;
  projectId: string;
  name: string;
  status: string;
  bootstrapStatus: MobileTaskBootstrapStatus;
  taskBranch?: string;
  updatedAt: string;
  lastInteractedAt?: string;
  needsReview: boolean;
  isPinned: boolean;
  conversationCount: number;
  providerCounts: Record<string, number>;
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
  providerId: AgentProviderId;
  createdAt?: string;
  updatedAt?: string;
  lastInteractedAt: string | null;
  isInitialConversation: boolean | null;
  runtimeStatus: MobileSessionRuntimeStatus;
  running: boolean;
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

export type MobileSessionTranscriptBlock = {
  id: string;
  role: MobileSessionTranscriptRole;
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
};

export type MobileGatewayConnectionInfo = {
  enabled: boolean;
  running: boolean;
  host: string;
  port: number;
  token: string | null;
  urls: string[];
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
