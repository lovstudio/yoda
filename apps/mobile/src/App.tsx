import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type AppStateStatus,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import yodaMarkSource from '../../../src/assets/images/yoda/yoda_logo.png';
import { applyAgentCommandPrefix } from '../../../src/shared/agent-command-prefix';
import {
  AGENT_REPLY_DISPLAY_LEVELS,
  type AgentReplyDisplayLevel,
} from '../../../src/shared/agent-reply-display';
import {
  appendMobileVoiceTranscript,
  canContinueMobileSession,
  filterMobileProjects,
  filterMobileSkills,
  filterMobileTasks,
  getMobileProjectActivityById,
  mergeMobileVoiceRecognitionResult,
  MOBILE_GATEWAY_DEFAULT_DEV_TOKEN,
  MOBILE_SESSION_INPUT_MAX_CHARS,
  parseMobilePairingUrl,
  parseMobileTimestamp,
  prependMobileSkillCommand,
  resolveMobilePermissionMode,
  resolveMobileSiblingTaskAttribution,
  sortMobileProjects,
  sortMobileTaskAttributionCandidates,
  sortMobileTasks,
  type MobileConfigurationSnapshot,
  type MobileDashboardSnapshot,
  type MobileDemandConfiguration,
  type MobileProfileSnapshot,
  type MobileProjectSortMode,
  type MobileProjectSummary,
  type MobileSessionDetail,
  type MobileSessionInteraction,
  type MobileSessionRuntimeConfigurationUpdate,
  type MobileSessionSummary,
  type MobileSessionTranscriptBlock,
  type MobileSkillSummary,
  type MobileTaskActivityStatus,
  type MobileTaskSortMode,
  type MobileTaskSummary,
} from '../../../src/shared/mobile-api';
import {
  canonicalizeMobileRelayPairing,
  parseMobileRelayPairingUrl,
} from '../../../src/shared/mobile-relay';
import {
  filterMobileSessionTranscript,
  stripInternalAgentReplyMetadata,
} from '../../../src/shared/mobile-session-display';
import {
  buildMobileSessionInteractionAnswer,
  type MobileSessionInteractionSelections,
} from '../../../src/shared/mobile-session-interaction';
import {
  formatMobileToolTranscriptContent,
  groupAdjacentMobileToolBlocks,
  mobileToolGroupTitle,
  summarizeMobileToolTranscriptContent,
} from '../../../src/shared/mobile-tool-transcript';
import {
  createDemand,
  discardInputAttachment,
  fetchConfiguration,
  fetchProfile,
  fetchSessionDetail,
  fetchSkills,
  fetchSnapshot,
  fetchTaskSessions,
  sendSessionInput,
  updateSessionRuntimeConfiguration,
  type MobileConnection,
} from './api-client';
import {
  explicitMobilePairingUrl,
  selectMobileConnectionBootstrapFallback,
} from './connection-bootstrap';
import { clearConnection, loadConnection, saveConnection } from './connection-storage';
import { prepareCreatedDemandNavigation } from './demand-navigation';
import { parseMobileExternalFileUrl, type MobileExternalFile } from './external-file-input';
import { readMobileExternalTextFile, resolveMobileExternalFile } from './external-file-reader';
import { DEFAULT_HOME_TAB, HOME_TABS, homeTabTitle, type HomeTab } from './home-navigation';
import { MobileImageEditor } from './input-image-editor';
import { importMobileInputImage, pickMobileInputImages } from './input-media';
import {
  uploadMobileInputImages,
  type MobileImageDraft,
  type MobileInputUploadProgress,
} from './input-upload';
import { parseMarkdownBlocks, tokenizeInlineMarkdown } from './markdown';
import {
  DEFAULT_SESSION_DISPLAY_PREFERENCES,
  loadSessionDisplayPreferences,
  saveSessionDisplayPreferences,
  type SessionOutputMode,
} from './session-display-preferences';
import { subscribeSessionEvents } from './session-event-stream';
import { resolveMobileTaskEntry } from './task-navigation';
import { startMobileVoiceInput, type MobileVoiceInputSession } from './voice-input';

const COLORS = {
  page: '#F7F7F2',
  surface: '#FFFFFF',
  ink: '#171717',
  muted: '#686B6F',
  faint: '#E7E4DC',
  line: '#D8D4CB',
  blue: '#2563EB',
  green: '#1F8A70',
  amber: '#B7791F',
  red: '#B42318',
  charcoal: '#2D3135',
};

const POLL_INTERVAL_MS = 8_000;
const SESSION_LIST_POLL_INTERVAL_MS = 4_000;
const SESSION_DETAIL_RECONCILE_INTERVAL_MS = 60_000;
const SESSION_DETAIL_REQUEST_TIMEOUT_MS = 15_000;
const SESSION_EVENT_REFRESH_DELAY_MS = 500;
const RELAY_PAIR_TIMEOUT_MS = 15_000;
const DEV_GATEWAY_DEFAULT_PORT = '3879';
const SWIPE_BACK_EDGE_WIDTH = 34;
const SWIPE_BACK_ACTIVATION_DISTANCE = 12;
const SWIPE_BACK_MIN_DISTANCE = 84;
const SWIPE_BACK_MAX_VERTICAL_DISTANCE = 64;
const SWIPE_BACK_MIN_VELOCITY = 0.45;
const READABLE_OUTPUT_MAX_BLOCKS = 96;
const SESSION_DETAIL_BOTTOM_THRESHOLD = 96;

type ConnectDraft = {
  baseUrl: string;
  token: string;
};

type TaskScope = 'all' | 'open' | 'inProgress' | 'review';

type PendingSessionInput = {
  attachmentIds: string[] | null;
  imageIds: string[];
  input: string;
  requestId: string;
};

type SessionInputIssue = {
  detail: string;
  message: string;
};

type ReadableOutputBlock = {
  id: string;
  kind: 'prose' | 'code';
  text: string;
};

type ReadableOutput = {
  blocks: ReadableOutputBlock[];
  omittedCount: number;
};

function taskScopeLabel(scope: TaskScope): string {
  switch (scope) {
    case 'open':
      return '已打开项目';
    case 'inProgress':
      return '进行中';
    case 'review':
      return '待审阅';
    case 'all':
      return '全部任务';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'working':
      return 'Working';
    case 'awaiting-input':
      return 'Waiting';
    case 'error':
      return 'Error';
    case 'completed':
      return 'Completed';
    case 'idle':
      return 'Idle';
    case 'bootstrapping':
      return 'Booting';
    case 'in_progress':
      return 'In progress';
    case 'review':
      return 'Review';
    case 'done':
      return 'Done';
    case 'cancelled':
      return 'Cancelled';
    case 'todo':
      return 'Todo';
    default:
      return status;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'working':
    case 'in_progress':
      return COLORS.blue;
    case 'awaiting-input':
    case 'bootstrapping':
    case 'review':
      return COLORS.amber;
    case 'completed':
    case 'done':
      return COLORS.green;
    case 'error':
    case 'cancelled':
      return COLORS.red;
    case 'idle':
    default:
      return COLORS.muted;
  }
}

function isTaskActivityRunning(status: MobileTaskActivityStatus): boolean {
  return status === 'working' || status === 'awaiting-input' || status === 'bootstrapping';
}

function runtimeLabel(status: MobileSessionSummary['runtimeStatus']): string {
  switch (status) {
    case 'working':
      return 'Working';
    case 'awaiting-input':
      return 'Waiting';
    case 'error':
      return 'Error';
    case 'completed':
      return 'Done';
    case 'idle':
      return 'Idle';
  }
}

function mobileInputUploadProgressText(progress: MobileInputUploadProgress): string {
  const percentage =
    progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.uploadedBytes / progress.totalBytes) * 100))
      : 0;
  return `${percentage}% · ${progress.completedImages}/${progress.totalImages} 张图片`;
}

function mobileInputUploadLabel(progress: MobileInputUploadProgress): string {
  return `正在上传 ${mobileInputUploadProgressText(progress)}`;
}

function createMobileSessionInputRequestId(): string {
  return `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function createDefaultMobileDemandConfiguration(
  configuration: MobileConfigurationSnapshot
): MobileDemandConfiguration {
  const agent = configuration.agents.find(
    (candidate) => candidate.id === configuration.defaultAgentId
  );
  const runtimeId = agent?.preferredRuntime ?? configuration.defaultRuntimeId;
  return {
    agentId: agent?.id ?? null,
    runtimeId,
    runMode: 'normal',
    strategyKind: 'no-worktree',
    model: agent?.model ?? null,
    reasoningEffort: agent?.reasoningEffort ?? null,
    permissionMode: resolveMobilePermissionMode(configuration, agent, runtimeId),
  };
}

function mobileRuntimeName(
  configuration: MobileConfigurationSnapshot | null,
  runtimeId: MobileDemandConfiguration['runtimeId']
): string {
  return configuration?.runtimes.find((runtime) => runtime.id === runtimeId)?.name ?? runtimeId;
}

function runtimeColor(status: MobileSessionSummary['runtimeStatus']): string {
  switch (status) {
    case 'working':
      return COLORS.blue;
    case 'awaiting-input':
      return COLORS.amber;
    case 'error':
      return COLORS.red;
    case 'completed':
      return COLORS.green;
    case 'idle':
      return COLORS.muted;
  }
}

function contentSourceLabel(source: MobileSessionDetail['source']): string {
  switch (source) {
    case 'live':
      return 'Live buffer';
    case 'history':
      return 'History';
    case 'empty':
      return 'No output';
  }
}

function isPromptLikeLine(line: string): boolean {
  return /^(?:[$#>]|pnpm\b|npm\b|yarn\b|bun\b|git\b|node\b|python\b|cargo\b|go\b|deno\b|npx\b|tsx\b)/.test(
    line.trim()
  );
}

function isCodeLikeBlock(text: string): boolean {
  const lines = text.split('\n').filter((line) => line.trim());
  if (lines.length === 0) return false;

  const codeLikeLines = lines.filter((line) => {
    const trimmed = line.trim();
    return (
      isPromptLikeLine(line) ||
      /^\s+at\s/.test(line) ||
      /^[A-Za-z]+Error[:\s]/.test(trimmed) ||
      /^(?:diff --git|@@|[+-]{3}\s|import\s|export\s|const\s|let\s|function\s|class\s)/.test(
        trimmed
      ) ||
      trimmed.length > 110
    );
  }).length;

  return (
    codeLikeLines >= Math.max(2, Math.ceil(lines.length * 0.45)) ||
    (lines.length > 8 && codeLikeLines >= 2)
  );
}

function splitReadableOutput(value: string): string[] {
  const normalized = value
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n\s*\n/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  if (paragraphs.length > 1) return paragraphs;

  const chunks: string[] = [];
  let current: string[] = [];
  for (const line of normalized.split('\n')) {
    const startsNewBlock =
      current.length > 0 &&
      (isPromptLikeLine(line) ||
        /^(?:Error|Warning|Info|Done|Running|Started|Completed|Failed)\b/i.test(line.trim()) ||
        current.length >= 10);

    if (startsNewBlock) {
      chunks.push(current.join('\n').trim());
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) chunks.push(current.join('\n').trim());
  return chunks.filter(Boolean);
}

function parseReadableOutput(value: string): ReadableOutput {
  const chunks = splitReadableOutput(value);
  const omittedCount = Math.max(0, chunks.length - READABLE_OUTPUT_MAX_BLOCKS);
  const visibleChunks = chunks.slice(-READABLE_OUTPUT_MAX_BLOCKS);

  return {
    omittedCount,
    blocks: visibleChunks.map((text, index) => ({
      id: `${index}-${text.length}-${text.slice(0, 12)}`,
      kind: isCodeLikeBlock(text) ? 'code' : 'prose',
      text,
    })),
  };
}

function isAssistantTextBlock(block: MobileSessionTranscriptBlock): boolean {
  return block.role === 'assistant' && (block.format === 'markdown' || block.format === 'plain');
}

function mergeAdjacentAssistantBlocks(
  blocks: MobileSessionTranscriptBlock[]
): MobileSessionTranscriptBlock[] {
  const merged: MobileSessionTranscriptBlock[] = [];
  for (const block of blocks) {
    const previous = merged.at(-1);
    if (previous && isAssistantTextBlock(previous) && isAssistantTextBlock(block)) {
      previous.content = `${previous.content}\n\n${block.content}`;
      previous.format =
        previous.format === 'markdown' || block.format === 'markdown' ? 'markdown' : 'plain';
      continue;
    }
    merged.push({ ...block });
  }
  return merged;
}

function formatTimestamp(value?: string): string {
  if (!value) return 'No activity yet';
  const date = new Date(parseMobileTimestamp(value));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatReadableNumber(value: number, maximumFractionDigits = 1): string {
  const absolute = Math.abs(value);
  const units = [
    { divisor: 100_000_000, suffix: '亿' },
    { divisor: 10_000, suffix: '万' },
  ];
  const unit = units.find(({ divisor }) => absolute >= divisor);
  if (!unit) return new Intl.NumberFormat('zh-CN').format(value);

  const scaled = value / unit.divisor;
  const formatted = new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(scaled);
  return `${formatted}${unit.suffix}`;
}

function formatTokenUsage(value: number | null): { amount: string; unit: string } {
  if (value === null) return { amount: '—', unit: '暂无数据' };
  const compact = formatReadableNumber(value);
  const match = compact.match(/^(.+?)([万亿])$/);
  return match
    ? { amount: match[1]!, unit: `${match[2]} Token` }
    : { amount: compact, unit: 'Token' };
}

function formatProfileTime(value: string | null): string {
  if (!value) return '尚未同步';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '尚未同步';
  const time = date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

function accountStateLabel(state: MobileProfileSnapshot['account']['state']): string {
  switch (state) {
    case 'signed-in':
      return '已登录';
    case 'session-expired':
      return '需要重新登录';
    case 'signed-out':
      return '未登录';
  }
}

function relayStateLabel(
  status: NonNullable<MobileProfileSnapshot['cloud']['relay']>['status']
): string {
  switch (status) {
    case 'active':
      return '已启用';
    case 'trial':
      return '试用中';
    case 'expired':
      return '已到期';
    case 'revoked':
      return '已停用';
    case 'none':
      return '未开通';
  }
}

function projectName(projects: MobileProjectSummary[], projectId: string): string {
  return projects.find((project) => project.id === projectId)?.displayName ?? 'Unknown project';
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function redactPairingUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.searchParams.has('token')) {
      url.searchParams.set('token', '<redacted>');
    }
    if (url.searchParams.has('pairingCode')) {
      url.searchParams.set('pairingCode', '<redacted>');
    }
    return url.toString();
  } catch {
    return value;
  }
}

function envValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function inferDevGatewayConnection(urls: string[]): MobileConnection | null {
  if (!__DEV__) return null;

  const envBaseUrl = envValue(process.env.EXPO_PUBLIC_YODA_MOBILE_GATEWAY_URL);
  const envToken =
    envValue(process.env.EXPO_PUBLIC_YODA_MOBILE_GATEWAY_TOKEN) ?? MOBILE_GATEWAY_DEFAULT_DEV_TOKEN;
  if (envBaseUrl) return { baseUrl: envBaseUrl, token: envToken };

  const port =
    envValue(process.env.EXPO_PUBLIC_YODA_MOBILE_GATEWAY_PORT) ?? DEV_GATEWAY_DEFAULT_PORT;
  for (const value of urls) {
    try {
      const url = new URL(value);
      if (!url.hostname || url.hostname === 'localhost' || url.hostname === '127.0.0.1') continue;
      return { baseUrl: `http://${url.hostname}:${port}`, token: envToken };
    } catch {
      continue;
    }
  }

  return null;
}

async function getInitialPairing(): Promise<{
  externalFile: MobileExternalFile | null;
  pairingUrl: string | null;
  devConnection: MobileConnection | null;
}> {
  const initialUrl = await Linking.getInitialURL().catch(() => null);
  const candidates = uniqueStrings([
    initialUrl,
    Constants.linkingUri,
    Constants.experienceUrl,
    Constants.intentUri,
  ]);

  if (candidates.length > 0) {
    console.info('Yoda Mobile initial URL candidates', candidates.map(redactPairingUrl));
  }

  return {
    externalFile: parseMobileExternalFileUrl(initialUrl ?? ''),
    pairingUrl: explicitMobilePairingUrl(initialUrl),
    devConnection: inferDevGatewayConnection(candidates),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function SwipeBackScreen({ children, onBack }: { children: ReactNode; onBack: () => void }) {
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (event, gesture) => {
          const startX = event.nativeEvent.pageX - gesture.dx;
          const horizontal = gesture.dx > SWIPE_BACK_ACTIVATION_DISTANCE;
          const mostlyHorizontal = Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.6;
          return startX <= SWIPE_BACK_EDGE_WIDTH && horizontal && mostlyHorizontal;
        },
        onPanResponderRelease: (_event, gesture) => {
          const completedByDistance =
            gesture.dx >= SWIPE_BACK_MIN_DISTANCE &&
            Math.abs(gesture.dy) <= SWIPE_BACK_MAX_VERTICAL_DISTANCE;
          const completedByVelocity =
            gesture.dx >= SWIPE_BACK_MIN_DISTANCE / 2 && gesture.vx >= SWIPE_BACK_MIN_VELOCITY;
          if (completedByDistance || completedByVelocity) {
            onBack();
          }
        },
        onPanResponderTerminationRequest: () => true,
      }),
    [onBack]
  );

  return (
    <SafeAreaView style={styles.page} {...panResponder.panHandlers}>
      {children}
    </SafeAreaView>
  );
}

