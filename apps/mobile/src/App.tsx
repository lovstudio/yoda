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
import {
  appendMobileVoiceTranscript,
  canContinueMobileSession,
  getMobileProjectActivityById,
  MOBILE_GATEWAY_DEFAULT_DEV_TOKEN,
  MOBILE_SESSION_INPUT_MAX_CHARS,
  parseMobilePairingUrl,
  parseMobileTimestamp,
  sortMobileProjects,
  type MobileDashboardSnapshot,
  type MobileProfileSnapshot,
  type MobileProjectSortMode,
  type MobileProjectSummary,
  type MobileSessionDetail,
  type MobileSessionSummary,
  type MobileSessionTranscriptBlock,
  type MobileTaskActivityStatus,
  type MobileTaskSummary,
} from '../../../src/shared/mobile-api';
import {
  canonicalizeMobileRelayPairing,
  parseMobileRelayPairingUrl,
} from '../../../src/shared/mobile-relay';
import {
  createDemand,
  discardInputAttachment,
  fetchProfile,
  fetchSessionDetail,
  fetchSnapshot,
  fetchTaskSessions,
  sendSessionInput,
  type MobileConnection,
} from './api-client';
import {
  explicitMobilePairingUrl,
  selectMobileConnectionBootstrapFallback,
} from './connection-bootstrap';
import { clearConnection, loadConnection, saveConnection } from './connection-storage';
import { prepareCreatedDemandNavigation } from './demand-navigation';
import { pickMobileInputImages } from './input-media';
import {
  uploadMobileInputImages,
  type MobileImageDraft,
  type MobileInputUploadProgress,
} from './input-upload';
import { subscribeSessionEvents } from './session-event-stream';
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
type HomeTab = 'home' | 'tasks' | 'profile';
type SessionOutputMode = 'rendered' | 'raw';

type ReadableOutputBlock = {
  id: string;
  kind: 'prose' | 'code';
  text: string;
};

type ReadableOutput = {
  blocks: ReadableOutputBlock[];
  omittedCount: number;
};

type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; language?: string; text: string };

type InlineMarkdownToken =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; url: string };

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

function homeTabTitle(tab: HomeTab): { eyebrow: string; title: string; subtitle: string } {
  switch (tab) {
    case 'tasks':
      return {
        eyebrow: '任务',
        title: '任务队列',
        subtitle: '集中查看进行中的会话与任务状态。',
      };
    case 'profile':
      return {
        eyebrow: '我的',
        title: '我的工作台',
        subtitle: '查看账号、用量、工作进度与云端服务。',
      };
    case 'home':
      return {
        eyebrow: 'Yoda Mobile',
        title: 'Command center',
        subtitle: 'Monitor desktop work and keep requests moving.',
      };
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

function summarizeToolContent(value: string): string {
  const compacted = value.replace(/\s+/g, ' ').trim();
  if (!compacted) return 'No tool output.';
  return compacted.length > 132 ? `${compacted.slice(0, 132)}...` : compacted;
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

function parseMarkdownBlocks(value: string): MarkdownBlock[] {
  const lines = value.replace(/\r/g, '').split('\n');
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let index = 0;

  const flushParagraph = () => {
    const text = paragraph.join('\n').trim();
    if (text) blocks.push({ kind: 'paragraph', text });
    paragraph = [];
  };

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      index += 1;
      continue;
    }

    const fence = trimmed.match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (fence) {
      flushParagraph();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        codeLines.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ kind: 'code', language: fence[1], text: codeLines.join('\n').trimEnd() });
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test((lines[index] ?? '').trim())) {
        quoteLines.push((lines[index] ?? '').trim().replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ kind: 'quote', text: quoteLines.join('\n').trim() });
      continue;
    }

    const listMatch = trimmed.match(/^((?:[-*+])|\d+[.)])\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      const ordered = /\d+[.)]/.test(listMatch[1]);
      const items: string[] = [];
      while (index < lines.length) {
        const current = (lines[index] ?? '').trim();
        const item = current.match(/^((?:[-*+])|\d+[.)])\s+(.+)$/);
        if (!item || /\d+[.)]/.test(item[1]) !== ordered) break;
        items.push(item[2].trim());
        index += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    paragraph.push(line);
    index += 1;
  }

  flushParagraph();
  return blocks;
}

