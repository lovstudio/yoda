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
  KeyboardAvoidingView,
  Linking,
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
import {
  MOBILE_GATEWAY_DEFAULT_DEV_TOKEN,
  MOBILE_SESSION_INPUT_MAX_CHARS,
  parseMobilePairingUrl,
  type MobileDashboardSnapshot,
  type MobileProjectSummary,
  type MobileSessionDetail,
  type MobileSessionSummary,
  type MobileSessionTranscriptBlock,
  type MobileTaskActivityStatus,
  type MobileTaskSummary,
} from '../../../src/shared/mobile-api';
import { parseMobileRelayPairingUrl } from '../../../src/shared/mobile-relay';
import {
  createDemand,
  fetchSessionDetail,
  fetchSnapshot,
  fetchTaskSessions,
  sendSessionInput,
  type MobileConnection,
} from './api-client';
import { clearConnection, loadConnection, saveConnection } from './connection-storage';
import { subscribeSessionEvents } from './session-event-stream';

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
const YODA_RELAY_ORIGIN = new URL(
  process.env.EXPO_PUBLIC_YODA_RELAY_ORIGIN?.trim() || 'https://relay.yoda.lovstudio.ai'
).origin;
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
type HomeTab = 'home' | 'tasks' | 'request' | 'projects';
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
      return 'Open project tasks';
    case 'inProgress':
      return 'In progress';
    case 'review':
      return 'Review tasks';
    case 'all':
      return 'Active tasks';
  }
}