export function App() {
  const [booting, setBooting] = useState(true);
  const [connection, setConnection] = useState<MobileConnection | null>(null);
  const [connectDraft, setConnectDraft] = useState<ConnectDraft>({
    baseUrl: 'http://192.168.1.10:3879',
    token: '',
  });
  const [snapshot, setSnapshot] = useState<MobileDashboardSnapshot | null>(null);
  const [profile, setProfile] = useState<MobileProfileSnapshot | null>(null);
  const [mobileConfiguration, setMobileConfiguration] =
    useState<MobileConfigurationSnapshot | null>(null);
  const [mobileConfigurationError, setMobileConfigurationError] = useState<string | null>(null);
  const [demandConfiguration, setDemandConfiguration] = useState<MobileDemandConfiguration | null>(
    null
  );
  const [homeTab, setHomeTab] = useState<HomeTab>(DEFAULT_HOME_TAB);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTaskParent, setNewTaskParent] = useState<MobileTaskSummary | null>(null);
  const [newTaskParentId, setNewTaskParentId] = useState<string | null>(null);
  const [newTaskSiblingOf, setNewTaskSiblingOf] = useState<MobileTaskSummary | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const [taskScope, setTaskScope] = useState<TaskScope>('all');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [openingTaskId, setOpeningTaskId] = useState<string | null>(null);
  const [demandProjectId, setDemandProjectId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [demandImages, setDemandImages] = useState<MobileImageDraft[]>([]);
  const [pendingExternalFile, setPendingExternalFile] = useState<MobileExternalFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [demandUploadProgress, setDemandUploadProgress] =
    useState<MobileInputUploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openTaskRequestRef = useRef(0);

  const applyPairingUrl = useCallback(async (url: string | null) => {
    if (!url) return false;
    const parsedRelayPairing = parseMobileRelayPairingUrl(url);
    const relayPairing = parsedRelayPairing
      ? canonicalizeMobileRelayPairing(parsedRelayPairing)
      : null;
    let next = parseMobilePairingUrl(url);
    if (relayPairing) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), RELAY_PAIR_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(`${relayPairing.relayBaseUrl}/v1/pair`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId: relayPairing.deviceId,
            pairingCode: relayPairing.pairingCode,
          }),
          signal: controller.signal,
        });
      } catch {
        throw new Error('Cannot reach Yoda Relay. Check your network and try a new pairing code.');
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) {
        throw new Error(
          response.status === 402
            ? 'Yoda Relay Pass is not active.'
            : 'Relay pairing code is invalid or expired. Generate a new code on the desktop.'
        );
      }
      const exchanged = (await response.json()) as Partial<MobileConnection>;
      const expectedBaseUrl = `${relayPairing.relayBaseUrl}/v1/devices/${encodeURIComponent(
        relayPairing.deviceId
      )}`;
      if (
        exchanged.baseUrl !== expectedBaseUrl ||
        typeof exchanged.token !== 'string' ||
        !exchanged.token ||
        exchanged.token.length > 512
      ) {
        throw new Error('Yoda Relay returned an invalid pairing response.');
      }
      next = { baseUrl: exchanged.baseUrl, token: exchanged.token };
    }
    if (!next) return false;

    await saveConnection(next);
    setConnectDraft(next);
    setConnection(next);
    setSnapshot(null);
    setProfile(null);
    setHomeTab(DEFAULT_HOME_TAB);
    setNewTaskOpen(false);
    setNewTaskParent(null);
    setNewTaskParentId(null);
    setNewTaskSiblingOf(null);
    setSelectedProjectId('all');
    setTaskScope('all');
    setSelectedTaskId(null);
    setSelectedSessionId(null);
    setError(null);
    return true;
  }, []);

  const handleIncomingUrl = useCallback(
    async (url: string) => {
      if (await applyPairingUrl(url)) return;
      const file = parseMobileExternalFileUrl(url);
      if (file) setPendingExternalFile(file);
    },
    [applyPairingUrl]
  );

  useEffect(() => {
    let active = true;
    Promise.all([loadConnection(), getInitialPairing()])
      .then(async ([saved, initial]) => {
        if (!active) return;
        try {
          if (await applyPairingUrl(initial.pairingUrl)) return;
        } catch (e) {
          if (active) setError(errorMessage(e));
        }
        if (initial.externalFile) setPendingExternalFile(initial.externalFile);
        const fallback = selectMobileConnectionBootstrapFallback(saved, initial.devConnection);
        if (!fallback) return;
        if (fallback.shouldPersist) await saveConnection(fallback.connection);
        if (!active) return;
        setConnection(fallback.connection);
        setConnectDraft(fallback.connection);
      })
      .catch((e: unknown) => {
        if (active) setError(errorMessage(e));
      })
      .finally(() => {
        if (active) setBooting(false);
      });
    return () => {
      active = false;
    };
  }, [applyPairingUrl]);

  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      void handleIncomingUrl(url).catch((e: unknown) => {
        setError(errorMessage(e));
      });
    });
    return () => subscription.remove();
  }, [handleIncomingUrl]);

  useEffect(() => {
    if (!connection || !pendingExternalFile) return;
    const file = pendingExternalFile;
    setPendingExternalFile(null);

    void (async () => {
      try {
        const resolvedFile = await resolveMobileExternalFile(file);
        if (resolvedFile.kind === 'image') {
          const image = await importMobileInputImage(resolvedFile.uri, resolvedFile.name);
          setDemandImages((current) => [...current, image]);
        } else if (resolvedFile.kind === 'text') {
          const content = await readMobileExternalTextFile(resolvedFile);
          setPrompt((current) =>
            current ? `${current}\n\n${content}`.slice(0, MOBILE_SESSION_INPUT_MAX_CHARS) : content
          );
        } else {
          throw new Error('当前支持图片和文本文件，PDF 等格式暂未接入编辑流程。');
        }

        setDemandProjectId(null);
        setNewTaskParent(null);
        setNewTaskParentId(null);
        setNewTaskSiblingOf(null);
        setSelectedTaskId(null);
        setSelectedSessionId(null);
        setHomeTab('tasks');
        setNewTaskOpen(true);
        setError(null);
      } catch (e) {
        setError(`打开文件失败：${errorMessage(e)}`);
      }
    })();
  }, [connection, pendingExternalFile]);

  const loadDashboard = useCallback(
    async (quiet = false) => {
      if (!connection) return;
      if (!quiet) setLoading(true);
      try {
        const next = await fetchSnapshot(connection);
        setSnapshot(next);
        setError(null);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [connection]
  );

  const loadProfile = useCallback(
    async (quiet = false) => {
      if (!connection) return;
      if (!quiet) setProfileLoading(true);
      setProfileError(null);
      try {
        const next = await fetchProfile(connection);
        setProfile(next);
        setProfileError(null);
      } catch (e) {
        setProfileError(errorMessage(e));
      } finally {
        if (!quiet) setProfileLoading(false);
      }
    },
    [connection]
  );

  const loadMobileConfiguration = useCallback(async () => {
    if (!connection) return;
    setMobileConfiguration(null);
    setDemandConfiguration(null);
    setMobileConfigurationError(null);
    try {
      const next = await fetchConfiguration(connection);
      setMobileConfiguration(next);
      setDemandConfiguration(createDefaultMobileDemandConfiguration(next));
    } catch (cause) {
      setMobileConfigurationError(`运行配置读取失败：${errorMessage(cause)}`);
    }
  }, [connection]);

  useEffect(() => {
    if (!connection) {
      setMobileConfiguration(null);
      setMobileConfigurationError(null);
      setDemandConfiguration(null);
      return;
    }
    void loadMobileConfiguration();
  }, [connection, loadMobileConfiguration]);

  useEffect(() => {
    if (!connection) return;
    void loadDashboard(false);
    const timer = setInterval(() => {
      void loadDashboard(true);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [connection, loadDashboard]);

  useEffect(() => {
    if (homeTab !== 'profile' || profile || profileLoading || profileError) return;
    void loadProfile(false);
  }, [homeTab, loadProfile, profile, profileError, profileLoading]);

  const visibleProjects = useMemo(() => {
    const projects = snapshot?.projects.filter((project) => !project.isInternal) ?? [];
    const activityByProjectId = getMobileProjectActivityById(projects, snapshot?.tasks ?? []);
    return projects.map((project) => ({
      ...project,
      lastActivityAt: activityByProjectId.get(project.id) ?? project.updatedAt,
    }));
  }, [snapshot]);

  const openProjectIds = useMemo(
    () =>
      new Set(
        snapshot?.projects.filter((project) => project.isOpen).map((project) => project.id) ?? []
      ),
    [snapshot]
  );

  const filteredTasks = useMemo(() => {
    const tasks = snapshot?.tasks ?? [];
    return tasks.filter((task) => {
      if (selectedProjectId !== 'all' && task.projectId !== selectedProjectId) return false;
      if (taskScope === 'open' && !openProjectIds.has(task.projectId)) return false;
      if (taskScope === 'inProgress' && !isTaskActivityRunning(task.activityStatus)) return false;
      if (taskScope === 'review' && task.activityStatus !== 'review') return false;
      return true;
    });
  }, [openProjectIds, selectedProjectId, snapshot, taskScope]);

  const selectedTask = useMemo(
    () => snapshot?.tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, snapshot]
  );

  useEffect(() => {
    if (!selectedTaskId || selectedTask) return;
    setSelectedTaskId(null);
    setSelectedSessionId(null);
  }, [selectedTask, selectedTaskId]);

  const handleOpenTask = useCallback(
    async (taskId: string) => {
      const task = snapshot?.tasks.find((candidate) => candidate.id === taskId);
      if (!connection || !task) return;

      const requestId = openTaskRequestRef.current + 1;
      openTaskRequestRef.current = requestId;
      setOpeningTaskId(taskId);
      try {
        const response = await fetchTaskSessions(connection, task.projectId, task.id);
        if (requestId !== openTaskRequestRef.current) return;
        const entry = resolveMobileTaskEntry(response.sessions);
        setSelectedTaskId(task.id);
        setSelectedSessionId(entry.kind === 'session' ? entry.sessionId : null);
      } catch {
        if (requestId !== openTaskRequestRef.current) return;
        setSelectedTaskId(task.id);
        setSelectedSessionId(null);
      } finally {
        if (requestId === openTaskRequestRef.current) setOpeningTaskId(null);
      }
    },
    [connection, snapshot]
  );

  const handleConnect = useCallback(async () => {
    const next = {
      baseUrl: connectDraft.baseUrl.trim(),
      token: connectDraft.token.trim(),
    };
    if (!next.baseUrl || !next.token) {
      setError('Gateway URL and token are required.');
      return;
    }

    setLoading(true);
    try {
      await fetchSnapshot(next);
      await saveConnection(next);
      setConnection(next);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [connectDraft]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      loadDashboard(false),
      homeTab === 'profile' ? loadProfile(false) : Promise.resolve(),
    ]);
    setRefreshing(false);
  }, [homeTab, loadDashboard, loadProfile]);

  const openNewTask = useCallback((parentTask: MobileTaskSummary | null = null) => {
    setNewTaskParent(parentTask);
    setNewTaskParentId(parentTask?.id ?? null);
    setNewTaskSiblingOf(null);
    if (parentTask) setDemandProjectId(parentTask.projectId);
    setNewTaskOpen(true);
  }, []);

  const openNewSiblingTask = useCallback(
    (task: MobileTaskSummary) => {
      const attribution = resolveMobileSiblingTaskAttribution(task, snapshot?.tasks ?? []);
      setNewTaskParent(attribution.parentTask);
      setNewTaskParentId(attribution.parentTaskId);
      setNewTaskSiblingOf(task);
      setDemandProjectId(attribution.projectId);
      setNewTaskOpen(true);
    },
    [snapshot?.tasks]
  );

  const closeNewTask = useCallback(() => {
    setNewTaskOpen(false);
    setNewTaskParent(null);
    setNewTaskParentId(null);
    setNewTaskSiblingOf(null);
  }, []);

  const handleSubmitDemand = useCallback(async () => {
    if (!connection || !snapshot || (!prompt.trim() && demandImages.length === 0) || submitting)
      return;
    setSubmitting(true);
    setDemandUploadProgress(null);
    let attachmentIds: string[] = [];
    try {
      attachmentIds = await uploadMobileInputImages(
        connection,
        demandImages,
        setDemandUploadProgress
      );
      setDemandUploadProgress(null);
      const result = await createDemand(connection, {
        projectId: demandProjectId,
        parentTaskId: newTaskParentId ?? undefined,
        prompt: prompt.trim(),
        attachmentIds,
        agentId: demandConfiguration?.agentId,
        provider: demandConfiguration?.runtimeId,
        runMode: demandConfiguration?.runMode,
        strategyKind: demandConfiguration?.strategyKind,
        model: demandConfiguration?.model,
        reasoningEffort: demandConfiguration?.reasoningEffort,
        permissionMode: demandConfiguration?.permissionMode ?? undefined,
      });
      setPrompt('');
      setDemandImages([]);
      let createdSessionId = result.sessionId?.trim();
      if (!createdSessionId) {
        const createdTaskSessions = await fetchTaskSessions(
          connection,
          result.task.projectId,
          result.task.id
        );
        createdSessionId = createdTaskSessions.sessions[0]?.id;
      }
      if (!createdSessionId) {
        throw new Error('The created task did not return a session.');
      }
      const destination = prepareCreatedDemandNavigation(snapshot, result.task, createdSessionId);
      setSnapshot(destination.snapshot);
      setHomeTab(destination.homeTab);
      closeNewTask();
      setTaskScope(destination.taskScope);
      setSelectedProjectId(destination.selectedProjectId);
      setSelectedTaskId(destination.selectedTaskId);
      setSelectedSessionId(destination.selectedSessionId);
      await loadDashboard(true);
      setError(null);
    } catch (e) {
      await Promise.all(
        attachmentIds.map((attachmentId) =>
          discardInputAttachment(connection, attachmentId).catch(() => undefined)
        )
      );
      setError(errorMessage(e));
    } finally {
      setDemandUploadProgress(null);
      setSubmitting(false);
    }
  }, [
    closeNewTask,
    connection,
    demandImages,
    demandConfiguration,
    demandProjectId,
    loadDashboard,
    newTaskParentId,
    prompt,
    snapshot,
    submitting,
  ]);

  const newTaskModal = connection ? (
    <NewTaskModal
      connection={connection}
      configuration={mobileConfiguration}
      configurationError={mobileConfigurationError}
      demandConfiguration={demandConfiguration}
      images={demandImages}
      open={newTaskOpen}
      parentTask={newTaskParent}
      siblingOfTask={newTaskSiblingOf}
      projects={visibleProjects}
      tasks={snapshot?.tasks ?? []}
      prompt={prompt}
      selectedProjectId={demandProjectId}
      submitting={submitting}
      uploadProgress={demandUploadProgress}
      onRetryConfiguration={() => void loadMobileConfiguration()}
      onClose={closeNewTask}
      onAttributionChange={(projectId, parentTask) => {
        setDemandProjectId(projectId);
        setNewTaskParent(parentTask);
        setNewTaskParentId(parentTask?.id ?? null);
        setNewTaskSiblingOf(null);
      }}
      onImagesChange={setDemandImages}
      onMediaError={setError}
      onPromptChange={setPrompt}
      onConfigurationChange={setDemandConfiguration}
      onSubmit={handleSubmitDemand}
    />
  ) : null;

  if (booting) {
    return (
      <SafeAreaView style={styles.page}>
        <StatusBar style="dark" />
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.charcoal} />
        </View>
      </SafeAreaView>
    );
  }

  if (!connection) {
    return (
      <ConnectionScreen
        draft={connectDraft}
        error={error}
        loading={loading}
        onChange={setConnectDraft}
        onConnect={handleConnect}
      />
    );
  }

  if (selectedTask && selectedSessionId) {
    return (
      <SessionDetailScreen
        key={`${connection.baseUrl}\0${connection.token}\0${selectedTask.id}\0${selectedSessionId}`}
        connection={connection}
        configuration={mobileConfiguration}
        projects={snapshot?.projects ?? []}
        sessionId={selectedSessionId}
        task={selectedTask}
        onBack={() => setSelectedSessionId(null)}
      />
    );
  }

  if (selectedTask) {
    return (
      <>
        <TaskSessionsScreen
          connection={connection}
          projects={snapshot?.projects ?? []}
          task={selectedTask}
          onBack={() => {
            setSelectedTaskId(null);
            setSelectedSessionId(null);
          }}
          onOpenSession={(sessionId) => setSelectedSessionId(sessionId)}
          onCreateSubtask={() => openNewTask(selectedTask)}
          onCreateSibling={() => openNewSiblingTask(selectedTask)}
        />
        {newTaskModal}
      </>
    );
  }

  return (
    <SafeAreaView style={styles.page}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.homeShell}>
          <ScrollView
            style={styles.homeScroll}
            contentContainerStyle={styles.homeScrollContent}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                tintColor={COLORS.charcoal}
                onRefresh={handleRefresh}
              />
            }
          >
            <HomeHeader tab={homeTab} />

            {error ? (
              <Notice
                message={error}
                retrying={loading || refreshing}
                tone="error"
                onRetry={handleRefresh}
              />
            ) : null}
            {loading && !snapshot ? <ActivityIndicator color={COLORS.charcoal} /> : null}

            {snapshot ? (
              <>
                {homeTab === 'tasks' ? (
                  <TasksWorkspace
                    projects={snapshot.projects}
                    selectedProjectId={selectedProjectId}
                    selectedScope={taskScope}
                    tasks={filteredTasks}
                    visibleProjects={visibleProjects}
                    openingTaskId={openingTaskId}
                    onOpenTask={handleOpenTask}
                    onSelectProject={(projectId) => {
                      setSelectedProjectId(projectId);
                      setSelectedTaskId(null);
                      setSelectedSessionId(null);
                    }}
                    onSelectScope={setTaskScope}
                  />
                ) : null}

                {homeTab === 'profile' ? (
                  <MyProfileScreen
                    error={profileError}
                    loading={profileLoading}
                    profile={profile}
                    projects={visibleProjects}
                    snapshot={snapshot}
                    onOpenProject={(projectId) => {
                      setSelectedProjectId(projectId);
                      setTaskScope('all');
                      setSelectedTaskId(null);
                      setSelectedSessionId(null);
                      setHomeTab('tasks');
                    }}
                    onOpenTasks={() => {
                      setSelectedProjectId('all');
                      setTaskScope('all');
                      setHomeTab('tasks');
                    }}
                    onDisconnect={() => {
                      void clearConnection();
                      setConnection(null);
                      setSnapshot(null);
                      setProfile(null);
                      setSelectedTaskId(null);
                      setSelectedSessionId(null);
                    }}
                    onRetry={() => void loadProfile(false)}
                  />
                ) : null}
              </>
            ) : null}
          </ScrollView>
          <FloatingNewTaskButton onPress={() => openNewTask()} />
          <HomeTabBar activeTab={homeTab} onSelect={setHomeTab} />
        </View>
      </KeyboardAvoidingView>
      {newTaskModal}
    </SafeAreaView>
  );
}