function tokenizeInlineMarkdown(value: string): InlineMarkdownToken[] {
  const tokens: InlineMarkdownToken[] = [];
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > cursor) {
      tokens.push({ kind: 'text', text: value.slice(cursor, match.index) });
    }

    const raw = match[0];
    if (raw.startsWith('**') || raw.startsWith('__')) {
      tokens.push({ kind: 'bold', text: raw.slice(2, -2) });
    } else if (raw.startsWith('`')) {
      tokens.push({ kind: 'code', text: raw.slice(1, -1) });
    } else {
      const link = raw.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      tokens.push(
        link ? { kind: 'link', text: link[1], url: link[2] } : { kind: 'text', text: raw }
      );
    }

    cursor = match.index + raw.length;
  }

  if (cursor < value.length) {
    tokens.push({ kind: 'text', text: value.slice(cursor) });
  }

  return tokens.length > 0 ? tokens : [{ kind: 'text', text: value }];
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
  const [homeTab, setHomeTab] = useState<HomeTab>('home');
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTaskParent, setNewTaskParent] = useState<MobileTaskSummary | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const [taskScope, setTaskScope] = useState<TaskScope>('all');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [demandProjectId, setDemandProjectId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [demandImages, setDemandImages] = useState<MobileImageDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [demandUploadProgress, setDemandUploadProgress] =
    useState<MobileInputUploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    setHomeTab('home');
    setNewTaskOpen(false);
    setNewTaskParent(null);
    setSelectedProjectId('all');
    setTaskScope('all');
    setSelectedTaskId(null);
    setSelectedSessionId(null);
    setError(null);
    return true;
  }, []);

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
      void applyPairingUrl(url).catch((e: unknown) => {
        setError(errorMessage(e));
      });
    });
    return () => subscription.remove();
  }, [applyPairingUrl]);

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

  const recentTasks = useMemo(
    () =>
      [...(snapshot?.tasks ?? [])]
        .sort((a, b) => {
          const aTime = Date.parse(a.lastInteractedAt ?? a.updatedAt ?? '');
          const bTime = Date.parse(b.lastInteractedAt ?? b.updatedAt ?? '');
          return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
        })
        .slice(0, 4),
    [snapshot]
  );

  useEffect(() => {
    if (!selectedTaskId || selectedTask) return;
    setSelectedTaskId(null);
    setSelectedSessionId(null);
  }, [selectedTask, selectedTaskId]);

  const handleMetricSelect = useCallback((scope: TaskScope) => {
    setTaskScope(scope);
    setSelectedProjectId('all');
    setSelectedTaskId(null);
    setSelectedSessionId(null);
    setHomeTab('tasks');
  }, []);

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
    if (parentTask) setDemandProjectId(parentTask.projectId);
    setNewTaskOpen(true);
  }, []);

  const closeNewTask = useCallback(() => {
    setNewTaskOpen(false);
    setNewTaskParent(null);
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
        parentTaskId: newTaskParent?.id,
        prompt: prompt.trim(),
        attachmentIds,
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
    demandProjectId,
    loadDashboard,
    newTaskParent?.id,
    prompt,
    snapshot,
    submitting,
  ]);

  const newTaskModal = (
    <NewTaskModal
      images={demandImages}
      open={newTaskOpen}
      parentTask={newTaskParent}
      projects={visibleProjects}
      prompt={prompt}
      selectedProjectId={demandProjectId}
      submitting={submitting}
      uploadProgress={demandUploadProgress}
      onClose={closeNewTask}
      onImagesChange={setDemandImages}
      onMediaError={setError}
      onProjectChange={setDemandProjectId}
      onPromptChange={setPrompt}
      onSubmit={handleSubmitDemand}
    />
  );

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
                {homeTab === 'home' ? (
                  <HomeDashboard
                    projects={visibleProjects}
                    recentTasks={recentTasks}
                    snapshot={snapshot}
                    onNewRequest={() => openNewTask()}
                    onOpenTask={setSelectedTaskId}
                    onOpenTasks={() => setHomeTab('tasks')}
                    onSelectScope={handleMetricSelect}
                  />
                ) : null}

                {homeTab === 'tasks' ? (
                  <TasksWorkspace
                    projects={snapshot.projects}
                    selectedProjectId={selectedProjectId}
                    selectedScope={taskScope}
                    tasks={filteredTasks}
                    visibleProjects={visibleProjects}
                    onOpenTask={setSelectedTaskId}
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
      <View style={styles.homeHeaderTop}>
        <View style={styles.homeBrandRow}>
          <YodaBrandMark size={36} />
          <View>
            <Text style={styles.kicker}>{copy.eyebrow}</Text>
            <Text style={styles.homeProductName}>Yoda Mobile</Text>
          </View>
        </View>
      </View>
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

function HomeDashboard({
  projects,
  recentTasks,
  snapshot,
  onNewRequest,
  onOpenTask,
  onOpenTasks,
  onSelectScope,
}: {
  projects: MobileProjectSummary[];
  recentTasks: MobileTaskSummary[];
  snapshot: MobileDashboardSnapshot;
  onNewRequest: () => void;
  onOpenTask: (taskId: string) => void;
  onOpenTasks: () => void;
  onSelectScope: (scope: TaskScope) => void;
}) {
  const primaryTask = recentTasks[0];
  return (
    <>
      <View style={styles.commandPanel}>
        <View style={styles.commandPanelTop}>
          <View>
            <Text style={styles.commandPanelLabel}>Live workspace</Text>
            <Text style={styles.commandPanelValue}>{snapshot.metrics.activeTaskCount}</Text>
          </View>
          <View style={styles.commandPanelBadge}>
            <Ionicons color={COLORS.green} name="radio-outline" size={15} />
            <Text style={styles.commandPanelBadgeText}>Online</Text>
          </View>
        </View>
        <Text style={styles.commandPanelText}>
          {snapshot.metrics.inProgressTaskCount} running · {snapshot.metrics.reviewTaskCount} ready
          for review · {snapshot.metrics.openProjectCount} open projects
        </Text>
        <View style={styles.quickActions}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.quickActionPrimary,
              pressed ? styles.buttonPressed : null,
            ]}
            onPress={onNewRequest}
          >
            <Ionicons color={COLORS.surface} name="add-outline" size={18} />
            <Text style={styles.quickActionPrimaryText}>新建任务</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.quickActionSecondary,
              pressed ? styles.buttonPressed : null,
            ]}
            onPress={onOpenTasks}
          >
            <Ionicons color={COLORS.charcoal} name="list-outline" size={18} />
            <Text style={styles.quickActionSecondaryText}>查看任务</Text>
          </Pressable>
        </View>
      </View>

      <Metrics selectedScope="all" snapshot={snapshot} onSelectScope={onSelectScope} />

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>最近工作</Text>
          <Pressable accessibilityRole="button" onPress={onOpenTasks}>
            <Text style={styles.sectionAction}>查看全部</Text>
          </Pressable>
        </View>
        {primaryTask ? (
          <>
            <TaskRow
              projectLabel={projectName(projects, primaryTask.projectId)}
              task={primaryTask}
              onPress={() => onOpenTask(primaryTask.id)}
            />
            {recentTasks.slice(1, 3).map((task) => (
              <CompactTaskRow
                key={task.id}
                projectLabel={projectName(projects, task.projectId)}
                task={task}
                onPress={() => onOpenTask(task.id)}
              />
            ))}
          </>
        ) : (
          <View style={styles.emptyState}>
            <Ionicons color={COLORS.muted} name="sparkles-outline" size={22} />
            <Text style={styles.emptyText}>还没有任务。</Text>
          </View>
        )}
      </View>
    </>
  );
}