function homeTabTitle(tab: HomeTab): { eyebrow: string; title: string; subtitle: string } {
  switch (tab) {
    case 'tasks':
      return {
        eyebrow: 'Tasks',
        title: 'Work queue',
        subtitle: 'Review running sessions and active branches.',
      };
    case 'request':
      return {
        eyebrow: 'New request',
        title: 'Start work',
        subtitle: 'Send a requirement to the desktop agent.',
      };
    case 'projects':
      return {
        eyebrow: 'Projects',
        title: 'Project directory',
        subtitle: 'Open workspaces and local repositories.',
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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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
    pairingUrl:
      candidates.find((url) => parseMobilePairingUrl(url) || parseMobileRelayPairingUrl(url)) ??
      initialUrl,
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
  const [homeTab, setHomeTab] = useState<HomeTab>('home');
  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const [taskScope, setTaskScope] = useState<TaskScope>('all');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [demandProjectId, setDemandProjectId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyPairingUrl = useCallback(async (url: string | null) => {
    if (!url) return false;
    const relayPairing = parseMobileRelayPairingUrl(url);
    let next = parseMobilePairingUrl(url);
    if (relayPairing) {
      if (new URL(relayPairing.relayBaseUrl).origin !== YODA_RELAY_ORIGIN) {
        throw new Error('This pairing code does not use the official Yoda Relay service.');
      }
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

    setConnectDraft(next);
    setConnection(next);
    setSnapshot(null);
    setHomeTab('home');
    setSelectedProjectId('all');
    setTaskScope('all');
    setSelectedTaskId(null);
    setSelectedSessionId(null);
    setError(null);
    await saveConnection(next);
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
        if (initial.devConnection) {
          setConnection(initial.devConnection);
          setConnectDraft(initial.devConnection);
          await saveConnection(initial.devConnection);
          return;
        }
        if (saved) {
          setConnection(saved);
          setConnectDraft(saved);
        }
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

  useEffect(() => {
    if (!connection) return;
    void loadDashboard(false);
    const timer = setInterval(() => {
      void loadDashboard(true);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [connection, loadDashboard]);

  const visibleProjects = useMemo(
    () => snapshot?.projects.filter((project) => !project.isInternal) ?? [],
    [snapshot]
  );

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
    await loadDashboard(false);
    setRefreshing(false);
  }, [loadDashboard]);

  const handleSubmitDemand = useCallback(async () => {
    if (!connection || !prompt.trim() || submitting) return;
    setSubmitting(true);
    try {
      const result = await createDemand(connection, {
        projectId: demandProjectId,
        prompt: prompt.trim(),
      });
      setPrompt('');
      setSelectedProjectId(result.task.projectId);
      setHomeTab('tasks');
      await loadDashboard(true);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }, [connection, demandProjectId, loadDashboard, prompt, submitting]);

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
      <TaskSessionsScreen
        connection={connection}
        projects={snapshot?.projects ?? []}
        task={selectedTask}
        onBack={() => {
          setSelectedTaskId(null);
          setSelectedSessionId(null);
        }}
        onOpenSession={(sessionId) => setSelectedSessionId(sessionId)}
      />
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
            <HomeHeader
              tab={homeTab}
              onDisconnect={() => {
                void clearConnection();
                setConnection(null);
                setSnapshot(null);
                setSelectedTaskId(null);
                setSelectedSessionId(null);
              }}
            />

            {error ? <Notice message={error} tone="error" /> : null}
            {loading && !snapshot ? <ActivityIndicator color={COLORS.charcoal} /> : null}

            {snapshot ? (
              <>
                {homeTab === 'home' ? (
                  <HomeDashboard
                    projects={visibleProjects}
                    recentTasks={recentTasks}
                    snapshot={snapshot}
                    onNewRequest={() => setHomeTab('request')}
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

                {homeTab === 'request' ? (
                  <DemandComposer
                    projects={visibleProjects}
                    prompt={prompt}
                    selectedProjectId={demandProjectId}
                    submitting={submitting}
                    onPromptChange={setPrompt}
                    onProjectChange={setDemandProjectId}
                    onSubmit={handleSubmitDemand}
                  />
                ) : null}

                {homeTab === 'projects' ? (
                  <ProjectDirectory
                    projects={visibleProjects}
                    selectedProjectId={selectedProjectId}
                    onSelect={(projectId) => {
                      setSelectedProjectId(projectId);
                      setTaskScope('all');
                      setSelectedTaskId(null);
                      setSelectedSessionId(null);
                      setHomeTab('tasks');
                    }}
                  />
                ) : null}
              </>
            ) : null}
          </ScrollView>
          <HomeTabBar activeTab={homeTab} onSelect={setHomeTab} />
        </View>
      </KeyboardAvoidingView>
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
          <View style={styles.brandMark}>
            <Ionicons color={COLORS.surface} name="git-network-outline" size={25} />
          </View>
          <Text style={styles.connectionTitle}>Connect to desktop</Text>
          <Text style={styles.connectionCopy}>
            Scan the connection code from the desktop sidebar, or enter the gateway details
            manually.
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

function Notice({ message, tone }: { message: string; tone: 'error' | 'info' }) {
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
        <Pressable
          accessibilityLabel="Copy error message"
          accessibilityRole="button"
          style={({ pressed }) => [styles.noticeCopyButton, pressed ? styles.buttonPressed : null]}
          onPress={() => void copyError()}
        >
          <Ionicons
            color={COLORS.muted}
            name={copied ? 'checkmark-outline' : 'copy-outline'}
            size={17}
          />
          <Text style={styles.noticeCopyText}>{copied ? 'Copied' : 'Copy'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function HomeHeader({ tab, onDisconnect }: { tab: HomeTab; onDisconnect: () => void }) {
  const copy = homeTabTitle(tab);
  return (
    <View style={styles.homeHeader}>
      <View style={styles.homeHeaderTop}>
        <View style={styles.homeBrandRow}>
          <View style={styles.homeBrandMark}>
            <Ionicons color={COLORS.surface} name="git-network-outline" size={18} />
          </View>
          <View>
            <Text style={styles.kicker}>{copy.eyebrow}</Text>
            <Text style={styles.homeConnection}>Desktop connected</Text>
          </View>
        </View>
        <Pressable accessibilityLabel="Disconnect" style={styles.iconButton} onPress={onDisconnect}>
          <Ionicons color={COLORS.charcoal} name="log-out-outline" size={21} />
        </Pressable>
      </View>
      <Text style={styles.homeTitle}>{copy.title}</Text>
      <Text style={styles.homeSubtitle}>{copy.subtitle}</Text>
    </View>
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
            <Text style={styles.quickActionPrimaryText}>New request</Text>
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
            <Text style={styles.quickActionSecondaryText}>Tasks</Text>
          </Pressable>
        </View>
      </View>

      <Metrics selectedScope="all" snapshot={snapshot} onSelectScope={onSelectScope} />

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent work</Text>
          <Pressable accessibilityRole="button" onPress={onOpenTasks}>
            <Text style={styles.sectionAction}>View all</Text>
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
            <Text style={styles.emptyText}>No active tasks yet.</Text>
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
      <ProjectRail
        projects={visibleProjects}
        selectedProjectId={selectedProjectId}
        onSelect={onSelectProject}
      />
      <TaskList
        projects={projects}
        tasks={tasks}
        title={selectedProjectId === 'all' ? taskScopeLabel(selectedScope) : 'Project tasks'}
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
    { label: 'All', value: 'all' },
    { label: 'Open', value: 'open' },
    { label: 'Running', value: 'inProgress' },
    { label: 'Review', value: 'review' },
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

function ProjectDirectory({
  projects,
  selectedProjectId,
  onSelect,
}: {
  projects: MobileProjectSummary[];
  selectedProjectId: string;
  onSelect: (projectId: string) => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Projects</Text>
        <Text style={styles.sectionMeta}>{projects.length}</Text>
      </View>
      {projects.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons color={COLORS.muted} name="folder-open-outline" size={22} />
          <Text style={styles.emptyText}>No projects available.</Text>
        </View>
      ) : (
        projects.map((project) => (
          <Pressable
            key={project.id}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.projectDirectoryRow,
              selectedProjectId === project.id ? styles.projectDirectoryRowActive : null,
              pressed ? styles.buttonPressed : null,
            ]}
            onPress={() => onSelect(project.id)}
          >
            <View style={styles.projectDirectoryIcon}>
              <Ionicons
                color={project.isOpen ? COLORS.green : COLORS.muted}
                name={project.isOpen ? 'desktop-outline' : 'folder-outline'}
                size={18}
              />
            </View>
            <View style={styles.projectDirectoryBody}>
              <Text style={styles.projectDirectoryName} numberOfLines={1}>
                {project.displayName}
              </Text>
              <Text style={styles.projectDirectoryPath} numberOfLines={1}>
                {project.path}
              </Text>
            </View>
            <Text
              style={[
                styles.projectDirectoryStatus,
                project.isOpen ? styles.projectDirectoryStatusOpen : null,
              ]}
            >
              {project.isOpen ? 'Open' : 'Idle'}
            </Text>
          </Pressable>
        ))
      )}
    </View>
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
    { icon: 'grid-outline', label: 'Home', value: 'home' },
    { icon: 'checkmark-circle-outline', label: 'Tasks', value: 'tasks' },
    { icon: 'add-circle-outline', label: 'New', value: 'request' },
    { icon: 'folder-open-outline', label: 'Projects', value: 'projects' },
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
      label: 'Projects',
      value: snapshot.metrics.projectCount,
      icon: 'folder-outline',
      scope: 'all',
    },
    {
      label: 'Open',
      value: snapshot.metrics.openProjectCount,
      icon: 'desktop-outline',
      scope: 'open',
    },
    {
      label: 'Progress',
      value: snapshot.metrics.inProgressTaskCount,
      icon: 'flash-outline',
      scope: 'inProgress',
    },
    {
      label: 'Review',
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

function ProjectRail({
  projects,
  selectedProjectId,
  onSelect,
}: {
  projects: MobileProjectSummary[];
  selectedProjectId: string;
  onSelect: (projectId: string) => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Projects</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rail}
      >
        <ProjectChip
          active={selectedProjectId === 'all'}
          label="All"
          meta={`${projects.length}`}
          onPress={() => onSelect('all')}
        />
        {projects.map((project) => (
          <ProjectChip
            key={project.id}
            active={selectedProjectId === project.id}
            label={project.displayName}
            meta={project.isOpen ? 'Open' : 'Idle'}
            onPress={() => onSelect(project.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function ProjectChip({
  active,
  label,
  meta,
  onPress,
}: {
  active: boolean;
  label: string;
  meta: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.projectChip,
        active ? styles.projectChipActive : null,
        pressed ? styles.buttonPressed : null,
      ]}
      onPress={onPress}
    >
      <Text
        style={[styles.projectChipLabel, active ? styles.projectChipLabelActive : null]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text style={[styles.projectChipMeta, active ? styles.projectChipMetaActive : null]}>
        {meta}
      </Text>
    </Pressable>
  );
}

function DemandComposer({
  projects,
  prompt,
  selectedProjectId,
  submitting,
  onPromptChange,
  onProjectChange,
  onSubmit,
}: {
  projects: MobileProjectSummary[];
  prompt: string;
  selectedProjectId: string | null;
  submitting: boolean;
  onPromptChange: (prompt: string) => void;
  onProjectChange: (projectId: string | null) => void;
  onSubmit: () => void;
}) {
  const canSubmit = prompt.trim().length > 0 && !submitting;
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>New request</Text>
      </View>
      <TextInput
        multiline
        placeholder="Describe the requirement..."
        placeholderTextColor="#9A958C"
        style={styles.promptInput}
        textAlignVertical="top"
        value={prompt}
        onChangeText={onPromptChange}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rail}
      >
        <ProjectChip
          active={selectedProjectId === null}
          label="Drafts"
          meta="Default"
          onPress={() => onProjectChange(null)}
        />
        {projects.map((project) => (
          <ProjectChip
            key={project.id}
            active={selectedProjectId === project.id}
            label={project.displayName}
            meta={project.isOpen ? 'Open' : 'Will open'}
            onPress={() => onProjectChange(project.id)}
          />
        ))}
      </ScrollView>
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
          <ActivityIndicator color={COLORS.surface} />
        ) : (
          <>
            <Ionicons color={COLORS.surface} name="arrow-up-outline" size={18} />
            <Text style={styles.primaryButtonText}>Start request</Text>
          </>
        )}
      </Pressable>
    </View>
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
  onOpenSession,
}: {
  connection: MobileConnection;
  projects: MobileProjectSummary[];
  task: MobileTaskSummary;
  onBack: () => void;
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
          label={session.acceptsInput ? 'Live' : session.running ? 'Detached' : 'Stopped'}
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
  const [sendingInput, setSendingInput] = useState(false);
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

  const handleSendInput = useCallback(async () => {
    const input = sessionInput.trim();
    if (!input || !detail?.session.acceptsInput || sendingInput) return;

    setSendingInput(true);
    try {
      await sendSessionInput(connection, task.projectId, task.id, sessionId, { input });
      setSessionInput('');
      setBottomState(true);
      await loadDetail(true);
      scrollToBottom(true);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSendingInput(false);
    }
  }, [
    connection,
    detail?.session.acceptsInput,
    loadDetail,
    scrollToBottom,
    sendingInput,
    sessionId,
    sessionInput,
    setBottomState,
    task.id,
    task.projectId,
  ]);

  const session = detail?.session;
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
            runtimeStatus={detail?.session.runtimeStatus ?? null}
            sending={sendingInput}
            value={sessionInput}
            onChange={setSessionInput}
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

function SessionInputComposer({
  live,
  acceptsInput,
  runtimeStatus,
  sending,
  value,
  onChange,
  onSend,
}: {
  live: boolean;
  acceptsInput: boolean;
  runtimeStatus: MobileSessionSummary['runtimeStatus'] | null;
  sending: boolean;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
}) {
  const canSend = acceptsInput && value.trim().length > 0 && !sending;
  return (
    <View style={styles.sessionInputBar}>
      <SessionRuntimeStatus
        acceptsInput={acceptsInput}
        live={live}
        runtimeStatus={runtimeStatus}
        valueLength={value.length}
      />
      <View style={styles.sessionInputRow}>
        <TextInput
          autoCapitalize="sentences"
          maxLength={MOBILE_SESSION_INPUT_MAX_CHARS}
          multiline
          placeholder="Send a follow-up..."
          placeholderTextColor="#9A958C"
          scrollEnabled
          style={styles.sessionInput}
          textAlignVertical="top"
          value={value}
          onChangeText={onChange}
        />
        <Pressable
          accessibilityLabel="Send input to session"
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          style={({ pressed }) => [
            styles.sessionSendButton,
            !canSend ? styles.buttonDisabled : null,
            pressed ? styles.buttonPressed : null,
          ]}
          onPress={onSend}
        >
          {sending ? (
            <ActivityIndicator color={COLORS.surface} />
          ) : (
            <Ionicons color={COLORS.surface} name="arrow-up-outline" size={20} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

function SessionRuntimeStatus({
  acceptsInput,
  live,
  runtimeStatus,
  valueLength,
}: {
  acceptsInput: boolean;
  live: boolean;
  runtimeStatus: MobileSessionSummary['runtimeStatus'] | null;
  valueLength: number;
}) {
  const presentation = sessionRuntimePresentation(runtimeStatus);
  const detail = acceptsInput
    ? runtimeStatus === 'completed'
      ? 'This turn is complete. You can send a follow-up.'
      : 'Live input is available.'
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
    gap: 7,
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
  sessionInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 9,
  },
  sessionInput: {
    minHeight: 44,
    maxHeight: 112,
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: COLORS.page,
    color: COLORS.ink,
    fontSize: 15,
    lineHeight: 21,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
  },
  sessionSendButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: COLORS.charcoal,
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
  brandMark: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: COLORS.charcoal,
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
  homeBrandMark: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: COLORS.charcoal,
  },
  homeConnection: {
    color: COLORS.green,
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
  promptInput: {
    minHeight: 118,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    color: COLORS.ink,
    fontSize: 16,
    lineHeight: 22,
    padding: 14,
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
  rail: {
    gap: 9,
    paddingRight: 2,
  },
  projectChip: {
    width: 126,
    minHeight: 58,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
    paddingVertical: 9,
    justifyContent: 'space-between',
  },
  projectChipActive: {
    borderColor: COLORS.charcoal,
    backgroundColor: COLORS.charcoal,
  },
  projectChipLabel: {
    color: COLORS.ink,
    fontSize: 14,
    fontWeight: '700',
  },
  projectChipLabelActive: {
    color: COLORS.surface,
  },
  projectChipMeta: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  projectChipMetaActive: {
    color: '#D8D4CB',
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