function ConnectionScreen({
  draft,
  error,
  loading,
  onChange,
  onConnect,
}: {
  draft: ConnectDraft;
  error: string | null;
  loading: boolean;
  onChange: (next: ConnectDraft) => void;
  onConnect: () => void;
}) {
  return (
    <SafeAreaView style={styles.page}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.connectionContent}>
          <YodaBrandMark size={52} />
          <Text style={styles.connectionTitle}>Connect to desktop</Text>
          <Text style={styles.connectionCopy}>
            Scan once from the desktop sidebar. Yoda Mobile securely remembers this device and
            reconnects automatically on future launches. Enter gateway details only for a local or
            development connection.
          </Text>

          {error ? <Notice message={error} tone="error" /> : null}

          <View style={styles.formGroup}>
            <Text style={styles.label}>Gateway URL</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="http://192.168.1.10:3879"
              placeholderTextColor="#9A958C"
              style={styles.input}
              value={draft.baseUrl}
              onChangeText={(baseUrl) => onChange({ ...draft, baseUrl })}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Token</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Desktop gateway token"
              placeholderTextColor="#9A958C"
              secureTextEntry
              style={styles.input}
              value={draft.token}
              onChangeText={(token) => onChange({ ...draft, token })}
            />
          </View>

          <Pressable
            accessibilityLabel="Connect to desktop gateway"
            disabled={loading}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed ? styles.buttonPressed : null,
              loading ? styles.buttonDisabled : null,
            ]}
            onPress={onConnect}
          >
            {loading ? (
              <ActivityIndicator color={COLORS.surface} />
            ) : (
              <>
                <Ionicons color={COLORS.surface} name="phone-portrait-outline" size={18} />
                <Text style={styles.primaryButtonText}>Connect</Text>
              </>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Notice({
  message,
  retrying = false,
  tone,
  onRetry,
}: {
  message: string;
  retrying?: boolean;
  tone: 'error' | 'info';
  onRetry?: () => void | Promise<void>;
}) {
  const color = tone === 'error' ? COLORS.red : COLORS.blue;
  const [copied, setCopied] = useState(false);

  const copyError = useCallback(async () => {
    await Clipboard.setStringAsync(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 1_500);
  }, [message]);

  return (
    <View style={[styles.notice, { borderColor: color }]}>
      <Ionicons
        color={color}
        name={tone === 'error' ? 'alert-circle-outline' : 'information-circle-outline'}
        size={18}
      />
      <Text selectable style={styles.noticeText}>
        {message}
      </Text>
      {tone === 'error' ? (
        <View style={styles.noticeActions}>
          {onRetry ? (
            <Pressable
              accessibilityLabel="Retry loading Yoda gateway"
              accessibilityRole="button"
              disabled={retrying}
              style={({ pressed }) => [
                styles.noticeRetryButton,
                pressed ? styles.buttonPressed : null,
                retrying ? styles.buttonDisabled : null,
              ]}
              onPress={() => void onRetry()}
            >
              {retrying ? (
                <ActivityIndicator color={COLORS.surface} size="small" />
              ) : (
                <Ionicons color={COLORS.surface} name="refresh-outline" size={17} />
              )}
              <Text style={styles.noticeRetryText}>{retrying ? 'Retrying' : 'Retry'}</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel="Copy error message"
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.noticeCopyButton,
              pressed ? styles.buttonPressed : null,
            ]}
            onPress={() => void copyError()}
          >
            <Ionicons
              color={COLORS.muted}
              name={copied ? 'checkmark-outline' : 'copy-outline'}
              size={17}
            />
            <Text style={styles.noticeCopyText}>{copied ? 'Copied' : 'Copy'}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function HomeHeader({ tab }: { tab: HomeTab }) {
  const copy = homeTabTitle(tab);
  return (
    <View style={styles.homeHeader}>
      <Text style={styles.homeTitle}>{copy.title}</Text>
      <Text style={styles.homeSubtitle}>{copy.subtitle}</Text>
    </View>
  );
}

function YodaBrandMark({ size }: { size: number }) {
  return (
    <Image
      accessibilityLabel="Yoda"
      accessibilityRole="image"
      source={yodaMarkSource}
      style={{ width: size, height: size }}
    />
  );
}

function TasksWorkspace({
  projects,
  selectedProjectId,
  selectedScope,
  tasks,
  visibleProjects,
  openingTaskId,
  onOpenTask,
  onSelectProject,
  onSelectScope,
}: {
  projects: MobileProjectSummary[];
  selectedProjectId: string;
  selectedScope: TaskScope;
  tasks: MobileTaskSummary[];
  visibleProjects: MobileProjectSummary[];
  openingTaskId: string | null;
  onOpenTask: (taskId: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelectScope: (scope: TaskScope) => void;
}) {
  return (
    <>
      <TaskScopeControl selectedScope={selectedScope} onSelectScope={onSelectScope} />
      <TaskProjectScopeControl
        projects={visibleProjects}
        selectedProjectId={selectedProjectId}
        onSelect={onSelectProject}
      />
      <TaskList
        projects={projects}
        tasks={tasks}
        title={selectedProjectId === 'all' ? taskScopeLabel(selectedScope) : '项目任务'}
        openingTaskId={openingTaskId}
        onOpenTask={onOpenTask}
      />
    </>
  );
}

function TaskScopeControl({
  selectedScope,
  onSelectScope,
}: {
  selectedScope: TaskScope;
  onSelectScope: (scope: TaskScope) => void;
}) {
  const scopes: Array<{ label: string; value: TaskScope }> = [
    { label: '全部', value: 'all' },
    { label: '已打开', value: 'open' },
    { label: '进行中', value: 'inProgress' },
    { label: '待审阅', value: 'review' },
  ];
  return (
    <View style={styles.scopeControl}>
      {scopes.map((scope) => {
        const active = selectedScope === scope.value;
        return (
          <Pressable
            key={scope.value}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.scopeButton,
              active ? styles.scopeButtonActive : null,
              pressed ? styles.buttonPressed : null,
            ]}
            onPress={() => onSelectScope(scope.value)}
          >
            <Text style={[styles.scopeButtonText, active ? styles.scopeButtonTextActive : null]}>
              {scope.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function MyProfileScreen({
  error,
  loading,
  profile,
  projects,
  snapshot,
  onOpenProject,
  onOpenTasks,
  onDisconnect,
  onRetry,
}: {
  error: string | null;
  loading: boolean;
  profile: MobileProfileSnapshot | null;
  projects: MobileProjectSummary[];
  snapshot: MobileDashboardSnapshot;
  onOpenProject: (projectId: string) => void;
  onOpenTasks: () => void;
  onDisconnect: () => void;
  onRetry: () => void;
}) {
  const account = profile?.account;
  const relay = profile?.cloud.relay;
  const tokenUsage = formatTokenUsage(profile?.usage.totalTokens ?? null);
  const recentProjects = sortMobileProjects(projects, 'recent').slice(0, 3);
  const displayName = account?.displayName || 'Yoda 用户';
  const avatarInitial = displayName.slice(0, 1).toLocaleUpperCase();

  return (
    <View style={styles.profileScreen}>
      {error ? <Notice message={error} retrying={loading} tone="error" onRetry={onRetry} /> : null}

      <View style={styles.profileAccountCard}>
        <View style={styles.profileAccountMain}>
          <View style={styles.profileAvatar}>
            {account?.avatarUrl ? (
              <Image source={{ uri: account.avatarUrl }} style={styles.profileAvatarImage} />
            ) : (
              <Text style={styles.profileAvatarText}>{avatarInitial}</Text>
            )}
          </View>
          <View style={styles.profileAccountText}>
            <Text style={styles.profileAccountName} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={styles.profileAccountMeta} numberOfLines={1}>
              {account?.email || '在桌面端登录 LovStudio 以启用云端服务'}
            </Text>
          </View>
        </View>
        <View
          style={[
            styles.profileStatePill,
            account?.state === 'signed-in' ? styles.profileStatePillActive : null,
          ]}
        >
          <Text
            style={[
              styles.profileStateText,
              account?.state === 'signed-in' ? styles.profileStateTextActive : null,
            ]}
          >
            {account ? accountStateLabel(account.state) : loading ? '正在加载' : '暂不可用'}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>工作概览</Text>
          <Pressable accessibilityRole="button" onPress={onOpenTasks}>
            <Text style={styles.sectionAction}>查看任务</Text>
          </Pressable>
        </View>
        <View style={styles.profileMetricsGrid}>
          <ProfileMetric
            icon="folder-open-outline"
            label="项目"
            value={snapshot.metrics.projectCount}
          />
          <ProfileMetric
            icon="flash-outline"
            label="进行中"
            value={snapshot.metrics.inProgressTaskCount}
          />
          <ProfileMetric
            icon="checkmark-done-outline"
            label="待审阅"
            value={snapshot.metrics.reviewTaskCount}
          />
        </View>
        <View style={styles.profileProjectList}>
          {recentProjects.length === 0 ? (
            <Text style={styles.profileEmptyText}>还没有可查看的项目。</Text>
          ) : (
            recentProjects.map((project) => (
              <Pressable
                key={project.id}
                accessibilityLabel={`查看项目 ${project.displayName}`}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.profileProjectRow,
                  pressed ? styles.buttonPressed : null,
                ]}
                onPress={() => onOpenProject(project.id)}
              >
                <Ionicons
                  color={project.isOpen ? COLORS.green : COLORS.muted}
                  name={project.isOpen ? 'desktop-outline' : 'folder-outline'}
                  size={18}
                />
                <Text style={styles.profileProjectName} numberOfLines={1}>
                  {project.displayName}
                </Text>
                <Text style={styles.profileProjectState}>
                  {project.isOpen ? '已打开' : '未打开'}
                </Text>
                <Ionicons color={COLORS.muted} name="chevron-forward-outline" size={16} />
              </Pressable>
            ))
          )}
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>本地用量</Text>
          <Text style={styles.sectionMeta}>来自此桌面的会话记录</Text>
        </View>
        <View style={styles.profileUsageCard}>
          <View style={styles.profileUsagePrimary}>
            <Text style={styles.profileUsageLabel}>累计处理</Text>
            <View style={styles.profileUsageReading}>
              <Text style={styles.profileUsageValue}>{tokenUsage.amount}</Text>
              <Text style={styles.profileUsageUnit}>{tokenUsage.unit}</Text>
            </View>
          </View>
          <View style={styles.profileUsageDivider} />
          <View style={styles.profileUsageStats}>
            <ProfileDataCell
              label="会话"
              value={profile ? formatReadableNumber(profile.usage.sessionCount) : '—'}
            />
            <ProfileDataCell
              label="已完成任务"
              value={profile ? formatReadableNumber(profile.usage.tasksArchived) : '—'}
            />
            <ProfileDataCell
              label="代码变更"
              value={profile ? `+${formatReadableNumber(profile.usage.linesAdded)}` : '—'}
              detail={profile ? `−${formatReadableNumber(profile.usage.linesDeleted)}` : undefined}
              tone="positive"
            />
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>登录与同步</Text>
          <Text style={styles.sectionMeta}>当前设备</Text>
        </View>
        <View style={styles.profileCloudCard}>
          <CloudStatusRow
            icon="person-circle-outline"
            label="LovStudio 账户"
            value={account ? accountStateLabel(account.state) : '暂不可用'}
            detail={account?.email || '在桌面端登录后可使用同步与云端服务'}
            active={account?.state === 'signed-in'}
          />
          <View style={styles.profileCloudDivider} />
          <CloudStatusRow
            icon="desktop-outline"
            label="当前桌面"
            value="已连接"
            detail="此手机正在同步这台 Yoda 桌面设备"
            active
          />
          <View style={styles.profileCloudDivider} />
          <CloudStatusRow
            icon="cloud-done-outline"
            label="设置同步"
            value={
              profile?.cloud.settings.signedIn
                ? profile.cloud.settings.autoSyncEnabled
                  ? '自动同步已开启'
                  : '自动同步已关闭'
                : '登录后可用'
            }
            detail={`最近同步：${formatProfileTime(profile?.cloud.settings.lastSyncedAt ?? null)}`}
            active={Boolean(
              profile?.cloud.settings.signedIn && profile.cloud.settings.autoSyncEnabled
            )}
          />
          <Pressable
            accessibilityLabel="断开当前桌面"
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.disconnectDesktopButton,
              pressed ? styles.buttonPressed : null,
            ]}
            onPress={onDisconnect}
          >
            <Ionicons color={COLORS.muted} name="log-out-outline" size={17} />
            <Text style={styles.disconnectDesktopButtonText}>断开当前桌面</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>云端服务</Text>
          <Text style={styles.sectionMeta}>桌面端统一管理</Text>
        </View>
        <View style={styles.profileCloudCard}>
          <CloudStatusRow
            icon="radio-outline"
            label="Yoda Relay"
            value={relay ? relayStateLabel(relay.status) : '登录后可用'}
            detail={
              relay
                ? `${relay.onlineDeviceCount} / ${relay.deviceCount} 台设备在线${relay.accessEndsAt ? ` · 有效至 ${formatProfileTime(relay.accessEndsAt)}` : ''}`
                : '让手机在外网也能连接这台桌面设备'
            }
            active={relay?.status === 'active' || relay?.status === 'trial'}
          />
        </View>
      </View>
    </View>
  );
}

function ProfileMetric({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: number;
}) {
  return (
    <View style={styles.profileMetric}>
      <Ionicons color={COLORS.muted} name={icon} size={17} />
      <Text style={styles.profileMetricValue}>{value}</Text>
      <Text style={styles.profileMetricLabel}>{label}</Text>
    </View>
  );
}

function ProfileDataCell({
  detail,
  label,
  tone = 'default',
  value,
}: {
  detail?: string;
  label: string;
  tone?: 'default' | 'positive';
  value: string;
}) {
  return (
    <View style={styles.profileDataCell}>
      <Text
        style={[
          styles.profileDataValue,
          tone === 'positive' ? styles.profileDataValuePositive : null,
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
      {detail ? <Text style={styles.profileDataDetail}>{detail}</Text> : null}
      <Text style={styles.profileDataLabel}>{label}</Text>
    </View>
  );
}

function CloudStatusRow({
  active,
  detail,
  icon,
  label,
  value,
}: {
  active: boolean;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.profileCloudRow}>
      <View style={[styles.profileCloudIcon, active ? styles.profileCloudIconActive : null]}>
        <Ionicons color={active ? COLORS.green : COLORS.muted} name={icon} size={18} />
      </View>
      <View style={styles.profileCloudBody}>
        <Text style={styles.profileCloudLabel}>{label}</Text>
        <Text style={styles.profileCloudDetail} numberOfLines={2}>
          {detail}
        </Text>
      </View>
      <Text style={[styles.profileCloudValue, active ? styles.profileCloudValueActive : null]}>
        {value}
      </Text>
    </View>
  );
}

function FloatingNewTaskButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel="新建任务"
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.floatingNewTaskButton,
        pressed ? styles.floatingNewTaskButtonPressed : null,
      ]}
      onPress={onPress}
    >
      <Ionicons color={COLORS.surface} name="add-outline" size={26} />
    </Pressable>
  );
}

function HomeTabBar({
  activeTab,
  onSelect,
}: {
  activeTab: HomeTab;
  onSelect: (tab: HomeTab) => void;
}) {
  return (
    <View style={styles.bottomTabBar}>
      {HOME_TABS.map((tab) => {
        const active = activeTab === tab.value;
        return (
          <Pressable
            key={tab.value}
            accessibilityLabel={tab.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              styles.bottomTabItem,
              active ? styles.bottomTabItemActive : null,
              pressed ? styles.buttonPressed : null,
            ]}
            onPress={() => onSelect(tab.value)}
          >
            <Ionicons color={active ? COLORS.surface : COLORS.muted} name={tab.icon} size={19} />
            <Text style={[styles.bottomTabLabel, active ? styles.bottomTabLabelActive : null]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function TaskProjectScopeControl({
  projects,
  selectedProjectId,
  onSelect,
}: {
  projects: MobileProjectSummary[];
  selectedProjectId: string;
  onSelect: (projectId: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const isAllProjects = selectedProjectId === 'all';
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>项目范围</Text>
      </View>
      <Pressable
        accessibilityLabel={`选择任务项目范围，当前${isAllProjects ? '所有项目' : (selectedProject?.displayName ?? '所有项目')}`}
        accessibilityRole="button"
        style={({ pressed }) => [styles.taskProjectScope, pressed ? styles.buttonPressed : null]}
        onPress={() => setPickerOpen(true)}
      >
        <View style={styles.taskProjectScopeIcon}>
          <Ionicons color={COLORS.charcoal} name="folder-open-outline" size={19} />
        </View>
        <View style={styles.taskProjectScopeBody}>
          <Text style={styles.taskProjectScopeLabel} numberOfLines={1}>
            {isAllProjects ? '所有项目' : (selectedProject?.displayName ?? '所有项目')}
          </Text>
          <Text style={styles.taskProjectScopeMeta} numberOfLines={1}>
            {isAllProjects ? '不限定项目，可随时切换' : '仅查看这个项目中的任务'}
          </Text>
        </View>
        <Ionicons color={COLORS.muted} name="chevron-down-outline" size={20} />
      </Pressable>
      <ProjectPickerSheet
        eyebrow="任务范围"
        open={pickerOpen}
        projects={projects}
        selectedProjectId={isAllProjects ? null : selectedProjectId}
        title="选择项目范围"
        unscopedOption={{
          icon: 'layers-outline',
          label: '所有项目',
          meta: '不限定项目',
        }}
        onClose={() => setPickerOpen(false)}
        onProjectChange={(projectId) => {
          onSelect(projectId ?? 'all');
          setPickerOpen(false);
        }}
      />
    </View>
  );
}

function DemandComposer({
  connection,
  configuration,
  configurationError,
  demandConfiguration,
  images,
  parentTask,
  projects,
  prompt,
  selectedProjectId,
  submitting,
  tasks,
  uploadProgress,
  onAttributionChange,
  onPromptChange,
  onImagesChange,
  onMediaError,
  onConfigurationChange,
  onRetryConfiguration,
  onSubmit,
}: {
  connection: MobileConnection;
  configuration: MobileConfigurationSnapshot | null;
  configurationError: string | null;
  demandConfiguration: MobileDemandConfiguration | null;
  images: MobileImageDraft[];
  parentTask: MobileTaskSummary | null;
  projects: MobileProjectSummary[];
  prompt: string;
  selectedProjectId: string | null;
  submitting: boolean;
  tasks: MobileTaskSummary[];
  uploadProgress: MobileInputUploadProgress | null;
  onAttributionChange: (projectId: string | null, parentTask: MobileTaskSummary | null) => void;
  onPromptChange: (prompt: string) => void;
  onImagesChange: (images: MobileImageDraft[]) => void;
  onMediaError: (message: string) => void;
  onConfigurationChange: (configuration: MobileDemandConfiguration) => void;
  onRetryConfiguration: () => void;
  onSubmit: () => void;
}) {
  const [attributionPickerMode, setAttributionPickerMode] = useState<'project' | 'task' | null>(
    null
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const imagesEnabled = selectedProjectId === null || selectedProject?.type === 'local';
  const canSubmit =
    (prompt.trim().length > 0 || images.length > 0) &&
    (images.length === 0 || imagesEnabled) &&
    !submitting;
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>任务说明</Text>
      </View>
      <Pressable
        accessibilityLabel="配置 Agent、模型和开发方式"
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.composerConfigurationCard,
          pressed ? styles.buttonPressed : null,
        ]}
        onPress={() => {
          Keyboard.dismiss();
          setSettingsOpen(true);
        }}
      >
        <View style={styles.composerConfigurationIcon}>
          <Ionicons color={COLORS.blue} name="options-outline" size={18} />
        </View>
        <View style={styles.composerConfigurationBody}>
          <Text style={styles.composerConfigurationLabel}>执行配置</Text>
          <Text style={styles.composerConfigurationValue} numberOfLines={1}>
            {demandConfiguration
              ? `${configuration?.agents.find((agent) => agent.id === demandConfiguration.agentId)?.name ?? '默认 Agent'} · ${mobileRuntimeName(configuration, demandConfiguration.runtimeId)}`
              : '读取 Agent、模型和开发方式'}
          </Text>
          <Text style={styles.composerConfigurationMeta} numberOfLines={1}>
            {demandConfiguration
              ? `${demandConfiguration.runMode === 'brainstorm' ? '方案讨论' : '普通开发'} · ${demandConfiguration.strategyKind === 'new-branch' ? '新建分支' : '当前项目'}`
              : '点击查看'}
          </Text>
        </View>
        <Ionicons color={COLORS.muted} name="chevron-forward-outline" size={19} />
      </Pressable>
      <MobileDemandSettingsSheet
        configuration={configuration}
        configurationError={configurationError}
        open={settingsOpen}
        value={demandConfiguration}
        onChange={onConfigurationChange}
        onClose={() => setSettingsOpen(false)}
        onRetryConfiguration={onRetryConfiguration}
      />
      <InputMediaControls
        connection={connection}
        disabled={submitting}
        images={images}
        imagesEnabled={imagesEnabled}
        contextSelectors={[
          {
            accessibilityLabel: `切换项目，当前${selectedProject?.displayName ?? '草稿箱'}`,
            icon: 'folder-outline',
            label: '项目',
            value: selectedProject?.displayName ?? '草稿箱',
            onPress: () => {
              Keyboard.dismiss();
              setAttributionPickerMode('project');
            },
          },
          {
            accessibilityLabel: parentTask
              ? `切换上级任务，当前${parentTask.name}`
              : selectedProjectId
                ? '选择上级任务，当前为独立任务'
                : '草稿箱不支持选择上级任务',
            disabled: selectedProjectId === null,
            icon: 'git-branch-outline',
            label: '上级任务',
            value: parentTask?.name ?? (selectedProjectId ? '独立任务' : '无'),
            onPress: () => {
              Keyboard.dismiss();
              setAttributionPickerMode('task');
            },
          },
        ]}
        speechContext={[selectedProject?.displayName, selectedProject?.name, parentTask?.name]}
        skillContext={{ projectId: selectedProjectId ?? undefined }}
        value={prompt}
        onChange={onPromptChange}
        onError={onMediaError}
        onImagesChange={onImagesChange}
        input={
          <TextInput
            maxLength={MOBILE_SESSION_INPUT_MAX_CHARS}
            multiline
            placeholder="描述你想完成的工作…"
            placeholderTextColor="#9A958C"
            style={styles.composerTextInput}
            textAlignVertical="top"
            value={prompt}
            onChangeText={onPromptChange}
          />
        }
      />
      {attributionPickerMode ? (
        <TaskAttributionPickerSheet
          mode={attributionPickerMode}
          parentTask={parentTask}
          projects={projects}
          selectedProjectId={selectedProjectId}
          tasks={tasks}
          onClose={() => setAttributionPickerMode(null)}
          onChange={(projectId, nextParentTask) => {
            onAttributionChange(projectId, nextParentTask);
            setAttributionPickerMode(null);
          }}
        />
      ) : null}
      <Pressable
        accessibilityLabel="Submit new mobile request"
        accessibilityRole="button"
        disabled={!canSubmit}
        style={({ pressed }) => [
          styles.primaryButton,
          !canSubmit ? styles.buttonDisabled : null,
          pressed ? styles.buttonPressed : null,
        ]}
        onPress={onSubmit}
      >
        {submitting ? (
          <>
            <ActivityIndicator color={COLORS.surface} />
            <Text style={styles.primaryButtonText}>
              {uploadProgress ? mobileInputUploadLabel(uploadProgress) : '正在创建…'}
            </Text>
          </>
        ) : (
          <>
            <Ionicons color={COLORS.surface} name="arrow-up-outline" size={18} />
            <Text style={styles.primaryButtonText}>开始任务</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

type MobileDropdownOption = {
  value: string;
  label: string;
  description?: string;
  icon?: string;
};

const MOBILE_PROJECT_SORT_OPTIONS: readonly MobileDropdownOption[] = [
  { value: 'recent', label: '最近活动', description: '优先显示最近有变化的项目' },
  { value: 'name', label: '名称', description: '按项目名称排序' },
  { value: 'open', label: '已打开', description: '优先显示当前已打开的项目' },
];

const MOBILE_TASK_SORT_OPTIONS: readonly MobileDropdownOption[] = [
  { value: 'recent', label: '最近更新', description: '最近有互动或状态变化的任务在前' },
  { value: 'created', label: '创建顺序', description: '按创建时间排列，后创建的任务在前' },
];

const MOBILE_REASONING_EFFORT_OPTIONS: readonly MobileDropdownOption[] = [
  { value: 'none', label: '无', description: '不额外增加推理预算 · none' },
  { value: 'minimal', label: '极低', description: '快速完成简单任务 · minimal' },
  { value: 'low', label: '低', description: '轻量分析 · low' },
  { value: 'medium', label: '中', description: '平衡速度与分析深度 · medium' },
  { value: 'high', label: '高', description: '更充分地分析复杂任务 · high' },
  { value: 'xhigh', label: '极高', description: '优先分析深度 · xhigh' },
  { value: 'max', label: '最大', description: '使用客户端允许的最大深度 · max' },
  { value: 'ultra', label: '超高', description: '使用 ultra 推理档位 · ultra' },
];

function mobileReasoningEffortOptions(current: string | null): MobileDropdownOption[] {
  const currentValue = current?.trim() || null;
  if (
    !currentValue ||
    currentValue === 'inherit' ||
    MOBILE_REASONING_EFFORT_OPTIONS.some((option) => option.value === currentValue)
  ) {
    return [
      {
        value: 'inherit',
        label: '客户端默认',
        description: '使用当前客户端的默认推理深度',
      },
      ...MOBILE_REASONING_EFFORT_OPTIONS,
    ];
  }
  return [
    {
      value: 'inherit',
      label: '客户端默认',
      description: '使用当前客户端的默认推理深度',
    },
    { value: currentValue, label: currentValue, description: '当前已保存的自定义值' },
    ...MOBILE_REASONING_EFFORT_OPTIONS,
  ];
}

function MobileDropdownMenu({
  accessibilityLabel,
  label,
  onChange,
  options,
  value,
}: {
  accessibilityLabel?: string;
  label: string;
  onChange: (value: string) => void;
  options: readonly MobileDropdownOption[];
  value: string | null;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <>
      <Pressable
        accessibilityLabel={accessibilityLabel ?? `${label}，当前${selected?.label ?? '未选择'}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [
          styles.mobileDropdownTrigger,
          pressed ? styles.buttonPressed : null,
        ]}
        onPress={() => {
          Keyboard.dismiss();
          setOpen(true);
        }}
      >
        <View style={styles.mobileDropdownTriggerBody}>
          <Text style={styles.mobileDropdownLabel}>{label}</Text>
          <Text numberOfLines={1} style={styles.mobileDropdownValue}>
            {selected?.label ?? '未选择'}
          </Text>
        </View>
        <Ionicons color={COLORS.muted} name="chevron-down-outline" size={18} />
      </Pressable>

      <Modal
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        transparent
        visible={open}
        onRequestClose={() => setOpen(false)}
      >
        <View accessibilityViewIsModal style={styles.mobileDropdownOverlay}>
          <Pressable
            accessible={false}
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
          />
          <SafeAreaView style={styles.mobileDropdownSheet}>
            <View style={styles.projectPickerHandle} />
            <View style={styles.mobileDropdownHeader}>
              <Text style={styles.mobileDropdownTitle}>{label}</Text>
              <Pressable
                accessibilityLabel={`关闭${label}菜单`}
                accessibilityRole="button"
                hitSlop={8}
                style={({ pressed }) => [
                  styles.mobileDropdownClose,
                  pressed ? styles.buttonPressed : null,
                ]}
                onPress={() => setOpen(false)}
              >
                <Ionicons color={COLORS.charcoal} name="close-outline" size={20} />
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.mobileDropdownContent}
              keyboardShouldPersistTaps="handled"
            >
              {options.map((option) => {
                const selectedOption = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityLabel={`选择${label} ${option.label}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selectedOption }}
                    style={({ pressed }) => [
                      styles.mobileDropdownOption,
                      selectedOption ? styles.mobileDropdownOptionSelected : null,
                      pressed ? styles.buttonPressed : null,
                    ]}
                    onPress={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    {option.icon ? (
                      <Text style={styles.mobileDropdownOptionIcon}>{option.icon}</Text>
                    ) : null}
                    <View style={styles.mobileDropdownOptionBody}>
                      <Text style={styles.mobileDropdownOptionLabel}>{option.label}</Text>
                      {option.description ? (
                        <Text numberOfLines={2} style={styles.mobileDropdownOptionDescription}>
                          {option.description}
                        </Text>
                      ) : null}
                    </View>
                    <Ionicons
                      color={selectedOption ? COLORS.blue : COLORS.line}
                      name={selectedOption ? 'checkmark-circle' : 'ellipse-outline'}
                      size={20}
                    />
                  </Pressable>
                );
              })}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

function MobileDemandSettingsSheet({
  configuration,
  configurationError,
  open,
  value,
  onChange,
  onClose,
  onRetryConfiguration,
}: {
  configuration: MobileConfigurationSnapshot | null;
  configurationError: string | null;
  open: boolean;
  value: MobileDemandConfiguration | null;
  onChange: (configuration: MobileDemandConfiguration) => void;
  onClose: () => void;
  onRetryConfiguration: () => void;
}) {
  const selectedAgent = configuration?.agents.find((agent) => agent.id === value?.agentId);
  const permissionModes = value ? (configuration?.permissionModes[value.runtimeId] ?? []) : [];
  const update = (patch: Partial<MobileDemandConfiguration>) => {
    if (value) onChange({ ...value, ...patch });
  };

  return (
    <Modal
      animationType="slide"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={open}
      onRequestClose={onClose}
    >
      <View accessibilityViewIsModal style={styles.projectPickerOverlay}>
        <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView style={styles.mobileDemandSettingsSheet}>
          <View style={styles.projectPickerHandle} />
          <View style={styles.projectPickerHeader}>
            <View style={styles.projectPickerTitleBlock}>
              <Text style={styles.projectPickerEyebrow}>开始任务前</Text>
              <Text style={styles.projectPickerTitle}>执行配置</Text>
            </View>
            <Pressable
              accessibilityLabel="关闭执行配置"
              accessibilityRole="button"
              hitSlop={8}
              style={({ pressed }) => [
                styles.projectPickerClose,
                pressed ? styles.buttonPressed : null,
              ]}
              onPress={onClose}
            >
              <Ionicons color={COLORS.charcoal} name="close-outline" size={22} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.mobileDemandSettingsContent}
            keyboardShouldPersistTaps="handled"
          >
            {!configuration || !value ? (
              configurationError ? (
                <Notice message={configurationError} tone="error" onRetry={onRetryConfiguration} />
              ) : (
                <View style={styles.emptyState}>
                  <ActivityIndicator color={COLORS.charcoal} />
                  <Text style={styles.emptyText}>正在读取可用配置…</Text>
                </View>
              )
            ) : (
              <>
                <Text style={styles.mobileSettingsHint}>
                  本次任务会携带以下配置；开始后可在会话里查看并调整模型参数。
                </Text>

                <View style={styles.mobileSettingsGroup}>
                  <MobileDropdownMenu
                    accessibilityLabel={`选择 Agent，当前${selectedAgent?.name ?? '未选择'}`}
                    label="Agent"
                    options={configuration.agents.map((agent) => ({
                      value: agent.id,
                      label: agent.name,
                      description:
                        agent.description ||
                        mobileRuntimeName(configuration, agent.preferredRuntime),
                      icon: agent.icon || '◎',
                    }))}
                    value={value.agentId}
                    onChange={(agentId) => {
                      const agent = configuration.agents.find(
                        (candidate) => candidate.id === agentId
                      );
                      if (!agent) return;
                      const runtimeId = agent.preferredRuntime;
                      onChange({
                        ...value,
                        agentId: agent.id,
                        runtimeId,
                        model: agent.model,
                        reasoningEffort: agent.reasoningEffort,
                        permissionMode: resolveMobilePermissionMode(
                          configuration,
                          agent,
                          runtimeId
                        ),
                      });
                    }}
                  />
                </View>

                <View style={styles.mobileSettingsGroup}>
                  <MobileDropdownMenu
                    label="开发模式"
                    options={[
                      {
                        value: 'normal',
                        label: '普通开发',
                        description: '直接进入实现与验证流程',
                      },
                      {
                        value: 'brainstorm',
                        label: '方案讨论',
                        description: '先整理目标、步骤和验收方式',
                      },
                    ]}
                    value={value.runMode}
                    onChange={(runMode) =>
                      update({ runMode: runMode as MobileDemandConfiguration['runMode'] })
                    }
                  />
                </View>

                <View style={styles.mobileSettingsGroup}>
                  <MobileDropdownMenu
                    label="开发方式"
                    options={[
                      {
                        value: 'no-worktree',
                        label: '当前项目',
                        description: '直接在当前工作目录中继续',
                      },
                      {
                        value: 'new-branch',
                        label: '新建分支',
                        description: '从当前分支创建独立工作分支',
                      },
                    ]}
                    value={value.strategyKind}
                    onChange={(strategyKind) =>
                      update({
                        strategyKind: strategyKind as MobileDemandConfiguration['strategyKind'],
                      })
                    }
                  />
                </View>

                <View style={styles.mobileSettingsGroup}>
                  <MobileDropdownMenu
                    label="Agent 客户端"
                    options={configuration.runtimes.map((runtime) => ({
                      value: runtime.id,
                      label: runtime.name,
                      description: runtime.id,
                    }))}
                    value={value.runtimeId}
                    onChange={(runtimeId) =>
                      update({
                        runtimeId: runtimeId as MobileDemandConfiguration['runtimeId'],
                        permissionMode: resolveMobilePermissionMode(
                          configuration,
                          selectedAgent,
                          runtimeId as MobileDemandConfiguration['runtimeId']
                        ),
                      })
                    }
                  />
                </View>

                <View style={styles.mobileSettingsGroup}>
                  <Text style={styles.mobileSettingsGroupTitle}>模型</Text>
                  <TextInput
                    autoCapitalize="none"
                    placeholder="使用客户端默认模型"
                    placeholderTextColor={COLORS.muted}
                    style={styles.mobileSettingsTextInput}
                    value={value.model ?? ''}
                    onChangeText={(model) => update({ model: model.trim() || null })}
                  />
                  <Text style={styles.mobileSettingsFootnote}>留空时使用客户端默认模型。</Text>
                </View>

                <View style={styles.mobileSettingsGroup}>
                  <MobileDropdownMenu
                    label="推理深度"
                    options={mobileReasoningEffortOptions(value.reasoningEffort)}
                    value={value.reasoningEffort ?? 'inherit'}
                    onChange={(reasoningEffort) =>
                      update({
                        reasoningEffort: reasoningEffort === 'inherit' ? null : reasoningEffort,
                      })
                    }
                  />
                  <Text style={styles.mobileSettingsFootnote}>
                    仅在客户端支持时生效；选择客户端默认时使用默认深度。
                  </Text>
                </View>

                <View style={styles.mobileSettingsGroup}>
                  {permissionModes.length > 0 ? (
                    <MobileDropdownMenu
                      label="权限模式"
                      options={permissionModes.map((mode) => ({
                        value: mode.id,
                        label: mode.label,
                        description:
                          mode.description ||
                          (mode.danger ? '执行时减少确认步骤' : '保留客户端的常规确认流程'),
                      }))}
                      value={value.permissionMode}
                      onChange={(permissionMode) => update({ permissionMode })}
                    />
                  ) : null}
                </View>

                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed ? styles.buttonPressed : null,
                  ]}
                  onPress={onClose}
                >
                  <Ionicons color={COLORS.surface} name="checkmark-outline" size={18} />
                  <Text style={styles.primaryButtonText}>完成配置</Text>
                </Pressable>
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function NewTaskModal({
  open,
  onClose,
  parentTask = null,
  siblingOfTask = null,
  ...composerProps
}: Omit<Parameters<typeof DemandComposer>[0], 'onSubmit'> & {
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
  parentTask?: MobileTaskSummary | null;
  siblingOfTask?: MobileTaskSummary | null;
}) {
  return (
    <Modal
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={open}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        accessibilityViewIsModal
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.newTaskOverlay}
      >
        <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView style={styles.newTaskWindow}>
          <View style={styles.newTaskWindowHeader}>
            <View style={styles.newTaskWindowHeaderTitleBlock}>
              <Text style={styles.newTaskWindowEyebrow}>
                {siblingOfTask ? '新建同级任务' : parentTask ? '新建子任务' : '新建任务'}
              </Text>
              <Text style={styles.newTaskWindowTitle} numberOfLines={2}>
                开始一项工作
              </Text>
            </View>
            <Pressable
              accessibilityLabel="关闭新建任务窗口"
              accessibilityRole="button"
              hitSlop={8}
              style={({ pressed }) => [
                styles.newTaskWindowClose,
                pressed ? styles.buttonPressed : null,
              ]}
              onPress={onClose}
            >
              <Ionicons color={COLORS.charcoal} name="close-outline" size={22} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.newTaskWindowContent}
            keyboardShouldPersistTaps="handled"
          >
            <DemandComposer {...composerProps} parentTask={parentTask} />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function TaskAttributionPickerSheet({
  mode,
  parentTask,
  projects,
  selectedProjectId,
  tasks,
  onChange,
  onClose,
}: {
  mode: 'project' | 'task';
  parentTask: MobileTaskSummary | null;
  projects: MobileProjectSummary[];
  selectedProjectId: string | null;
  tasks: MobileTaskSummary[];
  onChange: (projectId: string | null, parentTask: MobileTaskSummary | null) => void;
  onClose: () => void;
}) {
  const [sortMode, setSortMode] = useState<MobileProjectSortMode>('recent');
  const [searchQuery, setSearchQuery] = useState('');
  const sortedProjects = useMemo(
    () => sortMobileProjects(projects, sortMode),
    [projects, sortMode]
  );
  const visibleProjects = useMemo(
    () => filterMobileProjects(sortedProjects, searchQuery),
    [searchQuery, sortedProjects]
  );
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const taskStatsByProjectId = useMemo(() => {
    const stats = new Map<string, { count: number; longTermCount: number }>();
    for (const task of tasks) {
      const current = stats.get(task.projectId) ?? { count: 0, longTermCount: 0 };
      current.count += 1;
      if (task.isLongTerm) current.longTermCount += 1;
      stats.set(task.projectId, current);
    }
    return stats;
  }, [tasks]);
  const visibleTasks = useMemo(() => {
    const sortedTasks = sortMobileTaskAttributionCandidates(
      tasks.filter((task) => task.projectId === selectedProjectId)
    );
    return filterMobileTasks(sortedTasks, searchQuery);
  }, [searchQuery, selectedProjectId, tasks]);
  const selectedProjectTaskCount = tasks.filter(
    (task) => task.projectId === selectedProjectId
  ).length;

  return (
    <Modal
      animationType="slide"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible
      onRequestClose={onClose}
    >
      <View accessibilityViewIsModal style={styles.projectPickerOverlay}>
        <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView style={styles.projectPickerSheet}>
          <View style={styles.projectPickerHandle} />
          <View style={styles.projectPickerHeader}>
            <View style={styles.attributionPickerHeaderLead}>
              <View style={styles.projectPickerTitleBlock}>
                <Text style={styles.projectPickerEyebrow}>
                  {mode === 'project' ? '任务项目' : '任务层级'}
                </Text>
                <Text style={styles.projectPickerTitle} numberOfLines={1}>
                  {mode === 'project'
                    ? '切换项目'
                    : `选择${selectedProject ? `「${selectedProject.displayName}」的` : ''}上级任务`}
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityLabel="关闭任务归属选择"
              accessibilityRole="button"
              hitSlop={8}
              style={({ pressed }) => [
                styles.projectPickerClose,
                pressed ? styles.buttonPressed : null,
              ]}
              onPress={onClose}
            >
              <Ionicons color={COLORS.charcoal} name="close-outline" size={22} />
            </Pressable>
          </View>

          <ProjectPickerSearchInput
            placeholder={mode === 'project' ? '搜索项目' : '搜索任务'}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />

          {mode === 'task' ? (
            <View style={styles.attributionPickerStepHint}>
              <Text style={styles.attributionPickerStepHintText}>
                选择“独立任务”，或将新任务放在一个已有任务之下
              </Text>
            </View>
          ) : (
            <View style={styles.projectPickerSort}>
              <MobileDropdownMenu
                label="项目排序"
                options={MOBILE_PROJECT_SORT_OPTIONS}
                value={sortMode}
                onChange={(mode) => setSortMode(mode as MobileProjectSortMode)}
              />
            </View>
          )}

          <ScrollView
            contentContainerStyle={styles.projectPickerList}
            keyboardShouldPersistTaps="handled"
            style={styles.projectPickerListViewport}
          >
            {mode === 'task' ? (
              <>
                {!searchQuery.trim() && selectedProject ? (
                  <AttributionPickerOption
                    icon="folder-outline"
                    label="独立任务"
                    meta={`直接创建在「${selectedProject.displayName}」项目下`}
                    selected={!parentTask}
                    onPress={() => onChange(selectedProject.id, null)}
                  />
                ) : null}
                {visibleTasks.map((task) => (
                  <AttributionPickerOption
                    key={task.id}
                    icon={task.isLongTerm ? 'infinite-outline' : 'git-branch-outline'}
                    label={task.name}
                    meta={`${task.isLongTerm ? '长期任务 · ' : ''}创建为它的子任务 · ${formatTimestamp(task.lastInteractedAt ?? task.updatedAt)}`}
                    selected={parentTask?.id === task.id}
                    onPress={() => onChange(task.projectId, task)}
                  />
                ))}
                {visibleTasks.length === 0 ? (
                  <View style={styles.attributionPickerEmpty}>
                    <Ionicons
                      color={COLORS.muted}
                      name={searchQuery.trim() ? 'search-outline' : 'git-branch-outline'}
                      size={22}
                    />
                    <Text style={styles.emptyText}>
                      {searchQuery.trim() && selectedProjectTaskCount > 0
                        ? `没有匹配“${searchQuery.trim()}”的任务`
                        : '这个项目还没有可选择的上级任务。'}
                    </Text>
                  </View>
                ) : null}
              </>
            ) : (
              <>
                {!searchQuery.trim() ? (
                  <AttributionPickerOption
                    icon="documents-outline"
                    label="草稿箱"
                    meta="不归属具体项目"
                    selected={selectedProjectId === null && !parentTask}
                    onPress={() => onChange(null, null)}
                  />
                ) : null}
                {visibleProjects.map((project) => {
                  const taskStats = taskStatsByProjectId.get(project.id) ?? {
                    count: 0,
                    longTermCount: 0,
                  };
                  return (
                    <AttributionPickerOption
                      key={project.id}
                      icon={project.isOpen ? 'desktop-outline' : 'folder-outline'}
                      label={project.displayName}
                      meta={`${taskStats.count} 个任务${taskStats.longTermCount > 0 ? ` · ${taskStats.longTermCount} 个长期任务` : ''}`}
                      selected={selectedProjectId === project.id}
                      onPress={() => onChange(project.id, null)}
                    />
                  );
                })}
                {visibleProjects.length === 0 ? (
                  <ProjectPickerEmptyResult query={searchQuery} type="项目" />
                ) : null}
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function AttributionPickerOption({
  icon,
  label,
  meta,
  selected,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  meta: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`${label}，${meta}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.projectPickerOption,
        selected ? styles.projectPickerOptionSelected : null,
        pressed ? styles.buttonPressed : null,
      ]}
      onPress={onPress}
    >
      <View
        style={[
          styles.projectPickerOptionIcon,
          selected ? styles.projectPickerOptionIconSelected : null,
        ]}
      >
        <Ionicons color={selected ? COLORS.surface : COLORS.muted} name={icon} size={17} />
      </View>
      <View style={styles.projectPickerOptionBody}>
        <Text style={styles.projectPickerOptionLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.projectPickerOptionMeta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      {selected ? <Ionicons color={COLORS.charcoal} name="checkmark-circle" size={20} /> : null}
    </Pressable>
  );
}

function ProjectPickerSheet({
  eyebrow,
  open,
  projects,
  selectedProjectId,
  title,
  unscopedOption,
  onClose,
  onProjectChange,
}: {
  eyebrow: string;
  open: boolean;
  projects: MobileProjectSummary[];
  selectedProjectId: string | null;
  title: string;
  unscopedOption: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    meta: string;
  };
  onClose: () => void;
  onProjectChange: (projectId: string | null) => void;
}) {
  const [sortMode, setSortMode] = useState<MobileProjectSortMode>('recent');
  const [searchQuery, setSearchQuery] = useState('');
  const sortedProjects = useMemo(
    () => sortMobileProjects(projects, sortMode),
    [projects, sortMode]
  );
  const visibleProjects = useMemo(
    () => filterMobileProjects(sortedProjects, searchQuery),
    [searchQuery, sortedProjects]
  );
  const closePicker = () => {
    setSearchQuery('');
    onClose();
  };
  const selectProject = (projectId: string | null) => {
    setSearchQuery('');
    onProjectChange(projectId);
  };
  return (
    <Modal
      animationType="slide"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={open}
      onRequestClose={closePicker}
    >
      <View accessibilityViewIsModal style={styles.projectPickerOverlay}>
        <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={closePicker} />
        <SafeAreaView style={styles.projectPickerSheet}>
          <View style={styles.projectPickerHandle} />
          <View style={styles.projectPickerHeader}>
            <View style={styles.projectPickerTitleBlock}>
              <Text style={styles.projectPickerEyebrow}>{eyebrow}</Text>
              <Text style={styles.projectPickerTitle}>{title}</Text>
            </View>
            <Pressable
              accessibilityLabel="关闭项目选择"
              accessibilityRole="button"
              hitSlop={8}
              style={({ pressed }) => [
                styles.projectPickerClose,
                pressed ? styles.buttonPressed : null,
              ]}
              onPress={closePicker}
            >
              <Ionicons color={COLORS.charcoal} name="close-outline" size={22} />
            </Pressable>
          </View>
          <ProjectPickerSearchInput
            placeholder="搜索项目"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          <View style={styles.projectPickerSort}>
            <MobileDropdownMenu
              label="项目排序"
              options={MOBILE_PROJECT_SORT_OPTIONS}
              value={sortMode}
              onChange={(mode) => setSortMode(mode as MobileProjectSortMode)}
            />
          </View>
          <ScrollView
            accessibilityRole="radiogroup"
            contentContainerStyle={styles.projectPickerList}
            keyboardShouldPersistTaps="handled"
            style={styles.projectPickerListViewport}
          >
            {!searchQuery.trim() ? (
              <ProjectPickerOption
                icon={unscopedOption.icon}
                label={unscopedOption.label}
                meta={unscopedOption.meta}
                selected={selectedProjectId === null}
                onPress={() => selectProject(null)}
              />
            ) : null}
            {visibleProjects.map((project) => (
              <ProjectPickerOption
                key={project.id}
                icon={project.isOpen ? 'desktop-outline' : 'folder-outline'}
                label={project.displayName}
                meta={`Active ${formatTimestamp(project.lastActivityAt ?? project.updatedAt)}`}
                selected={selectedProjectId === project.id}
                onPress={() => selectProject(project.id)}
              />
            ))}
            {visibleProjects.length === 0 ? (
              <ProjectPickerEmptyResult query={searchQuery} type="项目" />
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function ProjectPickerSearchInput({
  compact = false,
  placeholder,
  value,
  onChangeText,
}: {
  compact?: boolean;
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
}) {
  return (
    <View
      style={[
        styles.projectPickerSearchArea,
        compact ? styles.projectPickerSearchAreaCompact : null,
      ]}
    >
      <View style={styles.projectPickerSearchField}>
        <Ionicons color={COLORS.muted} name="search-outline" size={18} />
        <TextInput
          accessibilityLabel={placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="never"
          placeholder={placeholder}
          placeholderTextColor="#8A8D91"
          returnKeyType="search"
          style={styles.projectPickerSearchInput}
          value={value}
          onChangeText={onChangeText}
        />
        {value.length > 0 ? (
          <Pressable
            accessibilityLabel={`清除${placeholder}`}
            accessibilityRole="button"
            hitSlop={8}
            style={({ pressed }) => [
              styles.projectPickerSearchClear,
              pressed ? styles.buttonPressed : null,
            ]}
            onPress={() => onChangeText('')}
          >
            <Ionicons color={COLORS.muted} name="close-circle" size={18} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function ProjectPickerEmptyResult({ query, type }: { query: string; type: '项目' | '任务' }) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return null;
  return (
    <View style={styles.attributionPickerEmpty}>
      <Ionicons color={COLORS.muted} name="search-outline" size={22} />
      <Text style={styles.emptyText}>{`没有匹配“${trimmedQuery}”的${type}`}</Text>
    </View>
  );
}

function ProjectPickerOption({
  icon,
  label,
  meta,
  selected,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  meta: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`${label}, ${meta}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      style={({ pressed }) => [
        styles.projectPickerOption,
        selected ? styles.projectPickerOptionSelected : null,
        pressed ? styles.buttonPressed : null,
      ]}
      onPress={onPress}
    >
      <View
        style={[
          styles.projectPickerOptionIcon,
          selected ? styles.projectPickerOptionIconSelected : null,
        ]}
      >
        <Ionicons color={selected ? COLORS.surface : COLORS.muted} name={icon} size={17} />
      </View>
      <View style={styles.projectPickerOptionBody}>
        <Text style={styles.projectPickerOptionLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.projectPickerOptionMeta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      {selected ? <Ionicons color={COLORS.charcoal} name="checkmark-circle" size={20} /> : null}
    </Pressable>
  );
}

function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  onBack,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  onBack: () => void;
}) {
  return (
    <View style={styles.screenHeader}>
      <Pressable
        accessibilityLabel="Go back"
        accessibilityRole="button"
        style={styles.backButton}
        onPress={onBack}
      >
        <Ionicons color={COLORS.charcoal} name="chevron-back-outline" size={22} />
      </Pressable>
      <View style={styles.screenTitleBlock}>
        <Text style={styles.kicker}>{eyebrow}</Text>
        <Text style={styles.screenTitle} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.screenSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

function taskSessionCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'session' : 'sessions'}`;
}

function TaskContextCard({
  expanded,
  projectLabel,
  task,
  onToggle,
}: {
  expanded: boolean;
  projectLabel: string;
  task: MobileTaskSummary;
  onToggle: () => void;
}) {
  const activityColor = statusColor(task.activityStatus);
  return (
    <View style={styles.taskContextCard}>
      <Pressable
        accessibilityLabel={expanded ? '收起任务信息' : '展开任务信息'}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={({ pressed }) => [styles.taskContextHeader, pressed ? styles.buttonPressed : null]}
        onPress={onToggle}
      >
        <View style={styles.taskContextIcon}>
          <Ionicons color={COLORS.charcoal} name="layers-outline" size={19} />
        </View>
        <View style={styles.taskContextBody}>
          <Text style={styles.taskContextKicker}>任务信息</Text>
          <Text style={styles.taskContextTitle} numberOfLines={2}>
            {task.name}
          </Text>
          <Text style={styles.taskContextMeta} numberOfLines={1}>
            {projectLabel} · {taskSessionCountLabel(task.conversationCount)}
          </Text>
        </View>
        <View style={styles.taskContextTrailing}>
          <View style={[styles.statusPill, { borderColor: activityColor }]}>
            <Text style={[styles.statusText, { color: activityColor }]}>
              {statusLabel(task.activityStatus)}
            </Text>
          </View>
          <Ionicons
            color={COLORS.muted}
            name={expanded ? 'chevron-up-outline' : 'chevron-down-outline'}
            size={18}
          />
        </View>
      </Pressable>
      {expanded ? (
        <View style={styles.taskContextDetails}>
          <DetailItem label="状态" value={statusLabel(task.status)} />
          <DetailItem label="项目" value={projectLabel} />
          <DetailItem label="分支" value={task.taskBranch ?? 'No branch'} />
          <DetailItem
            label="Providers"
            value={Object.keys(task.runtimeCounts).join(', ') || 'None'}
          />
          <DetailItem label="Updated" value={formatTimestamp(task.updatedAt)} />
        </View>
      ) : null}
    </View>
  );
}

function TaskSessionsScreen({
  connection,
  projects,
  task,
  onBack,
  onCreateSubtask,
  onCreateSibling,
  onOpenSession,
}: {
  connection: MobileConnection;
  projects: MobileProjectSummary[];
  task: MobileTaskSummary;
  onBack: () => void;
  onCreateSubtask: () => void;
  onCreateSibling: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const [sessions, setSessions] = useState<MobileSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskInfoExpanded, setTaskInfoExpanded] = useState(true);

  const loadSessions = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const next = await fetchTaskSessions(connection, task.projectId, task.id);
        setSessions(next.sessions);
        setError(null);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [connection, task.id, task.projectId]
  );

  useEffect(() => {
    let active = true;
    const run = async (quiet = false) => {
      if (!active) return;
      await loadSessions(quiet);
    };
    void run(false);
    const timer = setInterval(() => void run(true), SESSION_LIST_POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [loadSessions]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSessions(false);
    setRefreshing(false);
  }, [loadSessions]);

  return (
    <SwipeBackScreen onBack={onBack}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={COLORS.charcoal}
            onRefresh={handleRefresh}
          />
        }
      >
        <ScreenHeader
          eyebrow="Task"
          subtitle={projectName(projects, task.projectId)}
          title={task.name}
          onBack={onBack}
        />

        {error ? <Notice message={error} tone="error" /> : null}

        <TaskContextCard
          expanded={taskInfoExpanded}
          projectLabel={projectName(projects, task.projectId)}
          task={task}
          onToggle={() => setTaskInfoExpanded((current) => !current)}
        />

        <TaskCreationActions
          taskName={task.name}
          onCreateSibling={onCreateSibling}
          onCreateSubtask={onCreateSubtask}
        />

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Sessions</Text>
            <Text style={styles.sectionMeta}>{sessions.length}</Text>
          </View>
          {loading && sessions.length === 0 ? (
            <ActivityIndicator color={COLORS.charcoal} />
          ) : sessions.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons color={COLORS.muted} name="chatbubbles-outline" size={22} />
              <Text style={styles.emptyText}>No sessions yet.</Text>
            </View>
          ) : (
            sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                onPress={() => onOpenSession(session.id)}
              />
            ))
          )}
        </View>
      </ScrollView>
    </SwipeBackScreen>
  );
}

function TaskCreationActions({
  taskName,
  onCreateSibling,
  onCreateSubtask,
}: {
  taskName: string;
  onCreateSibling: () => void;
  onCreateSubtask: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const createSibling = () => {
    setMenuOpen(false);
    onCreateSibling();
  };

  return (
    <View style={styles.taskCreationActions}>
      <Pressable
        accessibilityLabel="新建子任务并启动 Session"
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.primaryButton,
          styles.taskCreationPrimary,
          pressed ? styles.buttonPressed : null,
        ]}
        onPress={onCreateSubtask}
      >
        <Ionicons color={COLORS.surface} name="add-circle-outline" size={18} />
        <Text style={styles.primaryButtonText}>新建子任务</Text>
      </Pressable>
      <Pressable
        accessibilityLabel="更多新建任务选项"
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.taskCreationMoreButton,
          pressed ? styles.buttonPressed : null,
        ]}
        onPress={() => setMenuOpen(true)}
      >
        <Ionicons color={COLORS.charcoal} name="ellipsis-horizontal" size={22} />
      </Pressable>
      <Modal
        animationType="slide"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        transparent
        visible={menuOpen}
        onRequestClose={() => setMenuOpen(false)}
      >
        <View accessibilityViewIsModal style={styles.projectPickerOverlay}>
          <Pressable
            accessible={false}
            style={StyleSheet.absoluteFill}
            onPress={() => setMenuOpen(false)}
          />
          <SafeAreaView style={styles.taskCreationMenuSheet}>
            <View style={styles.projectPickerHandle} />
            <View style={styles.taskCreationMenuHeader}>
              <View style={styles.projectPickerTitleBlock}>
                <Text style={styles.projectPickerEyebrow}>新建任务</Text>
                <Text style={styles.taskCreationMenuTitle}>选择任务层级</Text>
              </View>
              <Pressable
                accessibilityLabel="关闭新建任务选项"
                accessibilityRole="button"
                hitSlop={8}
                style={({ pressed }) => [
                  styles.projectPickerClose,
                  pressed ? styles.buttonPressed : null,
                ]}
                onPress={() => setMenuOpen(false)}
              >
                <Ionicons color={COLORS.charcoal} name="close-outline" size={22} />
              </Pressable>
            </View>
            <Pressable
              accessibilityLabel={`新建与${taskName}同级的任务`}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.taskCreationMenuOption,
                pressed ? styles.buttonPressed : null,
              ]}
              onPress={createSibling}
            >
              <View style={styles.taskCreationMenuOptionIcon}>
                <Ionicons color={COLORS.charcoal} name="git-branch-outline" size={20} />
              </View>
              <View style={styles.taskCreationMenuOptionBody}>
                <Text style={styles.taskCreationMenuOptionLabel}>新建同级任务</Text>
                <Text style={styles.taskCreationMenuOptionMeta} numberOfLines={2}>
                  与「{taskName}」保持同一层级，并启动 Session
                </Text>
              </View>
              <Ionicons color={COLORS.muted} name="chevron-forward-outline" size={20} />
            </Pressable>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

function SessionRow({ session, onPress }: { session: MobileSessionSummary; onPress: () => void }) {
  const color = runtimeColor(session.runtimeStatus);
  return (
    <Pressable
      accessibilityLabel={`Open session ${session.title}`}
      accessibilityRole="button"
      style={({ pressed }) => [styles.sessionRow, pressed ? styles.buttonPressed : null]}
      onPress={onPress}
    >
      <View style={styles.sessionTopLine}>
        <Text style={styles.sessionName} numberOfLines={2}>
          {session.title}
        </Text>
        <View style={[styles.statusPill, { borderColor: color }]}>
          <Text style={[styles.statusText, { color }]}>{runtimeLabel(session.runtimeStatus)}</Text>
        </View>
      </View>
      <View style={styles.taskMetaLine}>
        <MetaItem icon="hardware-chip-outline" label={session.runtimeId} />
        <MetaItem
          icon={session.running ? 'radio-outline' : 'pause-circle-outline'}
          label={session.running ? 'Live' : session.resumable ? 'Ready' : 'Stopped'}
        />
        <MetaItem
          icon="time-outline"
          label={formatTimestamp(session.lastInteractedAt ?? session.updatedAt)}
        />
      </View>
      <View style={styles.rowDisclosure}>
        <Text style={styles.rowDisclosureText}>{session.sessionTitle ?? session.sessionId}</Text>
        <Ionicons color={COLORS.muted} name="chevron-forward-outline" size={16} />
      </View>
    </Pressable>
  );
}

function SessionDetailScreen({
  connection,
  configuration,
  projects,
  sessionId,
  task,
  onBack,
}: {
  connection: MobileConnection;
  configuration: MobileConfigurationSnapshot | null;
  projects: MobileProjectSummary[];
  sessionId: string;
  task: MobileTaskSummary;
  onBack: () => void;
}) {
  const scrollViewRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const isAtBottomRef = useRef(true);
  const [detail, setDetail] = useState<MobileSessionDetail | null>(null);
  const [outputMode, setOutputMode] = useState<SessionOutputMode>(
    DEFAULT_SESSION_DISPLAY_PREFERENCES.outputMode
  );
  const [replyDisplayLevel, setReplyDisplayLevel] = useState<AgentReplyDisplayLevel>(
    DEFAULT_SESSION_DISPLAY_PREFERENCES.replyDisplayLevel
  );
  const [displaySettingsOpen, setDisplaySettingsOpen] = useState(false);
  const [runtimeSettingsSaving, setRuntimeSettingsSaving] = useState(false);
  const [runtimeModelDraft, setRuntimeModelDraft] = useState('');
  const [runtimeReasoningDraft, setRuntimeReasoningDraft] = useState('');
  const [runtimePermissionDraft, setRuntimePermissionDraft] = useState('');
  const [taskInfoExpanded, setTaskInfoExpanded] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [sessionInput, setSessionInput] = useState('');
  const [sessionImages, setSessionImages] = useState<MobileImageDraft[]>([]);
  const [sendingInput, setSendingInput] = useState(false);
  const [sessionInputIssue, setSessionInputIssue] = useState<SessionInputIssue | null>(null);
  const [sessionUploadProgress, setSessionUploadProgress] =
    useState<MobileInputUploadProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const mountedRef = useRef(true);
  const sendingInputRef = useRef(false);
  const pendingSessionInputRef = useRef<PendingSessionInput | null>(null);
  const detailRefreshQueueRef = useRef<{
    dirty: boolean;
    showLoading: boolean;
    inFlight: Promise<void> | null;
    controller: AbortController | null;
  }>({ dirty: false, showLoading: false, inFlight: null, controller: null });

  const setBottomState = useCallback((next: boolean) => {
    isAtBottomRef.current = next;
    setIsAtBottom((current) => (current === next ? current : next));
  }, []);

  useEffect(() => {
    let active = true;
    void loadSessionDisplayPreferences()
      .then((preferences) => {
        if (!active) return;
        setOutputMode(preferences.outputMode);
        setReplyDisplayLevel(preferences.replyDisplayLevel);
      })
      .catch((cause) => {
        if (active) setError(`显示设置读取失败：${errorMessage(cause)}`);
      });
    return () => {
      active = false;
    };
  }, []);

  const updateDisplayPreferences = useCallback(
    (next: { outputMode?: SessionOutputMode; replyDisplayLevel?: AgentReplyDisplayLevel }) => {
      const preferences = {
        outputMode: next.outputMode ?? outputMode,
        replyDisplayLevel: next.replyDisplayLevel ?? replyDisplayLevel,
      };
      setOutputMode(preferences.outputMode);
      setReplyDisplayLevel(preferences.replyDisplayLevel);
      void saveSessionDisplayPreferences(preferences).catch((cause) => {
        setError(`显示设置保存失败：${errorMessage(cause)}`);
      });
    },
    [outputMode, replyDisplayLevel]
  );

  const scrollToBottom = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollViewRef.current?.scrollToEnd({ animated });
      });
    });
  }, []);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
      setBottomState(distanceFromBottom <= SESSION_DETAIL_BOTTOM_THRESHOLD);
    },
    [setBottomState]
  );

  const handleScrollToBottomPress = useCallback(() => {
    setBottomState(true);
    scrollToBottom(true);
  }, [scrollToBottom, setBottomState]);

  const loadDetail = useCallback(
    function requestDetail(quiet = false): Promise<void> {
      const queue = detailRefreshQueueRef.current;
      if (!mountedRef.current) return Promise.resolve();
      queue.dirty = true;
      if (!quiet) queue.showLoading = true;
      if (queue.inFlight) return queue.inFlight;

      const run = async () => {
        while (queue.dirty) {
          queue.dirty = false;
          const showLoading = queue.showLoading;
          queue.showLoading = false;
          if (showLoading && mountedRef.current) setLoading(true);
          const controller = new AbortController();
          let timedOut = false;
          queue.controller = controller;
          const timeout = setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, SESSION_DETAIL_REQUEST_TIMEOUT_MS);
          try {
            const next = await fetchSessionDetail(
              connection,
              task.projectId,
              task.id,
              sessionId,
              controller.signal
            );
            if (!mountedRef.current) continue;
            setDetail(next);
            setError(null);
          } catch (e) {
            if (!controller.signal.aborted && mountedRef.current) setError(errorMessage(e));
            if (timedOut && mountedRef.current) setError('Session refresh timed out. Retrying…');
          } finally {
            clearTimeout(timeout);
            if (queue.controller === controller) queue.controller = null;
            if (showLoading && mountedRef.current) setLoading(false);
          }
        }
      };
      const promise = run().finally(() => {
        if (queue.inFlight !== promise) return;
        queue.inFlight = null;
        if (queue.dirty && mountedRef.current) void requestDetail(true);
      });
      queue.inFlight = promise;
      return promise;
    },
    [connection, sessionId, task.id, task.projectId]
  );

  useEffect(() => {
    mountedRef.current = true;
    const queue = detailRefreshQueueRef.current;
    return () => {
      mountedRef.current = false;
      queue.dirty = false;
      queue.controller?.abort();
      queue.controller = null;
    };
  }, []);

  useEffect(() => {
    void loadDetail(false);
  }, [loadDetail]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (appState !== 'active') {
      const queue = detailRefreshQueueRef.current;
      queue.dirty = false;
      queue.controller?.abort();
      queue.controller = null;
      return;
    }
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void loadDetail(true);
      }, SESSION_EVENT_REFRESH_DELAY_MS);
    };
    const unsubscribe = subscribeSessionEvents(connection, task.projectId, task.id, sessionId, {
      onInvalidated: (event) => {
        const runtimeStatus = event.runtimeStatus;
        if (runtimeStatus) {
          setDetail((current) =>
            current?.session.id === event.conversationId
              ? {
                  ...current,
                  session: { ...current.session, runtimeStatus },
                }
              : current
          );
        }
        scheduleRefresh();
      },
    });
    const reconcileTimer = setInterval(
      () => void loadDetail(true),
      SESSION_DETAIL_RECONCILE_INTERVAL_MS
    );
    return () => {
      unsubscribe();
      if (refreshTimer) clearTimeout(refreshTimer);
      clearInterval(reconcileTimer);
    };
  }, [appState, connection, loadDetail, sessionId, task.id, task.projectId]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadDetail(false);
    setRefreshing(false);
  }, [loadDetail]);

  const openSessionSettings = useCallback(() => {
    setRuntimeModelDraft(detail?.session.model ?? '');
    setRuntimeReasoningDraft(detail?.session.reasoningEffort ?? '');
    setRuntimePermissionDraft(detail?.session.permissionMode ?? '');
    setDisplaySettingsOpen(true);
  }, [detail]);

  const handleApplyRuntimeConfiguration = useCallback(
    async (update: MobileSessionRuntimeConfigurationUpdate) => {
      setRuntimeSettingsSaving(true);
      try {
        await updateSessionRuntimeConfiguration(
          connection,
          task.projectId,
          task.id,
          sessionId,
          update
        );
        await loadDetail(false);
        setDisplaySettingsOpen(false);
        setError(null);
      } catch (cause) {
        setError(`运行配置应用失败：${errorMessage(cause)}`);
      } finally {
        setRuntimeSettingsSaving(false);
      }
    },
    [connection, loadDetail, sessionId, task.id, task.projectId]
  );

  const sessionCanContinue = canContinueMobileSession(detail?.session);
  const handleSendInput = useCallback(
    async (inputOverride?: string) => {
      const composerInput = inputOverride === undefined;
      const input = (inputOverride ?? sessionInput).trim();
      const images = composerInput ? sessionImages : [];
      if ((!input && images.length === 0) || !sessionCanContinue || sendingInputRef.current) return;

      sendingInputRef.current = true;
      setSendingInput(true);
      setSessionUploadProgress(null);
      setSessionInputIssue(null);
      const imageIds = images.map((image) => image.id);
      let pending = pendingSessionInputRef.current;
      if (!pending || pending.input !== input || !sameStringArray(pending.imageIds, imageIds)) {
        pending = {
          attachmentIds: null,
          imageIds,
          input,
          requestId: createMobileSessionInputRequestId(),
        };
        pendingSessionInputRef.current = pending;
      }
      try {
        if (pending.attachmentIds === null) {
          pending.attachmentIds = await uploadMobileInputImages(
            connection,
            images,
            setSessionUploadProgress
          );
        }
        setSessionUploadProgress(null);
        const response = await sendSessionInput(connection, task.projectId, task.id, sessionId, {
          input,
          attachmentIds: pending.attachmentIds,
          clientRequestId: pending.requestId,
        });
        if (response.requestId && response.requestId !== pending.requestId) {
          throw new Error('桌面端返回了不匹配的发送请求编号。');
        }
        pendingSessionInputRef.current = null;
        setSessionInput('');
        setSessionImages([]);
        setBottomState(true);
        await loadDetail(true);
        scrollToBottom(true);
        setError(null);
      } catch (e) {
        const cause = errorMessage(e);
        setSessionInputIssue({
          message: '消息尚未确认送达，输入内容已保留。',
          detail: [
            cause,
            `requestId=${pending.requestId}`,
            `projectId=${task.projectId}`,
            `taskId=${task.id}`,
            `sessionId=${sessionId}`,
          ].join('\n'),
        });
      } finally {
        sendingInputRef.current = false;
        setSessionUploadProgress(null);
        setSendingInput(false);
      }
    },
    [
      connection,
      loadDetail,
      scrollToBottom,
      sessionCanContinue,
      sessionId,
      sessionImages,
      sessionInput,
      setBottomState,
      task.id,
      task.projectId,
    ]
  );

  const handleSessionInputChange = useCallback((value: string) => {
    const pending = pendingSessionInputRef.current;
    if (pending && pending.input !== value.trim()) pendingSessionInputRef.current = null;
    setSessionInputIssue(null);
    setSessionInput(value);
  }, []);

  const handleSessionImagesChange = useCallback((images: MobileImageDraft[]) => {
    const pending = pendingSessionInputRef.current;
    const imageIds = images.map((image) => image.id);
    if (pending && !sameStringArray(pending.imageIds, imageIds)) {
      pendingSessionInputRef.current = null;
    }
    setSessionInputIssue(null);
    setSessionImages(images);
  }, []);

  const session = detail?.session;
  const taskProject = projects.find((project) => project.id === task.projectId);
  const output = stripInternalAgentReplyMetadata(detail?.content.trimEnd() ?? '');
  const latestTranscriptBlockId = detail?.transcript[detail.transcript.length - 1]?.id;

  useEffect(() => {
    if (!detail) return;
    if (isAtBottomRef.current) scrollToBottom(true);
  }, [
    detail,
    detail?.contentLength,
    detail?.generatedAt,
    latestTranscriptBlockId,
    outputMode,
    scrollToBottom,
  ]);

  return (
    <SwipeBackScreen onBack={onBack}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.sessionDetailShell}>
          <SessionNavigationBar
            acceptsInput={detail?.session.acceptsInput ?? false}
            live={detail?.session.running ?? false}
            projectLabel={projectName(projects, task.projectId)}
            resumable={detail?.session.resumable ?? false}
            runtimeStatus={detail?.session.runtimeStatus ?? null}
            sending={sendingInput}
            title={session?.title ?? task.name}
            uploadProgress={sessionUploadProgress}
            onBack={onBack}
            onOpenSettings={openSessionSettings}
          />
          <ScrollView
            ref={scrollViewRef}
            contentContainerStyle={styles.scrollContent}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                tintColor={COLORS.charcoal}
                onRefresh={handleRefresh}
              />
            }
            scrollEventThrottle={80}
            onContentSizeChange={() => {
              if (detail && isAtBottomRef.current) scrollToBottom(true);
            }}
            onScroll={handleScroll}
          >
            {error ? <Notice message={error} tone="error" /> : null}
            {loading && !detail ? <ActivityIndicator color={COLORS.charcoal} /> : null}

            {detail ? (
              <>
                <TaskContextCard
                  expanded={taskInfoExpanded}
                  projectLabel={taskProject?.displayName ?? projectName(projects, task.projectId)}
                  task={task}
                  onToggle={() => setTaskInfoExpanded((current) => !current)}
                />
                <View style={styles.summaryPanel}>
                  <DetailItem
                    label="Agent"
                    value={detail.session.agent?.name ?? detail.session.runtimeId}
                  />
                  <DetailItem label="客户端" value={detail.session.runtimeId} />
                  <DetailItem label="模型" value={detail.session.model ?? '客户端默认'} />
                  <DetailItem
                    label="推理深度"
                    value={detail.session.reasoningEffort ?? '客户端默认'}
                  />
                  <DetailItem
                    label="权限模式"
                    value={detail.session.permissionMode ?? '客户端默认'}
                  />
                  <DetailItem label="状态" value={runtimeLabel(detail.session.runtimeStatus)} />
                  <DetailItem label="来源" value={contentSourceLabel(detail.source)} />
                  <DetailItem
                    label="Updated"
                    value={formatTimestamp(detail.session.lastInteractedAt ?? detail.generatedAt)}
                  />
                </View>
                <View style={styles.outputHeader}>
                  <Text style={styles.sectionTitle}>Transcript</Text>
                  <Text style={styles.sectionMeta}>
                    {detail.transcriptTruncated ? 'Recent ' : ''}
                    {detail.transcript.length} updates
                  </Text>
                </View>
                {outputMode === 'rendered' ? (
                  <RenderedSessionTranscript
                    detail={detail}
                    displayLevel={replyDisplayLevel}
                    fallbackOutput={output}
                  />
                ) : (
                  <RawSessionOutput output={output} />
                )}
              </>
            ) : null}
          </ScrollView>
          {detail && !isAtBottom ? (
            <Pressable
              accessibilityLabel="Scroll to bottom"
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.scrollToBottomButton,
                pressed ? styles.buttonPressed : null,
              ]}
              onPress={handleScrollToBottomPress}
            >
              <Ionicons color={COLORS.surface} name="arrow-down-outline" size={17} />
            </Pressable>
          ) : null}
          {detail?.pendingInteraction ? (
            <SessionQuestionCard
              key={detail.pendingInteraction.id}
              disabled={sendingInput || !sessionCanContinue}
              interaction={detail.pendingInteraction}
              onSubmit={(answer) => void handleSendInput(answer)}
            />
          ) : null}
          {sessionInputIssue ? (
            <SessionInputFailureNotice
              detail={sessionInputIssue.detail}
              message={sessionInputIssue.message}
              retrying={sendingInput}
              onRetry={handleSendInput}
            />
          ) : null}
          <SessionInputComposer
            acceptsInput={detail?.session.acceptsInput ?? false}
            connection={connection}
            resumable={detail?.session.resumable ?? false}
            runtimeId={session?.runtimeId}
            images={sessionImages}
            imagesEnabled={
              projects.find((project) => project.id === task.projectId)?.type === 'local'
            }
            sending={sendingInput}
            sessionId={sessionId}
            speechContext={[
              taskProject?.displayName,
              taskProject?.name,
              task.name,
              session?.title,
              session?.runtimeId,
            ]}
            value={sessionInput}
            projectId={task.projectId}
            taskId={task.id}
            onChange={handleSessionInputChange}
            onError={(message) =>
              setSessionInputIssue({
                message: '输入内容处理失败，请检查后重试。',
                detail: `${message}\nprojectId=${task.projectId}\ntaskId=${task.id}\nsessionId=${sessionId}`,
              })
            }
            onImagesChange={handleSessionImagesChange}
            onSend={handleSendInput}
          />
          <SessionDisplaySettingsSheet
            configuration={configuration}
            displayLevel={replyDisplayLevel}
            open={displaySettingsOpen}
            outputMode={outputMode}
            runtimeSettingsSaving={runtimeSettingsSaving}
            model={runtimeModelDraft}
            reasoningEffort={runtimeReasoningDraft}
            permissionMode={runtimePermissionDraft}
            session={session ?? null}
            onClose={() => setDisplaySettingsOpen(false)}
            onModelChange={setRuntimeModelDraft}
            onReasoningEffortChange={setRuntimeReasoningDraft}
            onPermissionModeChange={setRuntimePermissionDraft}
            onDisplayLevelChange={(nextLevel) =>
              updateDisplayPreferences({ replyDisplayLevel: nextLevel })
            }
            onApplyRuntimeConfiguration={handleApplyRuntimeConfiguration}
            onOutputModeChange={(nextMode) => updateDisplayPreferences({ outputMode: nextMode })}
          />
        </View>
      </KeyboardAvoidingView>
    </SwipeBackScreen>
  );
}

function SessionQuestionCard({
  disabled,
  interaction,
  onSubmit,
}: {
  disabled: boolean;
  interaction: MobileSessionInteraction;
  onSubmit: (answer: string) => void;
}) {
  const [selections, setSelections] = useState<MobileSessionInteractionSelections>({});
  const hasOptions = interaction.questions.some((question) => question.options.length > 0);
  const allChoiceQuestionsAnswered = interaction.questions.every(
    (question) => question.options.length === 0 || (selections[question.id]?.length ?? 0) > 0
  );
  const answer = useMemo(
    () => buildMobileSessionInteractionAnswer(interaction, selections),
    [interaction, selections]
  );
  const canSubmit = hasOptions && allChoiceQuestionsAnswered && answer.length > 0 && !disabled;

  const handleOptionPress = useCallback(
    (questionId: string, value: string, multiSelect: boolean) => {
      setSelections((current) => {
        const values = current[questionId] ?? [];
        const nextValues = multiSelect
          ? values.includes(value)
            ? values.filter((item) => item !== value)
            : [...values, value]
          : [value];
        return { ...current, [questionId]: nextValues };
      });
    },
    []
  );

  return (
    <View
      accessibilityLiveRegion="polite"
      style={styles.sessionQuestionCard}
      testID="mobile-session-question-card-v1"
    >
      <View style={styles.sessionQuestionHeader}>
        <View style={styles.sessionQuestionIcon}>
          <Ionicons
            color={COLORS.amber}
            name={interaction.kind === 'confirmation' ? 'help-circle-outline' : 'list-outline'}
            size={18}
          />
        </View>
        <View style={styles.sessionQuestionHeaderBody}>
          <Text style={styles.sessionQuestionTitle}>{interaction.title}</Text>
          <Text style={styles.sessionQuestionHint}>选择后会立即回复当前会话</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.sessionQuestionContent}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        style={styles.sessionQuestionScroll}
      >
        {interaction.description ? (
          <Text style={styles.sessionQuestionDescription}>{interaction.description}</Text>
        ) : null}
        {interaction.questions.map((question) => (
          <View key={question.id} style={styles.sessionQuestionGroup}>
            {question.header ? (
              <Text style={styles.sessionQuestionHeaderLabel}>{question.header}</Text>
            ) : null}
            <Text style={styles.sessionQuestionPrompt}>{question.prompt}</Text>
            {question.options.map((option) => {
              const selected = (selections[question.id] ?? []).includes(option.value);
              return (
                <Pressable
                  key={option.id}
                  accessibilityLabel={`${question.prompt}：${option.label}`}
                  accessibilityRole={question.multiSelect ? 'checkbox' : 'radio'}
                  accessibilityState={{ checked: selected, disabled }}
                  disabled={disabled}
                  style={({ pressed }) => [
                    styles.sessionQuestionOption,
                    selected ? styles.sessionQuestionOptionSelected : null,
                    pressed ? styles.buttonPressed : null,
                    disabled ? styles.buttonDisabled : null,
                  ]}
                  testID={`mobile-session-question-option-${option.id}`}
                  onPress={() => handleOptionPress(question.id, option.value, question.multiSelect)}
                >
                  <View
                    style={[
                      styles.sessionQuestionOptionMark,
                      selected ? styles.sessionQuestionOptionMarkSelected : null,
                    ]}
                  >
                    {selected ? (
                      <Ionicons color={COLORS.surface} name="checkmark" size={14} />
                    ) : null}
                  </View>
                  <View style={styles.sessionQuestionOptionBody}>
                    <Text style={styles.sessionQuestionOptionLabel}>{option.label}</Text>
                    {option.description ? (
                      <Text style={styles.sessionQuestionOptionDescription} numberOfLines={2}>
                        {option.description}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>

      {hasOptions ? (
        <View style={styles.sessionQuestionActionRow}>
          <Text style={styles.sessionQuestionActionHint}>
            {interaction.questions.some((question) => question.multiSelect)
              ? '可多选'
              : '请选择一项'}
          </Text>
          <Pressable
            accessibilityLabel="发送 AI 问题的回答"
            accessibilityRole="button"
            disabled={!canSubmit}
            style={({ pressed }) => [
              styles.sessionQuestionSubmit,
              pressed ? styles.buttonPressed : null,
              !canSubmit ? styles.sessionQuestionSubmitDisabled : null,
            ]}
            testID="mobile-session-question-submit-v1"
            onPress={() => onSubmit(answer)}
          >
            <Text style={styles.sessionQuestionSubmitText}>发送回答</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.sessionQuestionActionHint}>请在下方输入你的回答。</Text>
      )}
    </View>
  );
}

function SessionNavigationBar({
  acceptsInput,
  live,
  projectLabel,
  resumable,
  runtimeStatus,
  sending,
  title,
  uploadProgress,
  onBack,
  onOpenSettings,
}: {
  acceptsInput: boolean;
  live: boolean;
  projectLabel: string;
  resumable: boolean;
  runtimeStatus: MobileSessionSummary['runtimeStatus'] | null;
  sending: boolean;
  title: string;
  uploadProgress: MobileInputUploadProgress | null;
  onBack: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <View style={styles.sessionNavBar}>
      <View style={styles.sessionNavPrimaryRow}>
        <Pressable
          accessibilityLabel="返回会话列表"
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.sessionNavActionButton,
            styles.sessionNavBackButton,
            pressed ? styles.sessionNavActionButtonPressed : null,
          ]}
          onPress={onBack}
        >
          <Ionicons color={COLORS.charcoal} name="chevron-back-outline" size={24} />
        </Pressable>
        <View style={styles.sessionNavTitleBlock}>
          <Text style={styles.sessionNavTitle} numberOfLines={1}>
            {title}
          </Text>
          <SessionRuntimeStatus
            acceptsInput={acceptsInput}
            live={live}
            projectLabel={projectLabel}
            resumable={resumable}
            runtimeStatus={runtimeStatus}
            sending={sending}
            uploadProgress={uploadProgress}
          />
        </View>
        <Pressable
          accessibilityLabel="设置会话显示"
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.sessionNavActionButton,
            styles.sessionNavSettingsButton,
            pressed ? styles.sessionNavActionButtonPressed : null,
          ]}
          onPress={onOpenSettings}
        >
          <Ionicons color={COLORS.charcoal} name="settings-outline" size={19} />
        </Pressable>
      </View>
    </View>
  );
}

function InputMediaControls({
  compact = false,
  connection,
  contextSelectors,
  disabled,
  images,
  imagesEnabled,
  input,
  canSubmit = false,
  onSubmit,
  speechContext = [],
  skillContext,
  value,
  onChange,
  onError,
  onImagesChange,
}: {
  compact?: boolean;
  connection: MobileConnection;
  contextSelectors?: {
    accessibilityLabel: string;
    disabled?: boolean;
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    value: string;
    onPress: () => void;
  }[];
  disabled: boolean;
  images: MobileImageDraft[];
  imagesEnabled: boolean;
  input: ReactNode;
  canSubmit?: boolean;
  onSubmit?: () => void;
  speechContext?: readonly (string | null | undefined)[];
  skillContext: {
    projectId?: string;
    taskId?: string;
    sessionId?: string;
    runtimeId?: MobileSessionSummary['runtimeId'];
  };
  value: string;
  onChange: (value: string) => void;
  onError: (message: string) => void;
  onImagesChange: (images: MobileImageDraft[]) => void;
}) {
  type ImageEditorState = {
    image: MobileImageDraft;
    remaining: MobileImageDraft[];
    targetId: string | null;
  };

  const [pickingImages, setPickingImages] = useState(false);
  const [imageEditor, setImageEditor] = useState<ImageEditorState | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [skills, setSkills] = useState<MobileSkillSummary[]>([]);
  const [skillsRuntimeId, setSkillsRuntimeId] = useState<MobileSessionSummary['runtimeId'] | null>(
    null
  );
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [voiceStarting, setVoiceStarting] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const {
    projectId: skillProjectId,
    taskId: skillTaskId,
    sessionId: skillSessionId,
    runtimeId: skillRuntimeId,
  } = skillContext;
  const voiceBaseValueRef = useRef('');
  const voiceFinalTranscriptRef = useRef('');
  const voiceSessionRef = useRef<MobileVoiceInputSession | null>(null);

  const disposeVoiceSession = useCallback(() => {
    voiceSessionRef.current?.dispose();
    voiceSessionRef.current = null;
    setVoiceActive(false);
    setVoiceStarting(false);
  }, []);

  useEffect(
    () => () => {
      voiceSessionRef.current?.abort();
      voiceSessionRef.current?.dispose();
      voiceSessionRef.current = null;
    },
    []
  );

  const openImageEditor = useCallback(
    (
      image: MobileImageDraft,
      remaining: MobileImageDraft[] = [],
      targetId: string | null = image.id
    ) => {
      Keyboard.dismiss();
      setToolsOpen(false);
      setImageEditor({ image, remaining, targetId });
    },
    []
  );

  const handlePickImages = useCallback(async () => {
    if (disabled || pickingImages || !imagesEnabled) return;
    setPickingImages(true);
    try {
      const picked = await pickMobileInputImages();
      if (picked.length > 0) {
        setToolsOpen(false);
        const [first, ...remaining] = picked;
        if (first) openImageEditor(first, remaining, null);
      }
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setPickingImages(false);
    }
  }, [disabled, imagesEnabled, onError, openImageEditor, pickingImages]);

  const handleImageEditorSave = useCallback(
    (editedImage: MobileImageDraft) => {
      if (!imageEditor) return;
      if (imageEditor.targetId) {
        onImagesChange(
          images.map((image) => (image.id === imageEditor.targetId ? editedImage : image))
        );
      } else {
        onImagesChange([...images, editedImage]);
      }

      const [nextImage, ...remaining] = imageEditor.remaining;
      setImageEditor(nextImage ? { image: nextImage, remaining, targetId: null } : null);
    },
    [imageEditor, images, onImagesChange]
  );

  const handleImageEditorCancel = useCallback(() => {
    if (!imageEditor) return;
    if (!imageEditor.targetId) {
      onImagesChange([...images, imageEditor.image, ...imageEditor.remaining]);
    }
    setImageEditor(null);
  }, [imageEditor, images, onImagesChange]);

  const loadSkills = useCallback(async () => {
    setSkillsLoading(true);
    setSkillsError(null);
    setSkills([]);
    try {
      const response = await fetchSkills(connection, {
        projectId: skillProjectId,
        taskId: skillTaskId,
        sessionId: skillSessionId,
      });
      setSkills(response.skills);
      setSkillsRuntimeId(response.runtimeId);
    } catch (error) {
      setSkills([]);
      setSkillsError(errorMessage(error));
    } finally {
      setSkillsLoading(false);
    }
  }, [connection, skillProjectId, skillSessionId, skillTaskId]);

  const openSkillPicker = useCallback(() => {
    if (disabled) return;
    Keyboard.dismiss();
    setToolsOpen(false);
    setSkillPickerOpen(true);
    void loadSkills();
  }, [disabled, loadSkills]);

  const selectSkill = useCallback(
    (skill: MobileSkillSummary) => {
      const runtimeId = skillRuntimeId ?? skillsRuntimeId;
      if (!runtimeId) return;
      const nextValue = prependMobileSkillCommand(
        value,
        applyAgentCommandPrefix(runtimeId, skill.id)
      );
      if (nextValue.length > MOBILE_SESSION_INPUT_MAX_CHARS) {
        onError('输入内容已接近上限，请精简后再选择技能。');
        return;
      }
      onChange(nextValue);
      setSkillPickerOpen(false);
    },
    [onChange, onError, skillRuntimeId, skillsRuntimeId, value]
  );

  const startVoiceInput = useCallback(async () => {
    if (disabled || voiceStarting || voiceActive) return;
    if (Constants.appOwnership === 'expo') {
      onError(
        'Voice input is available in the Yoda Mobile development build. In Expo Go, use the keyboard microphone.'
      );
      return;
    }

    voiceBaseValueRef.current = value;
    voiceFinalTranscriptRef.current = '';
    Keyboard.dismiss();
    setVoiceStarting(true);
    try {
      const session = await startMobileVoiceInput({
        contextualStrings: [...speechContext, value],
        onEnd: disposeVoiceSession,
        onError: (message) => {
          onError(message);
          disposeVoiceSession();
        },
        onResult: (transcript, isFinal) => {
          const nextTranscript = mergeMobileVoiceRecognitionResult(
            voiceFinalTranscriptRef.current,
            transcript,
            isFinal
          );
          voiceFinalTranscriptRef.current = nextTranscript.committedTranscript;
          onChange(
            appendMobileVoiceTranscript(
              voiceBaseValueRef.current,
              nextTranscript.visibleTranscript
            ).slice(0, MOBILE_SESSION_INPUT_MAX_CHARS)
          );
        },
      });
      voiceSessionRef.current = session;
      setVoiceStarting(false);
      setVoiceActive(true);
    } catch (error) {
      disposeVoiceSession();
      onError(errorMessage(error));
    }
  }, [
    disabled,
    disposeVoiceSession,
    onChange,
    onError,
    speechContext,
    value,
    voiceActive,
    voiceStarting,
  ]);

  const stopVoiceInput = useCallback(() => {
    voiceSessionRef.current?.stop();
  }, []);

  const handleVoiceButtonPress = useCallback(() => {
    if (disabled) return;
    if (voiceActive) {
      stopVoiceInput();
      return;
    }
    void startVoiceInput();
  }, [disabled, startVoiceInput, stopVoiceInput, voiceActive]);

  return (
    <View style={[styles.inputMediaShell, compact ? styles.inputMediaShellCompact : null]}>
      {images.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.inputImageRail}
        >
          {images.map((image) => (
            <View key={image.id} style={styles.inputImagePreview}>
              <Pressable
                accessibilityHint="点击后进入图片编辑器"
                accessibilityLabel={`打开 ${image.name} 的图片编辑器`}
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                disabled={disabled}
                style={({ pressed }) => [
                  styles.inputImageEditTarget,
                  pressed ? styles.buttonPressed : null,
                ]}
                onPress={() => openImageEditor(image)}
              >
                <Image source={{ uri: image.uri }} style={styles.inputImage} />
              </Pressable>
              <Pressable
                accessibilityLabel={`编辑 ${image.name}`}
                accessibilityRole="button"
                disabled={disabled}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.inputImageEdit,
                  pressed ? styles.buttonPressed : null,
                ]}
                onPress={() => openImageEditor(image)}
              >
                <Ionicons color={COLORS.surface} name="pencil-outline" size={13} />
              </Pressable>
              <Pressable
                accessibilityLabel={`移除 ${image.name}`}
                accessibilityRole="button"
                disabled={disabled}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.inputImageRemove,
                  pressed ? styles.buttonPressed : null,
                ]}
                onPress={() =>
                  onImagesChange(images.filter((candidate) => candidate.id !== image.id))
                }
              >
                <Ionicons color={COLORS.surface} name="close-outline" size={15} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      {contextSelectors && contextSelectors.length > 0 ? (
        <View style={styles.inputMediaContextRow}>
          {contextSelectors.map((selector) => {
            const selectorDisabled = disabled || selector.disabled;
            return (
              <Pressable
                key={selector.label}
                accessibilityLabel={selector.accessibilityLabel}
                accessibilityRole="button"
                accessibilityState={{ disabled: selectorDisabled }}
                disabled={selectorDisabled}
                style={({ pressed }) => [
                  styles.inputMediaContextButton,
                  selectorDisabled ? styles.inputMediaContextButtonDisabled : null,
                  pressed ? styles.buttonPressed : null,
                ]}
                onPress={selector.onPress}
              >
                <Text style={styles.inputMediaContextLabel}>{selector.label}</Text>
                <View style={styles.inputMediaContextValueRow}>
                  <Ionicons color={COLORS.charcoal} name={selector.icon} size={15} />
                  <Text numberOfLines={1} style={styles.inputMediaContextValue}>
                    {selector.value}
                  </Text>
                  <Ionicons color={COLORS.muted} name="chevron-down-outline" size={13} />
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <View style={[styles.composerSurface, voiceActive ? styles.composerSurfaceActive : null]}>
        <View style={styles.composerTextShell}>{input}</View>
        <View style={styles.composerToolbar}>
          <View style={styles.composerToolbarLeading}>
            <Pressable
              accessibilityHint={
                voiceActive ? '停止识别并保留文字' : '开始语音识别，识别结果可继续编辑'
              }
              accessibilityLabel={voiceActive ? '停止语音输入' : '开始语音输入'}
              accessibilityRole="button"
              accessibilityState={{
                busy: voiceStarting,
                disabled: disabled || voiceStarting,
                selected: voiceActive,
              }}
              disabled={disabled || voiceStarting}
              hitSlop={5}
              style={({ pressed }) => [
                styles.composerToolbarButton,
                voiceActive ? styles.composerVoiceButtonActive : null,
                disabled ? styles.buttonDisabled : null,
                pressed ? styles.buttonPressed : null,
              ]}
              onPress={handleVoiceButtonPress}
            >
              {voiceStarting ? (
                <ActivityIndicator color={COLORS.green} size="small" />
              ) : (
                <Ionicons
                  color={voiceActive ? COLORS.green : COLORS.charcoal}
                  name={voiceActive ? 'stop-circle-outline' : 'mic-outline'}
                  size={22}
                />
              )}
            </Pressable>
            <Pressable
              accessibilityLabel={toolsOpen ? '收起输入工具' : '打开输入工具'}
              accessibilityRole="button"
              accessibilityState={{ expanded: toolsOpen, disabled }}
              disabled={disabled}
              hitSlop={5}
              style={({ pressed }) => [
                styles.composerToolbarButton,
                toolsOpen ? styles.composerToolbarButtonActive : null,
                disabled ? styles.buttonDisabled : null,
                pressed ? styles.buttonPressed : null,
              ]}
              onPress={() => setToolsOpen((current) => !current)}
            >
              <Ionicons
                color={COLORS.charcoal}
                name={toolsOpen ? 'close-outline' : 'add-outline'}
                size={23}
              />
            </Pressable>
          </View>
          {onSubmit ? (
            <Pressable
              accessibilityLabel="发送消息"
              accessibilityRole="button"
              accessibilityState={{ disabled: disabled || !canSubmit }}
              disabled={disabled || !canSubmit}
              style={({ pressed }) => [
                styles.composerSendButton,
                !canSubmit ? styles.composerSendButtonDisabled : null,
                pressed ? styles.buttonPressed : null,
              ]}
              onPress={onSubmit}
            >
              <Ionicons color={COLORS.surface} name="arrow-up-outline" size={20} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {toolsOpen ? (
        <View style={styles.inputToolsTray}>
          <Pressable
            accessibilityLabel="选择图片"
            accessibilityRole="button"
            accessibilityState={{ disabled: disabled || !imagesEnabled }}
            disabled={disabled || !imagesEnabled || pickingImages}
            style={({ pressed }) => [
              styles.inputTool,
              disabled || !imagesEnabled ? styles.buttonDisabled : null,
              pressed ? styles.buttonPressed : null,
            ]}
            onPress={() => void handlePickImages()}
          >
            <View style={styles.inputToolIcon}>
              {pickingImages ? (
                <ActivityIndicator color={COLORS.charcoal} size="small" />
              ) : (
                <Ionicons color={COLORS.charcoal} name="images-outline" size={25} />
              )}
            </View>
            <Text style={styles.inputToolText}>图片</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="选择技能"
            accessibilityRole="button"
            disabled={disabled}
            testID="mobile-skill-picker-trigger-v1"
            style={({ pressed }) => [
              styles.inputTool,
              disabled ? styles.buttonDisabled : null,
              pressed ? styles.buttonPressed : null,
            ]}
            onPress={openSkillPicker}
          >
            <View style={styles.inputToolIcon}>
              <Ionicons color={COLORS.charcoal} name="sparkles-outline" size={25} />
            </View>
            <Text style={styles.inputToolText}>技能</Text>
          </Pressable>
          {!imagesEnabled ? <Text style={styles.inputMediaHint}>图片仅支持本地项目</Text> : null}
        </View>
      ) : null}
      <SkillPickerSheet
        error={skillsError}
        loading={skillsLoading}
        open={skillPickerOpen}
        skills={skills}
        onClose={() => setSkillPickerOpen(false)}
        onRetry={() => void loadSkills()}
        onSelect={selectSkill}
      />
      <MobileImageEditor
        image={imageEditor?.image ?? null}
        open={imageEditor !== null}
        onCancel={handleImageEditorCancel}
        onError={onError}
        onSave={handleImageEditorSave}
      />
    </View>
  );
}

function SkillPickerSheet({
  error,
  loading,
  open,
  skills,
  onClose,
  onRetry,
  onSelect,
}: {
  error: string | null;
  loading: boolean;
  open: boolean;
  skills: MobileSkillSummary[];
  onClose: () => void;
  onRetry: () => void;
  onSelect: (skill: MobileSkillSummary) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const visibleSkills = useMemo(
    () => filterMobileSkills(skills, searchQuery),
    [searchQuery, skills]
  );
  const closePicker = () => {
    setSearchQuery('');
    onClose();
  };

  return (
    <Modal
      animationType="slide"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={open}
      onRequestClose={closePicker}
    >
      <View accessibilityViewIsModal style={styles.projectPickerOverlay}>
        <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={closePicker} />
        <SafeAreaView style={styles.projectPickerSheet}>
          <View style={styles.projectPickerHandle} />
          <View style={styles.projectPickerHeader}>
            <View style={styles.projectPickerTitleBlock}>
              <Text style={styles.projectPickerEyebrow}>任务输入</Text>
              <Text style={styles.projectPickerTitle}>选择技能</Text>
            </View>
            <Pressable
              accessibilityLabel="关闭技能选择"
              accessibilityRole="button"
              hitSlop={8}
              style={({ pressed }) => [
                styles.projectPickerClose,
                pressed ? styles.buttonPressed : null,
              ]}
              onPress={closePicker}
            >
              <Ionicons color={COLORS.charcoal} name="close-outline" size={22} />
            </Pressable>
          </View>
          <ProjectPickerSearchInput
            placeholder="搜索技能"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          <ScrollView
            contentContainerStyle={styles.projectPickerList}
            keyboardShouldPersistTaps="handled"
            style={styles.projectPickerListViewport}
          >
            {error ? (
              <Notice message={error} retrying={loading} tone="error" onRetry={onRetry} />
            ) : null}
            {loading && skills.length === 0 ? (
              <View style={styles.skillPickerLoading}>
                <ActivityIndicator color={COLORS.charcoal} />
                <Text style={styles.emptyText}>正在加载技能…</Text>
              </View>
            ) : null}
            {!loading && !error && visibleSkills.length === 0 ? (
              <View style={styles.attributionPickerEmpty}>
                <Ionicons
                  color={COLORS.muted}
                  name={searchQuery.trim() ? 'search-outline' : 'sparkles-outline'}
                  size={22}
                />
                <Text style={styles.emptyText}>
                  {searchQuery.trim()
                    ? `没有匹配“${searchQuery.trim()}”的技能`
                    : '当前没有可调用的已安装技能。'}
                </Text>
              </View>
            ) : null}
            {visibleSkills.map((skill) => (
              <Pressable
                key={skill.key}
                accessibilityLabel={`选择技能 ${skill.displayName}`}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.projectPickerOption,
                  pressed ? styles.buttonPressed : null,
                ]}
                onPress={() => {
                  setSearchQuery('');
                  onSelect(skill);
                }}
              >
                <View style={styles.projectPickerOptionIcon}>
                  <Ionicons color={COLORS.muted} name="sparkles-outline" size={17} />
                </View>
                <View style={styles.projectPickerOptionBody}>
                  <View style={styles.skillPickerTitleRow}>
                    <Text
                      style={[styles.projectPickerOptionLabel, styles.skillPickerName]}
                      numberOfLines={1}
                    >
                      {skill.displayName}
                    </Text>
                    <Text style={styles.skillPickerCommand} numberOfLines={1}>
                      {skill.id}
                    </Text>
                  </View>
                  <Text style={styles.projectPickerOptionMeta} numberOfLines={2}>
                    {skill.description}
                  </Text>
                </View>
                <Ionicons color={COLORS.muted} name="add-circle-outline" size={20} />
              </Pressable>
            ))}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function SessionInputComposer({
  acceptsInput,
  connection,
  resumable,
  runtimeId,
  images,
  imagesEnabled,
  sending,
  sessionId,
  speechContext,
  value,
  projectId,
  taskId,
  onChange,
  onError,
  onImagesChange,
  onSend,
}: {
  acceptsInput: boolean;
  connection: MobileConnection;
  resumable: boolean;
  runtimeId?: MobileSessionSummary['runtimeId'];
  images: MobileImageDraft[];
  imagesEnabled: boolean;
  sending: boolean;
  sessionId: string;
  speechContext: readonly (string | null | undefined)[];
  value: string;
  projectId: string;
  taskId: string;
  onChange: (value: string) => void;
  onError: (message: string) => void;
  onImagesChange: (images: MobileImageDraft[]) => void;
  onSend: () => void;
}) {
  const canContinue = canContinueMobileSession({ acceptsInput, resumable });
  const canSend =
    canContinue &&
    (value.trim().length > 0 || images.length > 0) &&
    (images.length === 0 || imagesEnabled) &&
    !sending;
  return (
    <View style={styles.sessionInputBar}>
      <InputMediaControls
        compact
        canSubmit={canSend}
        connection={connection}
        disabled={sending || !canContinue}
        images={images}
        imagesEnabled={imagesEnabled}
        input={
          <TextInput
            autoCapitalize="sentences"
            maxLength={MOBILE_SESSION_INPUT_MAX_CHARS}
            multiline
            placeholder="Send a follow-up..."
            placeholderTextColor="#9A958C"
            scrollEnabled
            style={styles.composerTextInput}
            textAlignVertical="top"
            value={value}
            onChangeText={onChange}
          />
        }
        onSubmit={onSend}
        speechContext={speechContext}
        skillContext={{ projectId, taskId, sessionId, runtimeId }}
        value={value}
        onChange={onChange}
        onError={onError}
        onImagesChange={onImagesChange}
      />
      {value.length > 0 ? (
        <Text style={styles.sessionInputCount}>
          {value.length}/{MOBILE_SESSION_INPUT_MAX_CHARS}
        </Text>
      ) : null}
    </View>
  );
}

function SessionInputFailureNotice({
  detail,
  message,
  retrying,
  onRetry,
}: {
  detail: string;
  message: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyDetail = useCallback(async () => {
    await Clipboard.setStringAsync(`${message}\n${detail}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1_500);
  }, [detail, message]);

  return (
    <View accessibilityLiveRegion="assertive" style={styles.sessionInputFailure}>
      <Ionicons color={COLORS.red} name="alert-circle-outline" size={18} />
      <View style={styles.sessionInputFailureBody}>
        <Text style={styles.sessionInputFailureMessage}>{message}</Text>
        <Text numberOfLines={2} selectable style={styles.sessionInputFailureDetail}>
          {detail.split('\n')[0]}
        </Text>
      </View>
      <Pressable
        accessibilityLabel="重试发送消息"
        accessibilityRole="button"
        disabled={retrying}
        hitSlop={6}
        style={({ pressed }) => [
          styles.sessionInputFailureAction,
          pressed ? styles.buttonPressed : null,
          retrying ? styles.buttonDisabled : null,
        ]}
        onPress={onRetry}
      >
        {retrying ? (
          <ActivityIndicator color={COLORS.charcoal} size="small" />
        ) : (
          <Ionicons color={COLORS.charcoal} name="refresh-outline" size={18} />
        )}
      </Pressable>
      <Pressable
        accessibilityLabel="复制发送诊断信息"
        accessibilityRole="button"
        hitSlop={6}
        style={({ pressed }) => [
          styles.sessionInputFailureAction,
          pressed ? styles.buttonPressed : null,
        ]}
        onPress={() => void copyDetail()}
      >
        <Ionicons
          color={copied ? COLORS.green : COLORS.charcoal}
          name={copied ? 'checkmark-outline' : 'copy-outline'}
          size={18}
        />
      </Pressable>
    </View>
  );
}

function SessionRuntimeStatus({
  acceptsInput,
  live,
  projectLabel,
  resumable,
  runtimeStatus,
  sending,
  uploadProgress,
}: {
  acceptsInput: boolean;
  live: boolean;
  projectLabel: string;
  resumable: boolean;
  runtimeStatus: MobileSessionSummary['runtimeStatus'] | null;
  sending: boolean;
  uploadProgress: MobileInputUploadProgress | null;
}) {
  const presentation = sending
    ? {
        animated: true,
        color: COLORS.blue,
        label: uploadProgress ? '上传中' : '发送中',
      }
    : sessionRuntimePresentation(runtimeStatus);
  const detail = uploadProgress
    ? mobileInputUploadProgressText(uploadProgress)
    : sending
      ? '正在恢复会话并发送'
      : acceptsInput
        ? runtimeStatus === 'completed'
          ? '可以继续对话'
          : '可以实时输入'
        : resumable
          ? '发送消息后恢复会话'
          : live
            ? '已连接，当前不可输入'
            : '会话已离线';
  const visibleDetail = uploadProgress
    ? mobileInputUploadProgressText(uploadProgress)
    : sending
      ? '正在发送'
      : null;

  return (
    <View
      accessibilityLabel={`${presentation.label}。${detail}。项目：${projectLabel}`}
      accessibilityLiveRegion="polite"
      style={styles.sessionRunStatus}
    >
      <Text
        ellipsizeMode="tail"
        numberOfLines={1}
        style={styles.sessionRunProject}
        testID="session-header-project"
      >
        {projectLabel}
      </Text>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.sessionRunStatusSeparator}
      >
        ·
      </Text>
      {presentation.animated ? (
        <ActivityIndicator color={presentation.color} size={10} />
      ) : (
        <View style={[styles.sessionRunStatusDot, { backgroundColor: presentation.color }]} />
      )}
      <Text style={[styles.sessionRunStatusLabel, { color: presentation.color }]} numberOfLines={1}>
        {presentation.label}
        {visibleDetail ? ` · ${visibleDetail}` : ''}
      </Text>
    </View>
  );
}

function sessionRuntimePresentation(status: MobileSessionSummary['runtimeStatus'] | null): {
  animated: boolean;
  color: string;
  label: string;
} {
  switch (status) {
    case 'working':
      return {
        animated: true,
        color: COLORS.blue,
        label: '进行中',
      };
    case 'awaiting-input':
      return {
        animated: false,
        color: COLORS.amber,
        label: '等待输入',
      };
    case 'completed':
      return {
        animated: false,
        color: COLORS.green,
        label: '已完成',
      };
    case 'error':
      return {
        animated: false,
        color: COLORS.red,
        label: '执行失败',
      };
    case 'idle':
      return {
        animated: false,
        color: COLORS.muted,
        label: '已暂停',
      };
    case null:
      return {
        animated: false,
        color: COLORS.muted,
        label: '状态同步中',
      };
  }
}

const AGENT_REPLY_DISPLAY_COPY: Record<
  AgentReplyDisplayLevel,
  { description: string; label: string }
> = {
  hidden: { label: '不显示', description: '只显示你的对话' },
  concise: { label: '精简', description: '只显示 Agent 的最终回复' },
  detailed: { label: '详细', description: '显示除工具调用以外的对话' },
  verbose: { label: '全部', description: '显示回复、状态与工具调用' },
};

function SessionDisplaySettingsSheet({
  configuration,
  displayLevel,
  open,
  outputMode,
  runtimeSettingsSaving,
  model,
  reasoningEffort,
  permissionMode,
  session,
  onClose,
  onApplyRuntimeConfiguration,
  onDisplayLevelChange,
  onModelChange,
  onPermissionModeChange,
  onReasoningEffortChange,
  onOutputModeChange,
}: {
  configuration: MobileConfigurationSnapshot | null;
  displayLevel: AgentReplyDisplayLevel;
  open: boolean;
  outputMode: SessionOutputMode;
  runtimeSettingsSaving: boolean;
  model: string;
  reasoningEffort: string;
  permissionMode: string;
  session: MobileSessionSummary | null;
  onClose: () => void;
  onApplyRuntimeConfiguration: (update: MobileSessionRuntimeConfigurationUpdate) => Promise<void>;
  onDisplayLevelChange: (level: AgentReplyDisplayLevel) => void;
  onModelChange: (value: string) => void;
  onPermissionModeChange: (value: string) => void;
  onReasoningEffortChange: (value: string) => void;
  onOutputModeChange: (mode: SessionOutputMode) => void;
}) {
  const permissionModes = session ? (configuration?.permissionModes[session.runtimeId] ?? []) : [];

  return (
    <Modal
      animationType="slide"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={open}
      onRequestClose={onClose}
    >
      <View accessibilityViewIsModal style={styles.projectPickerOverlay}>
        <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView style={styles.sessionDisplaySettingsSheet}>
          <View style={styles.projectPickerHandle} />
          <View style={styles.projectPickerHeader}>
            <View style={styles.projectPickerTitleBlock}>
              <Text style={styles.projectPickerEyebrow}>当前会话</Text>
              <Text style={styles.projectPickerTitle}>会话设置</Text>
            </View>
            <Pressable
              accessibilityLabel="关闭显示设置"
              accessibilityRole="button"
              hitSlop={8}
              style={({ pressed }) => [
                styles.projectPickerClose,
                pressed ? styles.buttonPressed : null,
              ]}
              onPress={onClose}
            >
              <Ionicons color={COLORS.charcoal} name="close-outline" size={22} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sessionDisplaySettingsContent}>
            <View style={styles.sessionDisplaySettingsGroup}>
              <View style={styles.sessionDisplaySettingsHeading}>
                <Text style={styles.sessionDisplaySettingsLabel}>执行配置</Text>
                <Text style={styles.sessionDisplaySettingsDescription}>
                  当前 Agent 会话已绑定；模型、推理深度和权限模式应用后会重启会话。
                </Text>
              </View>
              <View style={styles.sessionRuntimeIdentityCard}>
                <View style={styles.sessionRuntimeIdentityIcon}>
                  <Text style={styles.sessionRuntimeIdentityIconText}>
                    {session?.agent?.icon || '◎'}
                  </Text>
                </View>
                <View style={styles.sessionRuntimeIdentityBody}>
                  <Text style={styles.sessionRuntimeIdentityName} numberOfLines={1}>
                    {session?.agent?.name ?? session?.runtimeId ?? '当前 Agent'}
                  </Text>
                  <Text style={styles.sessionRuntimeIdentityMeta} numberOfLines={1}>
                    {session?.runtimeId ?? '读取中'}
                  </Text>
                </View>
              </View>
              <Text style={styles.mobileSettingsFieldLabel}>模型</Text>
              <TextInput
                autoCapitalize="none"
                placeholder="使用客户端默认模型"
                placeholderTextColor={COLORS.muted}
                style={styles.mobileSettingsTextInput}
                value={model}
                onChangeText={onModelChange}
              />
              <MobileDropdownMenu
                label="推理深度"
                options={mobileReasoningEffortOptions(reasoningEffort)}
                value={reasoningEffort || 'inherit'}
                onChange={(effort) => onReasoningEffortChange(effort === 'inherit' ? '' : effort)}
              />
              {permissionModes.length > 0 ? (
                <>
                  <MobileDropdownMenu
                    label="权限模式"
                    options={permissionModes.map((mode) => ({
                      value: mode.id,
                      label: mode.label,
                      description:
                        mode.description ||
                        (mode.danger ? '执行时减少确认步骤' : '保留客户端的常规确认流程'),
                    }))}
                    value={permissionMode}
                    onChange={onPermissionModeChange}
                  />
                </>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={!session || runtimeSettingsSaving}
                style={({ pressed }) => [
                  styles.primaryButton,
                  !session || runtimeSettingsSaving ? styles.buttonDisabled : null,
                  pressed ? styles.buttonPressed : null,
                ]}
                onPress={() =>
                  void onApplyRuntimeConfiguration({
                    model: model.trim() || null,
                    reasoningEffort: reasoningEffort.trim() || null,
                    ...(permissionMode ? { permissionMode } : {}),
                  })
                }
              >
                {runtimeSettingsSaving ? (
                  <ActivityIndicator color={COLORS.surface} />
                ) : (
                  <Ionicons color={COLORS.surface} name="refresh-outline" size={18} />
                )}
                <Text style={styles.primaryButtonText}>
                  {runtimeSettingsSaving ? '正在应用…' : '应用并重启会话'}
                </Text>
              </Pressable>
            </View>
            <View style={styles.sessionDisplaySettingsGroup}>
              <View style={styles.sessionDisplaySettingsHeading}>
                <Text style={styles.sessionDisplaySettingsLabel}>显示模式</Text>
                <Text style={styles.sessionDisplaySettingsDescription}>
                  选择适合阅读的排版，或查看原始记录。
                </Text>
              </View>
              <MobileDropdownMenu
                label="显示模式"
                options={[
                  { label: '阅读', value: 'rendered', description: '使用适合阅读的排版' },
                  { label: '原始记录', value: 'raw', description: '查看完整原始输出' },
                ]}
                value={outputMode}
                onChange={(mode) => onOutputModeChange(mode as SessionOutputMode)}
              />
            </View>
            <View style={styles.sessionDisplaySettingsGroup}>
              <View style={styles.sessionDisplaySettingsHeading}>
                <Text style={styles.sessionDisplaySettingsLabel}>对话详细度</Text>
                <Text style={styles.sessionDisplaySettingsDescription}>
                  控制会话里保留多少过程信息；原始记录始终完整显示。
                </Text>
              </View>
              <MobileDropdownMenu
                label="对话详细度"
                options={AGENT_REPLY_DISPLAY_LEVELS.map((level) => ({
                  value: level,
                  label: AGENT_REPLY_DISPLAY_COPY[level].label,
                  description: AGENT_REPLY_DISPLAY_COPY[level].description,
                }))}
                value={displayLevel}
                onChange={(level) => onDisplayLevelChange(level as AgentReplyDisplayLevel)}
              />
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function RenderedSessionTranscript({
  detail,
  displayLevel,
  fallbackOutput,
}: {
  detail: MobileSessionDetail;
  displayLevel: AgentReplyDisplayLevel;
  fallbackOutput: string;
}) {
  const transcript = useMemo(
    () =>
      mergeAdjacentAssistantBlocks(filterMobileSessionTranscript(detail.transcript, displayLevel)),
    [detail.transcript, displayLevel]
  );
  const renderItems = useMemo(() => groupAdjacentMobileToolBlocks(transcript), [transcript]);
  const latestToolId = useMemo(
    () => transcript.findLast((block) => block.role === 'tool')?.id,
    [transcript]
  );

  if (detail.transcript.length === 0) {
    return <ReadableSessionOutput output={fallbackOutput} />;
  }

  if (transcript.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Ionicons color={COLORS.muted} name="chatbubble-ellipses-outline" size={22} />
        <Text style={styles.emptyText}>当前详细度下暂无可显示的对话</Text>
      </View>
    );
  }

  return (
    <View style={styles.transcriptList}>
      {renderItems.map((item) =>
        item.kind === 'tool-group' ? (
          <TranscriptToolGroup
            key={item.id}
            blocks={item.blocks}
            latestToolId={latestToolId}
            sessionRunning={detail.session.running && detail.session.runtimeStatus === 'working'}
          />
        ) : (
          <TranscriptBlock key={item.id} block={item.block} />
        )
      )}
    </View>
  );
}

function isTranscriptToolRunning({
  block,
  latestToolId,
  sessionRunning,
}: {
  block: MobileSessionTranscriptBlock;
  latestToolId: string | undefined;
  sessionRunning: boolean;
}): boolean {
  return (
    sessionRunning &&
    (block.toolStatus === 'running' ||
      (block.toolStatus === undefined && block.id === latestToolId))
  );
}

function ToolStateIcon({ running }: { running: boolean }) {
  return running ? (
    <ActivityIndicator color={COLORS.blue} size="small" />
  ) : (
    <Ionicons color={COLORS.green} name="checkmark-circle" size={17} />
  );
}

function ToolExpandedContent({ block }: { block: MobileSessionTranscriptBlock }) {
  return (
    <View style={styles.toolExpandedBody}>
      <CodeText value={formatMobileToolTranscriptContent(block.content)} />
      {block.timestamp ? (
        <Text style={styles.toolExpandedTime}>{formatTimestamp(block.timestamp)}</Text>
      ) : null}
    </View>
  );
}

function TranscriptToolGroup({
  blocks,
  latestToolId,
  sessionRunning,
}: {
  blocks: MobileSessionTranscriptBlock[];
  latestToolId: string | undefined;
  sessionRunning: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const title = mobileToolGroupTitle(blocks);
  const running = blocks.some((block) =>
    isTranscriptToolRunning({ block, latestToolId, sessionRunning })
  );
  const latestBlock = blocks.at(-1);
  const preview = latestBlock
    ? summarizeMobileToolTranscriptContent(latestBlock.content)
    : 'No details';

  return (
    <View
      style={[
        styles.transcriptBlock,
        styles.transcriptToolBlock,
        running ? styles.transcriptToolBlockRunning : null,
      ]}
    >
      <Pressable
        accessibilityHint={preview}
        accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${title}. ${
          running ? 'Running' : 'Completed'
        }`}
        accessibilityRole="button"
        style={({ pressed }) => [styles.toolCompactRow, pressed ? styles.buttonPressed : null]}
        onPress={() => setExpanded((current) => !current)}
      >
        <View style={styles.transcriptTitleRow}>
          <ToolStateIcon running={running} />
          <Text style={styles.transcriptTitle} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <View style={styles.toolCompactMeta}>
          <Text style={[styles.toolStateText, running ? styles.toolStateTextRunning : null]}>
            {running ? 'Running' : 'Done'}
          </Text>
          <Ionicons
            color={COLORS.muted}
            name={expanded ? 'chevron-up-outline' : 'chevron-down-outline'}
            size={16}
          />
        </View>
      </Pressable>
      {expanded ? (
        blocks.length === 1 ? (
          <ToolExpandedContent block={blocks[0]} />
        ) : (
          <View style={styles.toolGroupList}>
            {blocks.map((block) => (
              <TranscriptToolGroupItem
                key={block.id}
                block={block}
                latestToolId={latestToolId}
                sessionRunning={sessionRunning}
              />
            ))}
          </View>
        )
      ) : null}
    </View>
  );
}

function TranscriptToolGroupItem({
  block,
  latestToolId,
  sessionRunning,
}: {
  block: MobileSessionTranscriptBlock;
  latestToolId: string | undefined;
  sessionRunning: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const title = block.title ?? 'Command';
  const running = isTranscriptToolRunning({ block, latestToolId, sessionRunning });
  const preview = summarizeMobileToolTranscriptContent(block.content);

  return (
    <View style={[styles.toolGroupItem, running ? styles.toolGroupItemRunning : null]}>
      <Pressable
        accessibilityHint={preview}
        accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${title}. ${
          running ? 'Running' : 'Completed'
        }`}
        accessibilityRole="button"
        style={({ pressed }) => [styles.toolGroupItemRow, pressed ? styles.buttonPressed : null]}
        onPress={() => setExpanded((current) => !current)}
      >
        <View style={styles.transcriptTitleRow}>
          <ToolStateIcon running={running} />
          <Text style={styles.toolGroupItemTitle} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <Ionicons
          color={COLORS.muted}
          name={expanded ? 'chevron-up-outline' : 'chevron-down-outline'}
          size={15}
        />
      </Pressable>
      {expanded ? <ToolExpandedContent block={block} /> : null}
    </View>
  );
}

function TranscriptBlock({ block }: { block: MobileSessionTranscriptBlock }) {
  const isUser = block.role === 'user';
  const isAssistant = block.role === 'assistant';
  const isStatus = block.role === 'status';
  const title =
    block.title ?? (isUser ? 'You' : isAssistant ? 'Codex' : isStatus ? 'Status' : 'Message');
  const headerContent = (
    <>
      <View style={styles.transcriptTitleRow}>
        <View
          style={[
            styles.transcriptRoleDot,
            isUser ? styles.transcriptUserDot : null,
            isStatus ? styles.transcriptStatusDot : null,
          ]}
        />
        <Text
          style={[styles.transcriptTitle, isUser ? styles.transcriptUserText : null]}
          numberOfLines={1}
        >
          {title}
        </Text>
      </View>
      <View style={styles.transcriptHeaderMeta}>
        {block.timestamp ? (
          <Text style={[styles.transcriptTime, isUser ? styles.transcriptUserMeta : null]}>
            {formatTimestamp(block.timestamp)}
          </Text>
        ) : null}
      </View>
    </>
  );

  return (
    <View
      style={[
        styles.transcriptBlock,
        isUser ? styles.transcriptUserBlock : null,
        isStatus ? styles.transcriptStatusBlock : null,
      ]}
    >
      <View style={styles.transcriptHeader}>{headerContent}</View>
      {block.format === 'code' ? (
        <CodeText value={block.content} />
      ) : block.format === 'plain' ? (
        <Text
          selectable
          style={[styles.markdownParagraph, isUser ? styles.transcriptUserText : null]}
        >
          {block.content}
        </Text>
      ) : (
        <RenderedMarkdown value={block.content} inverted={isUser} />
      )}
    </View>
  );
}

function RenderedMarkdown({ value, inverted = false }: { value: string; inverted?: boolean }) {
  const blocks = useMemo(() => parseMarkdownBlocks(value), [value]);
  if (blocks.length === 0) return null;

  return (
    <View style={styles.markdownStack}>
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          return (
            <Text
              key={index}
              selectable
              style={[
                styles.markdownHeading,
                block.level === 2 ? styles.markdownHeading2 : null,
                block.level >= 3 ? styles.markdownHeading3 : null,
                inverted ? styles.transcriptUserText : null,
              ]}
            >
              {block.text}
            </Text>
          );
        }

        if (block.kind === 'code') {
          return <CodeText key={index} language={block.language} value={block.text} />;
        }

        if (block.kind === 'quote') {
          return (
            <View
              key={index}
              style={[styles.markdownQuote, inverted ? styles.markdownQuoteInverted : null]}
            >
              <MarkdownInline
                style={[styles.markdownQuoteText, inverted ? styles.transcriptUserText : null]}
                inverted={inverted}
                text={block.text}
              />
            </View>
          );
        }

        if (block.kind === 'table') {
          return (
            <MarkdownTable
              key={index}
              headers={block.headers}
              inverted={inverted}
              rows={block.rows}
            />
          );
        }

        if (block.kind === 'list') {
          return (
            <View key={index} style={styles.markdownList}>
              {block.items.map((item, itemIndex) => (
                <View key={`${itemIndex}-${item}`} style={styles.markdownListItem}>
                  <Text
                    style={[styles.markdownBullet, inverted ? styles.transcriptUserText : null]}
                  >
                    {block.ordered ? `${itemIndex + 1}.` : '•'}
                  </Text>
                  <MarkdownInline
                    style={[
                      styles.markdownParagraph,
                      styles.markdownListText,
                      inverted ? styles.transcriptUserText : null,
                    ]}
                    inverted={inverted}
                    text={item}
                  />
                </View>
              ))}
            </View>
          );
        }

        return (
          <MarkdownInline
            key={index}
            style={[styles.markdownParagraph, inverted ? styles.transcriptUserText : null]}
            inverted={inverted}
            text={block.text}
          />
        );
      })}
    </View>
  );
}

function MarkdownTable({
  headers,
  rows,
  inverted = false,
}: {
  headers: string[];
  rows: string[][];
  inverted?: boolean;
}) {
  return (
    <View accessibilityLabel={`Table with ${rows.length} rows`} style={styles.markdownTable}>
      {rows.map((row, rowIndex) => (
        <View
          key={`${rowIndex}-${row.join('|')}`}
          style={[styles.markdownTableCard, inverted ? styles.markdownTableCardInverted : null]}
        >
          <Text
            style={[styles.markdownTablePrimaryLabel, inverted ? styles.transcriptUserMeta : null]}
          >
            {headers[0] || 'Item'}
          </Text>
          <MarkdownInline
            inverted={inverted}
            style={[styles.markdownTablePrimaryValue, inverted ? styles.transcriptUserText : null]}
            text={row[0] || '—'}
          />
          {headers.slice(1).map((header, columnIndex) => (
            <View
              key={`${columnIndex}-${header}`}
              style={[
                styles.markdownTableField,
                inverted ? styles.markdownTableFieldInverted : null,
              ]}
            >
              <Text
                style={[
                  styles.markdownTableFieldLabel,
                  inverted ? styles.transcriptUserMeta : null,
                ]}
              >
                {header || `Column ${columnIndex + 2}`}
              </Text>
              <MarkdownInline
                inverted={inverted}
                style={[
                  styles.markdownTableFieldValue,
                  inverted ? styles.transcriptUserText : null,
                ]}
                text={row[columnIndex + 1] || '—'}
              />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function MarkdownInline({
  text,
  style,
  inverted = false,
}: {
  text: string;
  style: StyleProp<TextStyle>;
  inverted?: boolean;
}) {
  return (
    <Text selectable style={style}>
      {tokenizeInlineMarkdown(text).map((token, index) => {
        if (token.kind === 'bold') {
          return (
            <Text key={index} style={styles.inlineBold}>
              {token.text}
            </Text>
          );
        }
        if (token.kind === 'code') {
          return (
            <Text
              key={index}
              style={[styles.inlineCode, inverted ? styles.inlineCodeInverted : null]}
            >
              {token.text}
            </Text>
          );
        }
        if (token.kind === 'link') {
          return (
            <Text
              key={index}
              accessibilityRole="link"
              accessibilityLabel={token.text}
              style={[styles.inlineLink, inverted ? styles.inlineLinkInverted : null]}
              onPress={() => openMarkdownLink(token.url)}
            >
              {token.text}
            </Text>
          );
        }
        return token.text;
      })}
    </Text>
  );
}

function openMarkdownLink(value: string): void {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) return;
    void Linking.openURL(url.toString()).catch(() => undefined);
  } catch {
    // Ignore malformed model output instead of interrupting the transcript surface.
  }
}

function CodeText({ language, value }: { language?: string; value: string }) {
  return (
    <View style={styles.renderedCodeBlock}>
      {language ? <Text style={styles.renderedCodeLang}>{language}</Text> : null}
      <Text selectable style={styles.renderedCodeText}>
        {value || 'No output.'}
      </Text>
    </View>
  );
}

function ReadableSessionOutput({ output }: { output: string }) {
  const readable = useMemo(() => parseReadableOutput(output), [output]);

  if (readable.blocks.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Ionicons color={COLORS.muted} name="document-text-outline" size={22} />
        <Text style={styles.emptyText}>No output captured yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.readableOutput}>
      {readable.omittedCount > 0 ? (
        <View style={styles.outputNotice}>
          <Text style={styles.outputNoticeText}>{readable.omittedCount} earlier blocks in Raw</Text>
        </View>
      ) : null}
      {readable.blocks.map((block) => (
        <View
          key={block.id}
          style={[styles.outputBlock, block.kind === 'code' ? styles.outputCodeBlock : null]}
        >
          <Text
            selectable
            style={block.kind === 'code' ? styles.outputCodeText : styles.outputProseText}
          >
            {block.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

function RawSessionOutput({ output }: { output: string }) {
  return (
    <View style={styles.terminalBox}>
      <Text selectable style={styles.terminalText}>
        {output || 'No output captured yet.'}
      </Text>
    </View>
  );
}

type MobileTaskListEntry = {
  task: MobileTaskSummary;
  depth: number;
  hasChildren: boolean;
};

function buildMobileTaskListEntries(tasks: readonly MobileTaskSummary[]): MobileTaskListEntry[] {
  const taskById = new Map(tasks.map((task) => [task.id, task] as const));
  const childIds = new Set<string>();

  for (const task of tasks) {
    const parent = task.parentTaskId ? taskById.get(task.parentTaskId) : undefined;
    if (parent && parent.projectId === task.projectId) childIds.add(parent.id);
  }

  return tasks.map((task) => {
    let depth = 0;
    let current = task;
    const visited = new Set<string>();
    while (current.parentTaskId && !visited.has(current.id)) {
      visited.add(current.id);
      const parent = taskById.get(current.parentTaskId);
      if (!parent || parent.projectId !== task.projectId) break;
      depth += 1;
      current = parent;
    }
    return { task, depth, hasChildren: childIds.has(task.id) };
  });
}

function TaskList({
  projects,
  tasks,
  title,
  openingTaskId,
  onOpenTask,
}: {
  projects: MobileProjectSummary[];
  tasks: MobileTaskSummary[];
  title: string;
  openingTaskId: string | null;
  onOpenTask: (taskId: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<MobileTaskSortMode>('recent');
  const visibleTasks = useMemo(() => {
    const matchingTasks = filterMobileTasks(tasks, searchQuery);
    return buildMobileTaskListEntries(sortMobileTasks(matchingTasks, sortMode));
  }, [searchQuery, sortMode, tasks]);
  const trimmedQuery = searchQuery.trim();

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionMeta}>{visibleTasks.length}</Text>
      </View>
      <ProjectPickerSearchInput
        compact
        placeholder="搜索任务"
        value={searchQuery}
        onChangeText={setSearchQuery}
      />
      <View style={styles.taskListSort}>
        <MobileDropdownMenu
          accessibilityLabel={`任务排序，当前${MOBILE_TASK_SORT_OPTIONS.find((option) => option.value === sortMode)?.label ?? '最近更新'}`}
          label="任务排序"
          options={MOBILE_TASK_SORT_OPTIONS}
          value={sortMode}
          onChange={(value) => setSortMode(value as MobileTaskSortMode)}
        />
      </View>
      {visibleTasks.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons
            color={COLORS.muted}
            name={trimmedQuery ? 'search-outline' : 'file-tray-outline'}
            size={22}
          />
          <Text style={styles.emptyText}>
            {trimmedQuery ? `没有匹配“${trimmedQuery}”的任务` : '当前筛选下没有任务。'}
          </Text>
        </View>
      ) : (
        visibleTasks.map(({ depth, hasChildren, task }) => (
          <TaskRow
            key={task.id}
            depth={depth}
            hasChildren={hasChildren}
            projectLabel={projectName(projects, task.projectId)}
            task={task}
            isOpening={openingTaskId === task.id}
            onPress={() => onOpenTask(task.id)}
          />
        ))
      )}
    </View>
  );
}

function TaskRow({
  depth,
  hasChildren,
  isOpening,
  projectLabel,
  task,
  onPress,
}: {
  depth: number;
  hasChildren: boolean;
  isOpening: boolean;
  projectLabel: string;
  task: MobileTaskSummary;
  onPress: () => void;
}) {
  const hierarchyLabel = depth > 0 ? '子任务' : hasChildren ? '父任务' : '任务';
  return (
    <Pressable
      accessibilityLabel={`${hierarchyLabel}：${task.name}`}
      accessibilityRole="button"
      accessibilityState={{ busy: isOpening }}
      testID={`mobile-task-card-two-line-v1-${task.id}`}
      style={({ pressed }) => [
        styles.taskRow,
        depth > 0 ? styles.taskRowNested : null,
        { marginLeft: Math.min(depth, 3) * 14 },
        pressed ? styles.buttonPressed : null,
      ]}
      onPress={onPress}
    >
      <View style={styles.taskTopLine}>
        {depth > 0 ? <Ionicons color={COLORS.muted} name="git-branch-outline" size={16} /> : null}
        <Text style={styles.taskName} numberOfLines={1}>
          {task.name}
        </Text>
        <View style={[styles.statusPill, { borderColor: statusColor(task.activityStatus) }]}>
          <Text style={[styles.statusText, { color: statusColor(task.activityStatus) }]}>
            {statusLabel(task.activityStatus)}
          </Text>
        </View>
      </View>
      <View style={styles.taskSummaryLine}>
        <View style={styles.taskProjectAndHierarchy}>
          <Text style={styles.taskProject} numberOfLines={1}>
            {projectLabel}
          </Text>
          {hierarchyLabel !== '任务' ? (
            <Text style={styles.taskHierarchyLabel}>{hierarchyLabel}</Text>
          ) : null}
        </View>
        <View style={styles.taskSummaryMeta}>
          <Text style={styles.taskSummaryText} numberOfLines={1}>
            {taskSessionCountLabel(task.conversationCount)} ·{' '}
            {formatTimestamp(task.lastInteractedAt ?? task.updatedAt)}
          </Text>
          {isOpening ? (
            <ActivityIndicator color={COLORS.muted} size="small" />
          ) : (
            <Ionicons color={COLORS.muted} name="chevron-forward-outline" size={16} />
          )}
        </View>
      </View>
    </Pressable>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailItem}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function MetaItem({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.metaItem}>
      <Ionicons color={COLORS.muted} name={icon} size={14} />
      <Text style={styles.metaText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: COLORS.page,
  },
  flex: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    padding: 18,
    paddingBottom: 34,
    gap: 18,
  },
  sessionDetailShell: {
    flex: 1,
  },
  sessionNavBar: {
    minHeight: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.faint,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  sessionNavPrimaryRow: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    paddingHorizontal: 48,
  },
  sessionNavActionButton: {
    position: 'absolute',
    top: 3,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  sessionNavBackButton: {
    left: 0,
  },
  sessionNavSettingsButton: {
    right: 0,
  },
  sessionNavActionButtonPressed: {
    backgroundColor: COLORS.faint,
  },
  sessionNavTitleBlock: {
    minWidth: 0,
    width: '100%',
    alignItems: 'center',
    gap: 1,
  },
  sessionNavTitle: {
    color: COLORS.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  scrollToBottomButton: {
    position: 'absolute',
    right: 14,
    bottom: Platform.OS === 'ios' ? 132 : 124,
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: COLORS.charcoal,
  },
  sessionQuestionCard: {
    maxHeight: 290,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    backgroundColor: '#FFFCF6',
    paddingHorizontal: 12,
    paddingTop: 9,
    paddingBottom: 8,
    gap: 8,
  },
  sessionQuestionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  sessionQuestionIcon: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: '#FFF0C7',
  },
  sessionQuestionHeaderBody: {
    minWidth: 0,
    flex: 1,
    gap: 1,
  },
  sessionQuestionTitle: {
    color: COLORS.ink,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
  },
  sessionQuestionHint: {
    color: COLORS.muted,
    fontSize: 10,
    lineHeight: 14,
  },
  sessionQuestionScroll: {
    maxHeight: 205,
  },
  sessionQuestionContent: {
    gap: 10,
    paddingBottom: 1,
  },
  sessionQuestionDescription: {
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 15,
  },
  sessionQuestionGroup: {
    gap: 6,
  },
  sessionQuestionHeaderLabel: {
    color: COLORS.charcoal,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  sessionQuestionPrompt: {
    color: COLORS.ink,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  sessionQuestionOption: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 9,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  sessionQuestionOptionSelected: {
    borderColor: COLORS.amber,
    backgroundColor: '#FFF8E8',
  },
  sessionQuestionOptionMark: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
  },
  sessionQuestionOptionMarkSelected: {
    borderColor: COLORS.amber,
    backgroundColor: COLORS.amber,
  },
  sessionQuestionOptionBody: {
    minWidth: 0,
    flex: 1,
    gap: 1,
  },
  sessionQuestionOptionLabel: {
    color: COLORS.ink,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  sessionQuestionOptionDescription: {
    color: COLORS.muted,
    fontSize: 10,
    lineHeight: 13,
  },
  sessionQuestionActionRow: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sessionQuestionActionHint: {
    flex: 1,
    color: COLORS.muted,
    fontSize: 10,
    lineHeight: 14,
  },
  sessionQuestionSubmit: {
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: COLORS.charcoal,
    paddingHorizontal: 14,
  },
  sessionQuestionSubmitDisabled: {
    opacity: 0.4,
  },
  sessionQuestionSubmitText: {
    color: COLORS.surface,
    fontSize: 11,
    fontWeight: '700',
  },
  sessionInputBar: {
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
    paddingTop: 7,
    paddingBottom: Platform.OS === 'ios' ? 10 : 12,
    gap: 4,
  },
  sessionInputFailure: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1C7C3',
    backgroundColor: '#FFF5F4',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  sessionInputFailureBody: {
    minWidth: 0,
    flex: 1,
    gap: 1,
  },
  sessionInputFailureMessage: {
    color: COLORS.ink,
    fontSize: 12,
    fontWeight: '700',
  },
  sessionInputFailureDetail: {
    color: COLORS.muted,
    fontSize: 10,
    lineHeight: 13,
  },
  sessionInputFailureAction: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 7,
    backgroundColor: COLORS.surface,
  },
  sessionRunStatus: {
    maxWidth: '92%',
    minHeight: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    gap: 5,
  },
  sessionRunProject: {
    minWidth: 0,
    maxWidth: '58%',
    flexShrink: 1,
    color: COLORS.muted,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  sessionRunStatusSeparator: {
    flexShrink: 0,
    color: COLORS.line,
    fontSize: 10,
    lineHeight: 13,
  },
  sessionRunStatusDot: {
    width: 5,
    height: 5,
    flexShrink: 0,
    borderRadius: 3,
  },
  sessionRunStatusLabel: {
    minWidth: 0,
    flexShrink: 1,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '600',
    letterSpacing: 0.05,
    textAlign: 'center',
  },
  sessionInputCount: {
    alignSelf: 'flex-end',
    marginRight: 54,
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  inputMediaShell: {
    gap: 8,
  },
  inputMediaShellCompact: {
    marginTop: -1,
  },
  inputImageRail: {
    gap: 9,
    paddingRight: 8,
  },
  inputImagePreview: {
    position: 'relative',
    width: 62,
    height: 62,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 9,
    backgroundColor: COLORS.page,
  },
  inputImage: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  inputImageEditTarget: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  inputImageRemove: {
    position: 'absolute',
    top: -7,
    right: -7,
    width: 23,
    height: 23,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.surface,
    borderRadius: 12,
    backgroundColor: COLORS.charcoal,
  },
  inputImageEdit: {
    position: 'absolute',
    top: -7,
    left: -7,
    width: 23,
    height: 23,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.surface,
    borderRadius: 12,
    backgroundColor: COLORS.blue,
  },
  inputMediaContextRow: {
    minHeight: 58,
    flexDirection: 'row',
    gap: 8,
  },
  inputMediaContextButton: {
    minWidth: 0,
    flex: 1,
    justifyContent: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 10,
    backgroundColor: COLORS.page,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  inputMediaContextButtonDisabled: {
    opacity: 0.55,
  },
  inputMediaContextLabel: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: '800',
  },
  inputMediaContextValueRow: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  inputMediaContextValue: {
    minWidth: 0,
    flex: 1,
    color: COLORS.charcoal,
    fontSize: 13,
    fontWeight: '800',
  },
  inputMediaHint: {
    alignSelf: 'center',
    flexShrink: 1,
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  composerSurface: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
  },
  composerConfigurationCard: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  composerConfigurationIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#EEF3FF',
  },
  composerConfigurationBody: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  composerConfigurationLabel: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: '800',
  },
  composerConfigurationValue: {
    color: COLORS.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  composerConfigurationMeta: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  composerSurfaceActive: {
    borderColor: COLORS.green,
    shadowColor: COLORS.green,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.14,
    shadowRadius: 5,
  },
  composerVoiceButtonActive: {
    backgroundColor: '#EAF7F2',
  },
  composerTextShell: {
    minWidth: 0,
  },
  composerTextInput: {
    minHeight: 70,
    maxHeight: 132,
    color: COLORS.ink,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 13,
    paddingTop: 12,
    paddingBottom: 10,
  },
  composerToolbar: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: COLORS.faint,
    paddingHorizontal: 7,
    paddingVertical: 5,
  },
  composerToolbarLeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  composerToolbarButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  composerToolbarButtonActive: {
    backgroundColor: COLORS.page,
  },
  composerSendButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: COLORS.green,
  },
  composerSendButtonDisabled: {
    backgroundColor: '#AAA9A3',
  },
  inputToolsTray: {
    minHeight: 112,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    borderRadius: 8,
    backgroundColor: '#F0F0EC',
    padding: 12,
  },
  inputTool: {
    width: 66,
    alignItems: 'center',
    gap: 6,
  },
  inputToolIcon: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: COLORS.surface,
  },
  inputToolText: {
    color: COLORS.charcoal,
    fontSize: 12,
    fontWeight: '700',
  },
  skillPickerLoading: {
    minHeight: 132,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  skillPickerTitleRow: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  skillPickerName: {
    minWidth: 0,
    flex: 1,
  },
  skillPickerCommand: {
    maxWidth: '42%',
    flexShrink: 1,
    borderRadius: 5,
    backgroundColor: '#EFEEE7',
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  homeShell: {
    flex: 1,
  },
  homeScroll: {
    flex: 1,
  },
  homeScrollContent: {
    padding: 18,
    paddingBottom: 20,
    gap: 18,
  },
  connectionContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 18,
  },
  connectionTitle: {
    color: COLORS.ink,
    fontSize: 30,
    fontWeight: '700',
  },
  connectionCopy: {
    color: COLORS.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  homeHeader: {
    gap: 9,
  },
  homeTitle: {
    color: COLORS.ink,
    fontSize: 33,
    fontWeight: '800',
    lineHeight: 37,
  },
  homeSubtitle: {
    maxWidth: 330,
    color: COLORS.muted,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  backButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
  },
  screenTitleBlock: {
    minWidth: 0,
    flex: 1,
    gap: 3,
  },
  kicker: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  title: {
    color: COLORS.ink,
    fontSize: 31,
    fontWeight: '700',
  },
  screenTitle: {
    color: COLORS.ink,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 29,
  },
  screenSubtitle: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  iconButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    padding: 12,
  },
  noticeText: {
    flex: 1,
    color: COLORS.ink,
    fontSize: 14,
    lineHeight: 20,
  },
  noticeActions: {
    alignItems: 'stretch',
    gap: 6,
  },
  noticeRetryButton: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 7,
    paddingHorizontal: 8,
    backgroundColor: COLORS.charcoal,
  },
  noticeRetryText: {
    color: COLORS.surface,
    fontSize: 12,
    fontWeight: '700',
  },
  noticeCopyButton: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 7,
    paddingHorizontal: 8,
    backgroundColor: COLORS.page,
  },
  noticeCopyText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  formGroup: {
    gap: 8,
  },
  label: {
    color: COLORS.ink,
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    height: 50,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    color: COLORS.ink,
    fontSize: 16,
    paddingHorizontal: 14,
  },
  primaryButton: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 8,
    backgroundColor: COLORS.charcoal,
  },
  primaryButtonText: {
    color: COLORS.surface,
    fontSize: 15,
    fontWeight: '700',
  },
  taskCreationActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  taskCreationPrimary: {
    minWidth: 0,
    flex: 1,
  },
  taskCreationMoreButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
  },
  taskCreationMenuSheet: {
    marginTop: 'auto',
    gap: 12,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: COLORS.surface,
    paddingTop: 9,
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  taskCreationMenuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 7,
  },
  taskCreationMenuTitle: {
    color: COLORS.ink,
    fontSize: 21,
    fontWeight: '800',
  },
  taskCreationMenuOption: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 12,
    backgroundColor: COLORS.page,
    padding: 12,
  },
  taskCreationMenuOptionIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#E8E6DC',
  },
  taskCreationMenuOptionBody: {
    minWidth: 0,
    flex: 1,
    gap: 3,
  },
  taskCreationMenuOptionLabel: {
    color: COLORS.ink,
    fontSize: 16,
    fontWeight: '800',
  },
  taskCreationMenuOptionMeta: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  buttonPressed: {
    opacity: 0.78,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  profileScreen: {
    gap: 18,
  },
  profileAccountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: 1,
    borderColor: COLORS.charcoal,
    borderRadius: 8,
    backgroundColor: COLORS.charcoal,
    padding: 15,
  },
  profileAccountMain: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  profileAvatar: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 23,
    backgroundColor: '#E7E4DC',
  },
  profileAvatarImage: {
    width: '100%',
    height: '100%',
  },
  profileAvatarText: {
    color: COLORS.charcoal,
    fontSize: 19,
    fontWeight: '800',
  },
  profileAccountText: {
    minWidth: 0,
    flex: 1,
    gap: 3,
  },
  profileAccountName: {
    color: COLORS.surface,
    fontSize: 17,
    fontWeight: '800',
  },
  profileAccountMeta: {
    color: '#D8D4CB',
    fontSize: 12,
    fontWeight: '600',
  },
  profileStatePill: {
    borderRadius: 12,
    backgroundColor: '#555A60',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  profileStatePillActive: {
    backgroundColor: '#EAF7F2',
  },
  profileStateText: {
    color: '#E7E4DC',
    fontSize: 11,
    fontWeight: '800',
  },
  profileStateTextActive: {
    color: COLORS.green,
  },
  profileMetricsGrid: {
    flexDirection: 'row',
    gap: 9,
  },
  profileMetric: {
    minWidth: 0,
    flex: 1,
    gap: 4,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    padding: 11,
  },
  profileMetricValue: {
    color: COLORS.ink,
    fontSize: 24,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.4,
  },
  profileMetricLabel: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  profileProjectList: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
  },
  profileProjectRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.faint,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  profileProjectName: {
    minWidth: 0,
    flex: 1,
    color: COLORS.ink,
    fontSize: 13,
    fontWeight: '700',
  },
  profileProjectState: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  profileEmptyText: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: '600',
    padding: 13,
  },
  profileUsageCard: {
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    padding: 14,
  },
  profileUsagePrimary: {
    gap: 5,
  },
  profileUsageReading: {
    alignItems: 'baseline',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  profileUsageLabel: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  profileUsageValue: {
    color: COLORS.ink,
    fontSize: 38,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: -1.2,
    lineHeight: 44,
  },
  profileUsageUnit: {
    color: COLORS.muted,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 22,
  },
  profileUsageDivider: {
    height: 1,
    marginVertical: 13,
    backgroundColor: COLORS.faint,
  },
  profileUsageStats: {
    flexDirection: 'row',
    gap: 9,
  },
  profileDataCell: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  profileDataValue: {
    color: COLORS.ink,
    fontSize: 19,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.35,
    lineHeight: 23,
  },
  profileDataValuePositive: {
    color: COLORS.green,
  },
  profileDataDetail: {
    color: COLORS.muted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
    lineHeight: 15,
  },
  profileDataLabel: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  profileCloudCard: {
    gap: 12,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    padding: 13,
  },
  profileCloudRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  profileCloudIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#EFEEE7',
  },
  profileCloudIconActive: {
    backgroundColor: '#EAF7F2',
  },
  profileCloudBody: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  profileCloudLabel: {
    color: COLORS.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  profileCloudDetail: {
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  profileCloudValue: {
    maxWidth: 100,
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'right',
  },
  profileCloudValueActive: {
    color: COLORS.green,
  },
  profileCloudDivider: {
    height: 1,
    backgroundColor: COLORS.faint,
  },
  disconnectDesktopButton: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: COLORS.page,
  },
  disconnectDesktopButtonText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  section: {
    gap: 12,
  },
  taskContextCard: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
  },
  taskContextHeader: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 13,
  },
  taskContextIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#EFEEE7',
  },
  taskContextBody: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  taskContextKicker: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  taskContextTitle: {
    color: COLORS.ink,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 21,
  },
  taskContextMeta: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  taskContextTrailing: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
  },
  taskContextDetails: {
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.faint,
    paddingHorizontal: 13,
    paddingTop: 10,
    paddingBottom: 13,
  },
  summaryPanel: {
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    padding: 13,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: COLORS.ink,
    fontSize: 18,
    fontWeight: '700',
  },
  sectionMeta: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  sectionAction: {
    color: COLORS.blue,
    fontSize: 13,
    fontWeight: '800',
  },
  scopeControl: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: '#EFEEE7',
    padding: 3,
  },
  scopeButton: {
    minHeight: 36,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  scopeButtonActive: {
    backgroundColor: COLORS.surface,
  },
  scopeButtonText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  scopeButtonTextActive: {
    color: COLORS.ink,
  },
  taskProjectScope: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  taskProjectScopeIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#EFEEE7',
  },
  taskProjectScopeBody: {
    minWidth: 0,
    flex: 1,
    gap: 3,
  },
  taskProjectScopeLabel: {
    color: COLORS.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  taskProjectScopeMeta: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  taskListSort: {
    marginTop: 8,
    marginBottom: 2,
  },
  newTaskOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 14,
    backgroundColor: 'rgba(23, 23, 23, 0.42)',
  },
  newTaskWindow: {
    maxHeight: '88%',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 18,
    backgroundColor: COLORS.surface,
  },
  newTaskWindowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.faint,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
  },
  newTaskWindowHeaderTitleBlock: {
    minWidth: 0,
    flex: 1,
    gap: 2,
    paddingRight: 12,
  },
  newTaskWindowEyebrow: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  newTaskWindowTitle: {
    color: COLORS.ink,
    fontSize: 22,
    fontWeight: '800',
  },
  newTaskWindowClose: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 19,
    backgroundColor: COLORS.page,
  },
  newTaskWindowContent: {
    padding: 18,
  },
  projectPickerOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(23, 23, 23, 0.42)',
  },
  projectPickerSheet: {
    height: '72%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: COLORS.surface,
    paddingTop: 9,
  },
  sessionDisplaySettingsSheet: {
    maxHeight: '78%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: COLORS.surface,
    paddingTop: 9,
  },
  mobileDemandSettingsSheet: {
    maxHeight: '90%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: COLORS.surface,
    paddingTop: 9,
  },
  mobileDemandSettingsContent: {
    gap: 22,
    borderTopWidth: 1,
    borderTopColor: COLORS.faint,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
  },
  mobileSettingsHint: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  mobileSettingsGroup: {
    gap: 10,
  },
  mobileSettingsGroupTitle: {
    color: COLORS.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  mobileSettingsFootnote: {
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  mobileDropdownTrigger: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  mobileDropdownTriggerBody: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  mobileDropdownLabel: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  mobileDropdownValue: {
    color: COLORS.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  mobileDropdownOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(23, 23, 23, 0.42)',
  },
  mobileDropdownSheet: {
    maxHeight: '68%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: COLORS.surface,
    paddingTop: 9,
  },
  mobileDropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.faint,
    paddingHorizontal: 18,
    paddingTop: 13,
    paddingBottom: 11,
  },
  mobileDropdownTitle: {
    color: COLORS.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  mobileDropdownClose: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 17,
    backgroundColor: COLORS.page,
  },
  mobileDropdownContent: {
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  mobileDropdownOption: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  mobileDropdownOptionSelected: {
    backgroundColor: '#F2F0E9',
  },
  mobileDropdownOptionIcon: {
    width: 28,
    color: COLORS.ink,
    fontSize: 19,
    textAlign: 'center',
  },
  mobileDropdownOptionBody: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  mobileDropdownOptionLabel: {
    color: COLORS.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  mobileDropdownOptionDescription: {
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  mobileSettingsFieldLabel: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  mobileSettingsTextInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 9,
    backgroundColor: COLORS.page,
    color: COLORS.ink,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sessionRuntimeIdentityCard: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 10,
    backgroundColor: COLORS.page,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  sessionRuntimeIdentityIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: COLORS.surface,
  },
  sessionRuntimeIdentityIconText: {
    color: COLORS.ink,
    fontSize: 19,
  },
  sessionRuntimeIdentityBody: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  sessionRuntimeIdentityName: {
    color: COLORS.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  sessionRuntimeIdentityMeta: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  sessionDisplaySettingsContent: {
    gap: 22,
    borderTopWidth: 1,
    borderTopColor: COLORS.faint,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 22,
  },
  sessionDisplaySettingsGroup: {
    gap: 11,
  },
  sessionDisplaySettingsHeading: {
    gap: 3,
  },
  sessionDisplaySettingsLabel: {
    color: COLORS.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  sessionDisplaySettingsDescription: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  projectPickerHandle: {
    width: 42,
    height: 4,
    alignSelf: 'center',
    borderRadius: 2,
    backgroundColor: COLORS.line,
  },
  projectPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 15,
    paddingBottom: 12,
  },
  attributionPickerHeaderLead: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingRight: 12,
  },
  projectPickerTitleBlock: {
    gap: 2,
  },
  projectPickerEyebrow: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  projectPickerTitle: {
    color: COLORS.ink,
    fontSize: 22,
    fontWeight: '800',
  },
  projectPickerClose: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 19,
    backgroundColor: COLORS.page,
  },
  projectPickerSearchArea: {
    borderTopWidth: 1,
    borderTopColor: COLORS.faint,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  projectPickerSearchAreaCompact: {
    borderTopWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  projectPickerSearchField: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 10,
    backgroundColor: COLORS.page,
    paddingHorizontal: 12,
  },
  projectPickerSearchInput: {
    minWidth: 0,
    flex: 1,
    color: COLORS.ink,
    fontSize: 14,
    fontWeight: '600',
    paddingVertical: 9,
  },
  projectPickerSearchClear: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectPickerSort: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.faint,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  projectPickerList: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 18,
  },
  projectPickerListViewport: {
    flex: 1,
  },
  attributionPickerStepHint: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.faint,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  attributionPickerStepHintText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  attributionPickerEmpty: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 28,
  },
  projectPickerOption: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.faint,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  projectPickerOptionSelected: {
    backgroundColor: '#EFEEE7',
  },
  projectPickerOptionIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: COLORS.page,
  },
  projectPickerOptionIconSelected: {
    backgroundColor: COLORS.charcoal,
  },
  projectPickerOptionBody: {
    minWidth: 0,
    flex: 1,
    gap: 3,
  },
  projectPickerOptionLabel: {
    color: COLORS.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  projectPickerOptionMeta: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  taskRow: {
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 7,
  },
  taskRowNested: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.blue,
  },
  projectDirectoryRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    padding: 13,
  },
  projectDirectoryRowActive: {
    borderColor: COLORS.charcoal,
  },
  projectDirectoryIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#EFEEE7',
  },
  projectDirectoryBody: {
    minWidth: 0,
    flex: 1,
    gap: 3,
  },
  projectDirectoryName: {
    color: COLORS.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  projectDirectoryPath: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  projectDirectoryStatus: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  projectDirectoryStatusOpen: {
    color: COLORS.green,
  },
  sessionRow: {
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    padding: 14,
    gap: 10,
  },
  taskTopLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  sessionTopLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  taskName: {
    flex: 1,
    color: COLORS.ink,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 21,
  },
  sessionName: {
    flex: 1,
    color: COLORS.ink,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 21,
  },
  taskSummaryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  taskProject: {
    minWidth: 0,
    flex: 1,
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  taskProjectAndHierarchy: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  taskHierarchyLabel: {
    color: COLORS.blue,
    fontSize: 11,
    fontWeight: '800',
  },
  taskSummaryMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  taskSummaryText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  taskMetaLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  rowDisclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.faint,
    paddingTop: 9,
  },
  rowDisclosureText: {
    flex: 1,
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  detailItem: {
    flexDirection: 'row',
    gap: 10,
  },
  detailLabel: {
    width: 74,
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  detailValue: {
    flex: 1,
    color: COLORS.ink,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  metaItem: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  statusPill: {
    minHeight: 28,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 9,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  emptyState: {
    minHeight: 92,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
  },
  emptyText: {
    color: COLORS.muted,
    fontSize: 14,
    fontWeight: '600',
  },
  transcriptList: {
    gap: 12,
  },
  transcriptBlock: {
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    padding: 14,
    gap: 12,
  },
  transcriptUserBlock: {
    borderColor: COLORS.charcoal,
    backgroundColor: COLORS.charcoal,
  },
  transcriptToolBlock: {
    borderColor: '#D0CCC2',
    backgroundColor: '#F7F6F1',
    padding: 0,
    gap: 0,
    overflow: 'hidden',
  },
  transcriptToolBlockRunning: {
    borderColor: '#A9C2F8',
    backgroundColor: '#F7FAFF',
  },
  transcriptStatusBlock: {
    borderColor: COLORS.faint,
    backgroundColor: '#EFEEE7',
    paddingVertical: 10,
  },
  transcriptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  transcriptHeaderMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  transcriptTitleRow: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  transcriptRoleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.blue,
  },
  transcriptUserDot: {
    backgroundColor: COLORS.surface,
  },
  transcriptToolDot: {
    backgroundColor: COLORS.amber,
  },
  transcriptStatusDot: {
    backgroundColor: COLORS.muted,
  },
  transcriptTitle: {
    minWidth: 0,
    flex: 1,
    color: COLORS.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  transcriptTime: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  transcriptUserText: {
    color: COLORS.surface,
  },
  transcriptUserMeta: {
    color: '#D8D4CB',
  },
  toolCompactRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  toolCompactMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  toolStateText: {
    color: COLORS.green,
    fontSize: 11,
    fontWeight: '800',
  },
  toolStateTextRunning: {
    color: COLORS.blue,
  },
  toolGroupList: {
    gap: 7,
    borderTopWidth: 1,
    borderTopColor: '#D8D4CB',
    padding: 8,
  },
  toolGroupItem: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#DDD9D0',
    borderRadius: 7,
    backgroundColor: COLORS.surface,
  },
  toolGroupItemRunning: {
    borderColor: '#B9CDF7',
    backgroundColor: '#F7FAFF',
  },
  toolGroupItemRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  toolGroupItemTitle: {
    minWidth: 0,
    flex: 1,
    color: COLORS.ink,
    fontSize: 12,
    fontWeight: '700',
  },
  toolExpandedBody: {
    gap: 7,
    borderTopWidth: 1,
    borderTopColor: '#D8D4CB',
    padding: 10,
  },
  toolExpandedTime: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'right',
  },
  markdownStack: {
    gap: 10,
  },
  markdownHeading: {
    color: COLORS.ink,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '800',
  },
  markdownHeading2: {
    fontSize: 18,
    lineHeight: 24,
  },
  markdownHeading3: {
    fontSize: 16,
    lineHeight: 22,
  },
  markdownParagraph: {
    color: COLORS.ink,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '500',
  },
  markdownQuote: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.line,
    paddingLeft: 10,
  },
  markdownQuoteInverted: {
    borderLeftColor: '#D8D4CB',
  },
  markdownQuoteText: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
  },
  markdownList: {
    gap: 7,
  },
  markdownListItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  markdownBullet: {
    width: 24,
    color: COLORS.muted,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '800',
  },
  markdownListText: {
    minWidth: 0,
    flex: 1,
  },
  markdownTable: {
    gap: 8,
  },
  markdownTableCard: {
    gap: 7,
    borderWidth: 1,
    borderColor: COLORS.faint,
    borderRadius: 8,
    backgroundColor: '#FAFAF7',
    padding: 11,
  },
  markdownTableCardInverted: {
    borderColor: '#555A60',
    backgroundColor: '#373B3F',
  },
  markdownTablePrimaryLabel: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  markdownTablePrimaryValue: {
    color: COLORS.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  markdownTableField: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.faint,
    paddingTop: 7,
  },
  markdownTableFieldInverted: {
    borderTopColor: '#555A60',
  },
  markdownTableFieldLabel: {
    width: 58,
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 19,
    fontWeight: '700',
  },
  markdownTableFieldValue: {
    minWidth: 0,
    flex: 1,
    color: COLORS.ink,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
  },
  inlineBold: {
    fontWeight: '800',
  },
  inlineCode: {
    color: COLORS.charcoal,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 13,
    backgroundColor: '#EFEEE7',
  },
  inlineCodeInverted: {
    color: COLORS.surface,
    backgroundColor: '#4A4E52',
  },
  inlineLink: {
    color: COLORS.blue,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  inlineLinkInverted: {
    color: '#D8E6FF',
  },
  renderedCodeBlock: {
    borderWidth: 1,
    borderColor: '#D0CCC2',
    borderRadius: 8,
    backgroundColor: '#111315',
    padding: 11,
    gap: 7,
  },
  renderedCodeLang: {
    color: '#B9B4AA',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  renderedCodeText: {
    color: '#F0EEE6',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 12,
    lineHeight: 17,
  },
  outputHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  readableOutput: {
    gap: 10,
  },
  outputNotice: {
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: '#EFEEE7',
    padding: 10,
  },
  outputNoticeText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  outputBlock: {
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    padding: 14,
  },
  outputCodeBlock: {
    borderColor: '#D0CCC2',
    backgroundColor: '#F1F0EA',
  },
  outputProseText: {
    color: COLORS.ink,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '500',
  },
  outputCodeText: {
    color: COLORS.charcoal,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 12,
    lineHeight: 17,
  },
  terminalBox: {
    minHeight: 360,
    borderWidth: 1,
    borderColor: '#1F2328',
    borderRadius: 8,
    backgroundColor: '#111315',
    padding: 12,
  },
  terminalText: {
    color: '#F0EEE6',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 12,
    lineHeight: 17,
  },
  floatingNewTaskButton: {
    position: 'absolute',
    right: 20,
    bottom: Platform.OS === 'ios' ? 76 : 70,
    zIndex: 4,
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 28,
    backgroundColor: COLORS.charcoal,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 5,
  },
  floatingNewTaskButtonPressed: {
    backgroundColor: '#4B5258',
    transform: [{ scale: 0.94 }],
  },
  bottomTabBar: {
    flexDirection: 'row',
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 8 : 10,
  },
  bottomTabItem: {
    minHeight: 50,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderRadius: 8,
  },
  bottomTabItemActive: {
    backgroundColor: COLORS.charcoal,
  },
  bottomTabLabel: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  bottomTabLabelActive: {
    color: COLORS.surface,
  },
});