function TasksWorkspace({
  projects,
  selectedProjectId,
  selectedScope,
  tasks,
  visibleProjects,
  onOpenTask,
  onSelectProject,
  onSelectScope,
}: {
  projects: MobileProjectSummary[];
  selectedProjectId: string;
  selectedScope: TaskScope;
  tasks: MobileTaskSummary[];
  visibleProjects: MobileProjectSummary[];
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
  const tabs: Array<{
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    value: HomeTab;
  }> = [
    { icon: 'grid-outline', label: '首页', value: 'home' },
    { icon: 'checkmark-circle-outline', label: '任务', value: 'tasks' },
    { icon: 'person-circle-outline', label: '我的', value: 'profile' },
  ];

  return (
    <View style={styles.bottomTabBar}>
      {tabs.map((tab) => {
        const active = activeTab === tab.value;
        return (
          <Pressable
            key={tab.value}
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

function Metrics({
  selectedScope,
  snapshot,
  onSelectScope,
}: {
  selectedScope: TaskScope;
  snapshot: MobileDashboardSnapshot;
  onSelectScope: (scope: TaskScope) => void;
}) {
  const metrics = [
    {
      label: '项目',
      value: snapshot.metrics.projectCount,
      icon: 'folder-outline',
      scope: 'all',
    },
    {
      label: '已打开',
      value: snapshot.metrics.openProjectCount,
      icon: 'desktop-outline',
      scope: 'open',
    },
    {
      label: '进行中',
      value: snapshot.metrics.inProgressTaskCount,
      icon: 'flash-outline',
      scope: 'inProgress',
    },
    {
      label: '待审阅',
      value: snapshot.metrics.reviewTaskCount,
      icon: 'checkmark-done-outline',
      scope: 'review',
    },
  ] as const;

  return (
    <View style={styles.metricsGrid}>
      {metrics.map((metric) => (
        <Pressable
          key={metric.label}
          accessibilityLabel={`Filter ${metric.label}`}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.metricCard,
            selectedScope === metric.scope ? styles.metricCardActive : null,
            pressed ? styles.buttonPressed : null,
          ]}
          onPress={() => onSelectScope(metric.scope)}
        >
          <Ionicons color={COLORS.charcoal} name={metric.icon} size={18} />
          <Text style={styles.metricValue}>{metric.value}</Text>
          <Text style={styles.metricLabel}>{metric.label}</Text>
        </Pressable>
      ))}
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
  images,
  projects,
  prompt,
  selectedProjectId,
  submitting,
  uploadProgress,
  onPromptChange,
  onProjectChange,
  onImagesChange,
  onMediaError,
  onSubmit,
  projectLocked = false,
}: {
  images: MobileImageDraft[];
  projects: MobileProjectSummary[];
  prompt: string;
  selectedProjectId: string | null;
  submitting: boolean;
  uploadProgress: MobileInputUploadProgress | null;
  onPromptChange: (prompt: string) => void;
  onProjectChange: (projectId: string | null) => void;
  onImagesChange: (images: MobileImageDraft[]) => void;
  onMediaError: (message: string) => void;
  onSubmit: () => void;
  projectLocked?: boolean;
}) {
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const selectedProjectLabel = selectedProject?.displayName ?? 'Drafts';
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
      <InputMediaControls
        disabled={submitting}
        images={images}
        imagesEnabled={imagesEnabled}
        projectSelector={
          projectLocked
            ? undefined
            : {
                label: selectedProjectLabel,
                onPress: () => setProjectPickerOpen(true),
              }
        }
        speechContext={[selectedProject?.displayName, selectedProject?.name]}
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
            textAlignVertical="center"
            value={prompt}
            onChangeText={onPromptChange}
          />
        }
      />
      {!projectLocked ? (
        <ProjectPickerSheet
          eyebrow="新建任务"
          open={projectPickerOpen}
          projects={projects}
          selectedProjectId={selectedProjectId}
          title="选择项目"
          unscopedOption={{
            icon: 'documents-outline',
            label: '草稿箱',
            meta: '不归属具体项目',
          }}
          onClose={() => setProjectPickerOpen(false)}
          onProjectChange={(projectId) => {
            onProjectChange(projectId);
            setProjectPickerOpen(false);
          }}
        />
      ) : null}
      <Pressable
        accessibilityLabel="Submit new mobile request"
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

function NewTaskModal({
  open,
  onClose,
  parentTask = null,
  ...composerProps
}: Omit<Parameters<typeof DemandComposer>[0], 'onSubmit'> & {
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
  parentTask?: MobileTaskSummary | null;
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
            <View>
              <Text style={styles.newTaskWindowEyebrow}>
                {parentTask ? '新建子任务' : '新建任务'}
              </Text>
              <Text style={styles.newTaskWindowTitle} numberOfLines={2}>
                {parentTask ? `在「${parentTask.name}」下开始一项工作` : '开始一项工作'}
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
            <DemandComposer {...composerProps} projectLocked={Boolean(parentTask)} />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
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
  const sortedProjects = useMemo(
    () => sortMobileProjects(projects, sortMode),
    [projects, sortMode]
  );
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
              onPress={onClose}
            >
              <Ionicons color={COLORS.charcoal} name="close-outline" size={22} />
            </Pressable>
          </View>
          <View style={styles.projectPickerSort}>
            <Text style={styles.projectPickerSortLabel}>项目排序</Text>
            <View accessibilityRole="radiogroup" style={styles.projectPickerSortOptions}>
              <DemandProjectSortOption
                active={sortMode === 'recent'}
                label="最近"
                onPress={() => setSortMode('recent')}
              />
              <DemandProjectSortOption
                active={sortMode === 'name'}
                label="名称"
                onPress={() => setSortMode('name')}
              />
              <DemandProjectSortOption
                active={sortMode === 'open'}
                label="已打开"
                onPress={() => setSortMode('open')}
              />
            </View>
          </View>
          <ScrollView
            accessibilityRole="radiogroup"
            contentContainerStyle={styles.projectPickerList}
            keyboardShouldPersistTaps="handled"
            style={styles.projectPickerListViewport}
          >
            <ProjectPickerOption
              icon={unscopedOption.icon}
              label={unscopedOption.label}
              meta={unscopedOption.meta}
              selected={selectedProjectId === null}
              onPress={() => onProjectChange(null)}
            />
            {sortedProjects.map((project) => (
              <ProjectPickerOption
                key={project.id}
                icon={project.isOpen ? 'desktop-outline' : 'folder-outline'}
                label={project.displayName}
                meta={`Active ${formatTimestamp(project.lastActivityAt ?? project.updatedAt)}`}
                selected={selectedProjectId === project.id}
                onPress={() => onProjectChange(project.id)}
              />
            ))}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function DemandProjectSortOption({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`Sort projects by ${label.toLowerCase()}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      style={({ pressed }) => [
        styles.projectPickerSortOption,
        active ? styles.projectPickerSortOptionActive : null,
        pressed ? styles.buttonPressed : null,
      ]}
      onPress={onPress}
    >
      <Text
        style={[
          styles.projectPickerSortOptionText,
          active ? styles.projectPickerSortOptionTextActive : null,
        ]}
      >
        {label}
      </Text>
    </Pressable>
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

function TaskSessionsScreen({
  connection,
  projects,
  task,
  onBack,
  onCreateSubtask,
  onOpenSession,
}: {
  connection: MobileConnection;
  projects: MobileProjectSummary[];
  task: MobileTaskSummary;
  onBack: () => void;
  onCreateSubtask: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const [sessions, setSessions] = useState<MobileSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

        <View style={styles.summaryPanel}>
          <DetailItem label="Status" value={statusLabel(task.status)} />
          <DetailItem label="Branch" value={task.taskBranch ?? 'No branch'} />
          <DetailItem
            label="Providers"
            value={Object.keys(task.runtimeCounts).join(', ') || 'None'}
          />
          <DetailItem label="Updated" value={formatTimestamp(task.updatedAt)} />
        </View>

        <Pressable
          accessibilityLabel="在当前任务下新建子任务并启动 Session"
          accessibilityRole="button"
          style={({ pressed }) => [styles.primaryButton, pressed ? styles.buttonPressed : null]}
          onPress={onCreateSubtask}
        >
          <Ionicons color={COLORS.surface} name="add-circle-outline" size={18} />
          <Text style={styles.primaryButtonText}>新建子任务并启动 Session</Text>
        </Pressable>

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
  projects,
  sessionId,
  task,
  onBack,
}: {
  connection: MobileConnection;
  projects: MobileProjectSummary[];
  sessionId: string;
  task: MobileTaskSummary;
  onBack: () => void;
}) {
  const scrollViewRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const isAtBottomRef = useRef(true);
  const [detail, setDetail] = useState<MobileSessionDetail | null>(null);
  const [outputMode, setOutputMode] = useState<SessionOutputMode>('rendered');
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [sessionInput, setSessionInput] = useState('');
  const [sessionImages, setSessionImages] = useState<MobileImageDraft[]>([]);
  const [sendingInput, setSendingInput] = useState(false);
  const [sessionUploadProgress, setSessionUploadProgress] =
    useState<MobileInputUploadProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const mountedRef = useRef(true);
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

  const sessionCanContinue = canContinueMobileSession(detail?.session);
  const handleSendInput = useCallback(async () => {
    const input = sessionInput.trim();
    if ((!input && sessionImages.length === 0) || !sessionCanContinue || sendingInput) return;

    setSendingInput(true);
    setSessionUploadProgress(null);
    let attachmentIds: string[] = [];
    try {
      attachmentIds = await uploadMobileInputImages(
        connection,
        sessionImages,
        setSessionUploadProgress
      );
      setSessionUploadProgress(null);
      await sendSessionInput(connection, task.projectId, task.id, sessionId, {
        input,
        attachmentIds,
      });
      setSessionInput('');
      setSessionImages([]);
      setBottomState(true);
      await loadDetail(true);
      scrollToBottom(true);
      setError(null);
    } catch (e) {
      await Promise.all(
        attachmentIds.map((attachmentId) =>
          discardInputAttachment(connection, attachmentId).catch(() => undefined)
        )
      );
      setError(errorMessage(e));
    } finally {
      setSessionUploadProgress(null);
      setSendingInput(false);
    }
  }, [
    connection,
    loadDetail,
    scrollToBottom,
    sendingInput,
    sessionCanContinue,
    sessionId,
    sessionImages,
    sessionInput,
    setBottomState,
    task.id,
    task.projectId,
  ]);

  const session = detail?.session;
  const taskProject = projects.find((project) => project.id === task.projectId);
  const output = detail?.content.trimEnd() ?? '';
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
            projectLabel={projectName(projects, task.projectId)}
            title={session?.title ?? task.name}
            onBack={onBack}
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
                <View style={styles.summaryPanel}>
                  <DetailItem label="Agent" value={detail.session.runtimeId} />
                  <DetailItem label="Status" value={runtimeLabel(detail.session.runtimeStatus)} />
                  <DetailItem label="Source" value={contentSourceLabel(detail.source)} />
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
                <OutputModeToggle mode={outputMode} onChange={setOutputMode} />
                {outputMode === 'rendered' ? (
                  <RenderedSessionTranscript detail={detail} fallbackOutput={output} />
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
              <Text style={styles.scrollToBottomText}>Bottom</Text>
            </Pressable>
          ) : null}
          <SessionInputComposer
            live={detail?.session.running ?? false}
            acceptsInput={detail?.session.acceptsInput ?? false}
            resumable={detail?.session.resumable ?? false}
            images={sessionImages}
            imagesEnabled={
              projects.find((project) => project.id === task.projectId)?.type === 'local'
            }
            runtimeStatus={detail?.session.runtimeStatus ?? null}
            sending={sendingInput}
            uploadProgress={sessionUploadProgress}
            speechContext={[
              taskProject?.displayName,
              taskProject?.name,
              task.name,
              session?.title,
              session?.runtimeId,
            ]}
            value={sessionInput}
            onChange={setSessionInput}
            onError={setError}
            onImagesChange={setSessionImages}
            onSend={handleSendInput}
          />
        </View>
      </KeyboardAvoidingView>
    </SwipeBackScreen>
  );
}

function SessionNavigationBar({
  projectLabel,
  title,
  onBack,
}: {
  projectLabel: string;
  title: string;
  onBack: () => void;
}) {
  return (
    <View style={styles.sessionNavBar}>
      <Pressable
        accessibilityLabel="Back to sessions"
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.sessionNavBackButton,
          pressed ? styles.buttonPressed : null,
        ]}
        onPress={onBack}
      >
        <Ionicons color={COLORS.charcoal} name="chevron-back-outline" size={22} />
      </Pressable>
      <View style={styles.sessionNavTitleBlock}>
        <Text style={styles.sessionNavEyebrow} numberOfLines={1}>
          Session · {projectLabel}
        </Text>
        <Text style={styles.sessionNavTitle} numberOfLines={1}>
          {title}
        </Text>
      </View>
    </View>
  );
}

function InputMediaControls({
  compact = false,
  disabled,
  images,
  imagesEnabled,
  input,
  canSubmit = false,
  onSubmit,
  projectSelector,
  speechContext = [],
  value,
  onChange,
  onError,
  onImagesChange,
}: {
  compact?: boolean;
  disabled: boolean;
  images: MobileImageDraft[];
  imagesEnabled: boolean;
  input: ReactNode;
  canSubmit?: boolean;
  onSubmit?: () => void;
  projectSelector?: {
    label: string;
    onPress: () => void;
  };
  speechContext?: readonly (string | null | undefined)[];
  value: string;
  onChange: (value: string) => void;
  onError: (message: string) => void;
  onImagesChange: (images: MobileImageDraft[]) => void;
}) {
  const [pickingImages, setPickingImages] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceStarting, setVoiceStarting] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const voiceBaseValueRef = useRef('');
  const voicePressActiveRef = useRef(false);
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

  const handlePickImages = useCallback(async () => {
    if (disabled || pickingImages || !imagesEnabled) return;
    setPickingImages(true);
    try {
      const picked = await pickMobileInputImages();
      if (picked.length > 0) {
        onImagesChange([...images, ...picked]);
        setToolsOpen(false);
      }
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setPickingImages(false);
    }
  }, [disabled, images, imagesEnabled, onError, onImagesChange, pickingImages]);

  const startVoiceInput = useCallback(async () => {
    if (disabled || voiceStarting || voiceActive) return;
    if (Constants.appOwnership === 'expo') {
      onError(
        'Voice input is available in the Yoda Mobile development build. In Expo Go, use the keyboard microphone.'
      );
      return;
    }

    voiceBaseValueRef.current = value;
    setVoiceStarting(true);
    try {
      const session = await startMobileVoiceInput({
        contextualStrings: [...speechContext, value],
        onEnd: disposeVoiceSession,
        onError: (message) => {
          onError(message);
          disposeVoiceSession();
        },
        onResult: (transcript) => {
          onChange(
            appendMobileVoiceTranscript(voiceBaseValueRef.current, transcript).slice(
              0,
              MOBILE_SESSION_INPUT_MAX_CHARS
            )
          );
        },
      });
      voiceSessionRef.current = session;
      setVoiceStarting(false);
      setVoiceActive(true);
      if (!voicePressActiveRef.current) session.stop();
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
    voicePressActiveRef.current = false;
    voiceSessionRef.current?.stop();
  }, []);

  const handleVoicePressIn = useCallback(() => {
    voicePressActiveRef.current = true;
    void startVoiceInput();
  }, [startVoiceInput]);

  const toggleVoiceMode = useCallback(() => {
    if (disabled) return;
    if (voiceMode) stopVoiceInput();
    setVoiceMode((current) => !current);
  }, [disabled, stopVoiceInput, voiceMode]);

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
              <Image source={{ uri: image.uri }} style={styles.inputImage} />
              <Pressable
                accessibilityLabel={`Remove ${image.name}`}
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
      {projectSelector ? (
        <View style={styles.inputMediaContextRow}>
          <Pressable
            accessibilityHint="Opens a scrollable project list"
            accessibilityLabel={`Choose project, current project ${projectSelector.label}`}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            disabled={disabled}
            style={({ pressed }) => [
              styles.inputMediaProjectButton,
              disabled ? styles.buttonDisabled : null,
              pressed ? styles.buttonPressed : null,
            ]}
            onPress={projectSelector.onPress}
          >
            <Ionicons color={COLORS.charcoal} name="folder-outline" size={16} />
            <Text numberOfLines={1} style={styles.inputMediaProjectText}>
              {projectSelector.label}
            </Text>
            <Ionicons color={COLORS.muted} name="chevron-down-outline" size={13} />
          </Pressable>
          <Text style={styles.inputMediaContextHint}>选择任务归属</Text>
        </View>
      ) : null}
      <View style={styles.wechatComposerRow}>
        <Pressable
          accessibilityLabel={voiceMode ? 'Switch to keyboard input' : 'Switch to voice input'}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          hitSlop={5}
          style={({ pressed }) => [
            styles.composerModeButton,
            voiceMode ? styles.composerModeButtonActive : null,
            disabled ? styles.buttonDisabled : null,
            pressed ? styles.buttonPressed : null,
          ]}
          onPress={toggleVoiceMode}
        >
          <Ionicons
            color={voiceMode ? COLORS.green : COLORS.charcoal}
            name={voiceMode ? 'keypad-outline' : 'mic-outline'}
            size={25}
          />
        </Pressable>
        {voiceMode ? (
          <Pressable
            accessibilityHint="Hold while speaking. Release to turn speech into editable text."
            accessibilityLabel={
              voiceActive ? 'Listening. Release to finish voice input' : 'Hold to speak'
            }
            accessibilityRole="button"
            accessibilityState={{ busy: voiceStarting, disabled }}
            disabled={disabled || voiceStarting}
            style={({ pressed }) => [
              styles.voiceHoldButton,
              voiceActive || pressed ? styles.voiceHoldButtonActive : null,
              disabled ? styles.buttonDisabled : null,
            ]}
            onPressIn={handleVoicePressIn}
            onPressOut={stopVoiceInput}
          >
            {voiceStarting ? (
              <ActivityIndicator color={COLORS.green} size="small" />
            ) : (
              <Ionicons
                color={voiceActive ? COLORS.green : COLORS.charcoal}
                name="mic-outline"
                size={18}
              />
            )}
            <Text style={styles.voiceHoldButtonText}>
              {voiceActive ? '松开发送语音' : '按住说话'}
            </Text>
          </Pressable>
        ) : (
          <View style={styles.composerTextShell}>{input}</View>
        )}
        <Pressable
          accessibilityLabel={canSubmit && onSubmit ? 'Send message' : 'More input tools'}
          accessibilityRole="button"
          accessibilityState={{ disabled: disabled || (canSubmit && !onSubmit) }}
          disabled={disabled || (canSubmit && !onSubmit)}
          hitSlop={5}
          style={({ pressed }) => [
            styles.composerTrailingButton,
            canSubmit && onSubmit ? styles.composerSendButton : null,
            disabled ? styles.buttonDisabled : null,
            pressed ? styles.buttonPressed : null,
          ]}
          onPress={() => {
            if (canSubmit && onSubmit) onSubmit();
            else setToolsOpen((current) => !current);
          }}
        >
          <Ionicons
            color={canSubmit && onSubmit ? COLORS.surface : COLORS.charcoal}
            name={canSubmit && onSubmit ? 'arrow-up-outline' : 'add-outline'}
            size={28}
          />
        </Pressable>
      </View>
      {toolsOpen ? (
        <View style={styles.inputToolsTray}>
          <Pressable
            accessibilityLabel="Attach images"
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
          {!imagesEnabled ? <Text style={styles.inputMediaHint}>图片仅支持本地项目</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function SessionInputComposer({
  live,
  acceptsInput,
  resumable,
  images,
  imagesEnabled,
  runtimeStatus,
  sending,
  uploadProgress,
  speechContext,
  value,
  onChange,
  onError,
  onImagesChange,
  onSend,
}: {
  live: boolean;
  acceptsInput: boolean;
  resumable: boolean;
  images: MobileImageDraft[];
  imagesEnabled: boolean;
  runtimeStatus: MobileSessionSummary['runtimeStatus'] | null;
  sending: boolean;
  uploadProgress: MobileInputUploadProgress | null;
  speechContext: readonly (string | null | undefined)[];
  value: string;
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
      <SessionRuntimeStatus
        acceptsInput={acceptsInput}
        live={live}
        resumable={resumable}
        runtimeStatus={runtimeStatus}
        sending={sending}
        uploadProgress={uploadProgress}
        valueLength={value.length}
      />
      <InputMediaControls
        compact
        canSubmit={canSend}
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
            textAlignVertical="center"
            value={value}
            onChangeText={onChange}
          />
        }
        onSubmit={onSend}
        speechContext={speechContext}
        value={value}
        onChange={onChange}
        onError={onError}
        onImagesChange={onImagesChange}
      />
    </View>
  );
}

function SessionRuntimeStatus({
  acceptsInput,
  live,
  resumable,
  runtimeStatus,
  sending,
  uploadProgress,
  valueLength,
}: {
  acceptsInput: boolean;
  live: boolean;
  resumable: boolean;
  runtimeStatus: MobileSessionSummary['runtimeStatus'] | null;
  sending: boolean;
  uploadProgress: MobileInputUploadProgress | null;
  valueLength: number;
}) {
  const presentation = sending
    ? {
        animated: true,
        backgroundColor: '#EFF4FF',
        color: COLORS.blue,
        icon: 'cloud-upload-outline' as const,
        label: uploadProgress ? 'Uploading' : 'Sending',
      }
    : sessionRuntimePresentation(runtimeStatus);
  const detail = uploadProgress
    ? mobileInputUploadProgressText(uploadProgress)
    : sending
      ? 'Resuming the session and sending your message…'
      : acceptsInput
        ? runtimeStatus === 'completed'
          ? 'This turn is complete. You can send a follow-up.'
          : 'Live input is available.'
        : resumable
          ? 'Ready for a follow-up. The session will resume when you send.'
          : live
            ? 'The session is connected but not accepting input.'
            : 'The session is offline.';

  return (
    <View
      accessibilityLabel={`${presentation.label}. ${detail}`}
      accessibilityLiveRegion="polite"
      style={[
        styles.sessionRunStatus,
        { borderColor: presentation.color, backgroundColor: presentation.backgroundColor },
      ]}
    >
      <View style={styles.sessionRunStatusIcon}>
        {presentation.animated ? (
          <ActivityIndicator color={presentation.color} size="small" />
        ) : (
          <Ionicons color={presentation.color} name={presentation.icon} size={20} />
        )}
      </View>
      <View style={styles.sessionRunStatusBody}>
        <Text style={[styles.sessionRunStatusLabel, { color: presentation.color }]}>
          {presentation.label}
        </Text>
        <Text style={styles.sessionRunStatusDetail} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <Text style={styles.sessionInputCount}>
        {valueLength}/{MOBILE_SESSION_INPUT_MAX_CHARS}
      </Text>
    </View>
  );
}

function sessionRuntimePresentation(status: MobileSessionSummary['runtimeStatus'] | null): {
  animated: boolean;
  backgroundColor: string;
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
} {
  switch (status) {
    case 'working':
      return {
        animated: true,
        backgroundColor: '#EEF3FF',
        color: COLORS.blue,
        icon: 'sync-outline',
        label: 'Running',
      };
    case 'awaiting-input':
      return {
        animated: false,
        backgroundColor: '#FFF7E6',
        color: COLORS.amber,
        icon: 'alert-circle-outline',
        label: 'Waiting for input',
      };
    case 'completed':
      return {
        animated: false,
        backgroundColor: '#EAF7F2',
        color: COLORS.green,
        icon: 'checkmark-circle-outline',
        label: 'Completed',
      };
    case 'error':
      return {
        animated: false,
        backgroundColor: '#FFF0EE',
        color: COLORS.red,
        icon: 'close-circle-outline',
        label: 'Run failed',
      };
    case 'idle':
      return {
        animated: false,
        backgroundColor: '#F1F0EA',
        color: COLORS.muted,
        icon: 'pause-circle-outline',
        label: 'Idle',
      };
    case null:
      return {
        animated: false,
        backgroundColor: '#F1F0EA',
        color: COLORS.muted,
        icon: 'ellipsis-horizontal-circle-outline',
        label: 'Loading status',
      };
  }
}

function OutputModeToggle({
  mode,
  onChange,
}: {
  mode: SessionOutputMode;
  onChange: (mode: SessionOutputMode) => void;
}) {
  const options: Array<{ label: string; value: SessionOutputMode }> = [
    { label: 'Rendered', value: 'rendered' },
    { label: 'Raw', value: 'raw' },
  ];

  return (
    <View style={styles.outputModeControl}>
      {options.map((option) => {
        const active = option.value === mode;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.outputModeButton,
              active ? styles.outputModeButtonActive : null,
              pressed ? styles.buttonPressed : null,
            ]}
            onPress={() => onChange(option.value)}
          >
            <Text style={[styles.outputModeText, active ? styles.outputModeTextActive : null]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function RenderedSessionTranscript({
  detail,
  fallbackOutput,
}: {
  detail: MobileSessionDetail;
  fallbackOutput: string;
}) {
  const transcript = useMemo(
    () => mergeAdjacentAssistantBlocks(detail.transcript),
    [detail.transcript]
  );

  if (detail.transcript.length === 0) {
    return <ReadableSessionOutput output={fallbackOutput} />;
  }

  return (
    <View style={styles.transcriptList}>
      {transcript.map((block) => (
        <TranscriptBlock key={block.id} block={block} />
      ))}
    </View>
  );
}

function TranscriptBlock({ block }: { block: MobileSessionTranscriptBlock }) {
  const [toolExpanded, setToolExpanded] = useState(false);
  const isUser = block.role === 'user';
  const isAssistant = block.role === 'assistant';
  const isTool = block.role === 'tool';
  const isStatus = block.role === 'status';
  const title =
    block.title ??
    (isUser ? 'You' : isAssistant ? 'Codex' : isTool ? 'Command' : isStatus ? 'Status' : 'Message');
  const toggleToolExpanded = useCallback(() => {
    setToolExpanded((current) => !current);
  }, []);
  const showBody = !isTool || toolExpanded;
  const headerContent = (
    <>
      <View style={styles.transcriptTitleRow}>
        <View
          style={[
            styles.transcriptRoleDot,
            isUser ? styles.transcriptUserDot : null,
            isTool ? styles.transcriptToolDot : null,
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
        {isTool ? (
          <Ionicons
            color={COLORS.muted}
            name={toolExpanded ? 'chevron-up-outline' : 'chevron-down-outline'}
            size={17}
          />
        ) : null}
      </View>
    </>
  );

  return (
    <View
      style={[
        styles.transcriptBlock,
        isUser ? styles.transcriptUserBlock : null,
        isTool ? styles.transcriptToolBlock : null,
        isStatus ? styles.transcriptStatusBlock : null,
      ]}
    >
      {isTool ? (
        <Pressable
          accessibilityLabel={`${toolExpanded ? 'Collapse' : 'Expand'} ${title}`}
          accessibilityRole="button"
          style={({ pressed }) => [styles.transcriptHeader, pressed ? styles.buttonPressed : null]}
          onPress={toggleToolExpanded}
        >
          {headerContent}
        </Pressable>
      ) : (
        <View style={styles.transcriptHeader}>{headerContent}</View>
      )}
      {isTool && !toolExpanded ? (
        <Pressable
          accessibilityLabel={`Expand ${title} details`}
          accessibilityRole="button"
          style={({ pressed }) => [styles.toolCollapsedBody, pressed ? styles.buttonPressed : null]}
          onPress={toggleToolExpanded}
        >
          <Text style={styles.toolCollapsedText} numberOfLines={2}>
            {summarizeToolContent(block.content)}
          </Text>
          <Text style={styles.toolCollapsedAction}>Show details</Text>
        </Pressable>
      ) : null}
      {showBody && block.format === 'code' ? (
        <CodeText value={block.content} />
      ) : showBody && block.format === 'plain' ? (
        <Text
          selectable
          style={[styles.markdownParagraph, isUser ? styles.transcriptUserText : null]}
        >
          {block.content}
        </Text>
      ) : showBody ? (
        <RenderedMarkdown value={block.content} inverted={isUser} />
      ) : null}
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
              style={[styles.inlineLink, inverted ? styles.inlineLinkInverted : null]}
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

function TaskList({
  projects,
  tasks,
  title,
  onOpenTask,
}: {
  projects: MobileProjectSummary[];
  tasks: MobileTaskSummary[];
  title: string;
  onOpenTask: (taskId: string) => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionMeta}>{tasks.length}</Text>
      </View>
      {tasks.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons color={COLORS.muted} name="file-tray-outline" size={22} />
          <Text style={styles.emptyText}>No active tasks.</Text>
        </View>
      ) : (
        tasks.map((task) => (
          <TaskRow
            key={task.id}
            projectLabel={projectName(projects, task.projectId)}
            task={task}
            onPress={() => onOpenTask(task.id)}
          />
        ))
      )}
    </View>
  );
}

function TaskRow({
  projectLabel,
  task,
  onPress,
}: {
  projectLabel: string;
  task: MobileTaskSummary;
  onPress: () => void;
}) {
  const bootstrap =
    task.bootstrapStatus.status === 'bootstrapping'
      ? 'Booting'
      : task.bootstrapStatus.status === 'error'
        ? 'Error'
        : task.bootstrapStatus.status === 'ready'
          ? 'Ready'
          : 'Idle';

  return (
    <Pressable
      accessibilityLabel={`Open task ${task.name}`}
      accessibilityRole="button"
      style={({ pressed }) => [styles.taskRow, pressed ? styles.buttonPressed : null]}
      onPress={onPress}
    >
      <View style={styles.taskTopLine}>
        <Text style={styles.taskName} numberOfLines={2}>
          {task.name}
        </Text>
        <View style={[styles.statusPill, { borderColor: statusColor(task.activityStatus) }]}>
          <Text style={[styles.statusText, { color: statusColor(task.activityStatus) }]}>
            {statusLabel(task.activityStatus)}
          </Text>
        </View>
      </View>
      <Text style={styles.taskProject} numberOfLines={1}>
        {projectLabel}
      </Text>
      <View style={styles.taskMetaLine}>
        <MetaItem icon="pulse-outline" label={bootstrap} />
        <MetaItem icon="chatbubbles-outline" label={`${task.conversationCount} sessions`} />
        <MetaItem
          icon="time-outline"
          label={formatTimestamp(task.lastInteractedAt ?? task.updatedAt)}
        />
      </View>
      <View style={styles.rowDisclosure}>
        <Text style={styles.rowDisclosureText}>Sessions</Text>
        <Ionicons color={COLORS.muted} name="chevron-forward-outline" size={16} />
      </View>
    </Pressable>
  );
}

function CompactTaskRow({
  projectLabel,
  task,
  onPress,
}: {
  projectLabel: string;
  task: MobileTaskSummary;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`Open task ${task.name}`}
      accessibilityRole="button"
      style={({ pressed }) => [styles.compactTaskRow, pressed ? styles.buttonPressed : null]}
      onPress={onPress}
    >
      <View style={styles.compactTaskDot} />
      <View style={styles.compactTaskBody}>
        <Text style={styles.compactTaskName} numberOfLines={1}>
          {task.name}
        </Text>
        <Text style={styles.compactTaskProject} numberOfLines={1}>
          {projectLabel} · {formatTimestamp(task.lastInteractedAt ?? task.updatedAt)}
        </Text>
      </View>
      <Ionicons color={COLORS.muted} name="chevron-forward-outline" size={16} />
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sessionNavBackButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: COLORS.page,
  },
  sessionNavTitleBlock: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  sessionNavEyebrow: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  sessionNavTitle: {
    color: COLORS.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  scrollToBottomButton: {
    position: 'absolute',
    right: 18,
    bottom: Platform.OS === 'ios' ? 150 : 142,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 8,
    backgroundColor: COLORS.charcoal,
    paddingHorizontal: 13,
  },
  scrollToBottomText: {
    color: COLORS.surface,
    fontSize: 13,
    fontWeight: '800',
  },
  sessionInputBar: {
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
    paddingTop: 9,
    paddingBottom: Platform.OS === 'ios' ? 10 : 12,
    gap: 8,
  },
  sessionRunStatus: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  sessionRunStatusIcon: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionRunStatusBody: {
    minWidth: 0,
    flex: 1,
    gap: 1,
  },
  sessionRunStatusLabel: {
    fontSize: 13,
    fontWeight: '800',
  },
  sessionRunStatusDetail: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  sessionInputCount: {
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
  inputMediaContextRow: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inputMediaProjectButton: {
    maxWidth: 184,
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 13,
    backgroundColor: '#EFEEE7',
    paddingHorizontal: 8,
  },
  inputMediaProjectText: {
    minWidth: 0,
    flexShrink: 1,
    color: COLORS.charcoal,
    fontSize: 11,
    fontWeight: '800',
  },
  inputMediaContextHint: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  inputMediaHint: {
    alignSelf: 'center',
    flexShrink: 1,
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  wechatComposerRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  composerModeButton: {
    width: 34,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerModeButtonActive: {
    borderRadius: 17,
    backgroundColor: '#EAF7F2',
  },
  composerTextShell: {
    minWidth: 0,
    flex: 1,
  },
  composerTextInput: {
    minHeight: 44,
    maxHeight: 112,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 7,
    backgroundColor: COLORS.surface,
    color: COLORS.ink,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
  },
  voiceHoldButton: {
    minHeight: 44,
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: '#CFCDC6',
    borderRadius: 7,
    backgroundColor: '#F2F1EC',
  },
  voiceHoldButtonActive: {
    borderColor: '#93C6B8',
    backgroundColor: '#EAF7F2',
  },
  voiceHoldButtonText: {
    color: COLORS.charcoal,
    fontSize: 15,
    fontWeight: '700',
  },
  composerTrailingButton: {
    width: 38,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerSendButton: {
    width: 42,
    borderRadius: 8,
    backgroundColor: COLORS.green,
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
  homeHeaderTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  homeBrandRow: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  homeProductName: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
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
  commandPanel: {
    borderWidth: 1,
    borderColor: COLORS.charcoal,
    borderRadius: 8,
    backgroundColor: COLORS.charcoal,
    padding: 16,
    gap: 14,
  },
  commandPanelTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
  },
  commandPanelLabel: {
    color: '#D8D4CB',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  commandPanelValue: {
    color: COLORS.surface,
    fontSize: 42,
    fontWeight: '800',
    lineHeight: 46,
  },
  commandPanelBadge: {
    minHeight: 31,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: '#555A60',
    borderRadius: 8,
    paddingHorizontal: 9,
  },
  commandPanelBadgeText: {
    color: '#D8D4CB',
    fontSize: 12,
    fontWeight: '800',
  },
  commandPanelText: {
    color: '#E7E4DC',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  quickActions: {
    flexDirection: 'row',
    gap: 10,
  },
  quickActionPrimary: {
    minHeight: 44,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 8,
    backgroundColor: COLORS.blue,
  },
  quickActionPrimaryText: {
    color: COLORS.surface,
    fontSize: 14,
    fontWeight: '800',
  },
  quickActionSecondary: {
    minHeight: 44,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#555A60',
    borderRadius: 8,
    backgroundColor: '#F7F7F2',
  },
  quickActionSecondaryText: {
    color: COLORS.charcoal,
    fontSize: 14,
    fontWeight: '800',
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
  buttonPressed: {
    opacity: 0.78,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    width: '48.5%',
    minHeight: 92,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    padding: 13,
    gap: 5,
  },
  metricCardActive: {
    borderColor: COLORS.charcoal,
    backgroundColor: '#EFEEE7',
  },
  metricValue: {
    color: COLORS.ink,
    fontSize: 28,
    fontWeight: '800',
  },
  metricLabel: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: '600',
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
  projectPickerSort: {
    gap: 7,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.faint,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  projectPickerSortLabel: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  projectPickerSortOptions: {
    flexDirection: 'row',
    gap: 3,
    borderRadius: 8,
    backgroundColor: COLORS.page,
    padding: 3,
  },
  projectPickerSortOption: {
    minHeight: 32,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    paddingHorizontal: 8,
  },
  projectPickerSortOptionActive: {
    backgroundColor: COLORS.charcoal,
  },
  projectPickerSortOptionText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  projectPickerSortOptionTextActive: {
    color: COLORS.surface,
  },
  projectPickerList: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 18,
  },
  projectPickerListViewport: {
    flex: 1,
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
    padding: 14,
    gap: 10,
  },
  compactTaskRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  compactTaskDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.blue,
  },
  compactTaskBody: {
    minWidth: 0,
    flex: 1,
    gap: 3,
  },
  compactTaskName: {
    color: COLORS.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  compactTaskProject: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
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
  taskProject: {
    color: COLORS.muted,
    fontSize: 13,
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
    backgroundColor: '#F1F0EA',
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
  toolCollapsedBody: {
    gap: 7,
    borderTopWidth: 1,
    borderTopColor: '#D8D4CB',
    paddingTop: 10,
  },
  toolCollapsedText: {
    color: COLORS.muted,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 12,
    lineHeight: 17,
  },
  toolCollapsedAction: {
    color: COLORS.charcoal,
    fontSize: 12,
    fontWeight: '800',
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
  outputModeControl: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: '#EFEEE7',
    padding: 3,
  },
  outputModeButton: {
    minHeight: 36,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  outputModeButtonActive: {
    backgroundColor: COLORS.surface,
  },
  outputModeText: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  outputModeTextActive: {
    color: COLORS.ink,
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
