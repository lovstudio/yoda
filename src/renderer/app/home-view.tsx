import { useQuery } from '@tanstack/react-query';
import {
  Anchor,
  ArrowUp,
  Bot,
  Briefcase,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Crown,
  FileText,
  Folder,
  FolderOpen,
  GitCompare,
  GitFork,
  Lightbulb,
  Loader2,
  Megaphone,
  Mic,
  Monitor,
  Palette,
  Plus,
  Repeat2,
  Server,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import yodaLogoWhite from '@/assets/images/yoda/yoda_logo_white.svg';
import yodaLogo from '@/assets/images/yoda/yoda_logo.svg';
import {
  applyAgentCommandPrefix,
  buildPromptInjectionPayload,
  getAgentCommandSubmitDelayMs,
} from '@shared/agent-command-prefix';
import type { Agent } from '@shared/agents';
import { BUILTIN_AGENT_KEYS } from '@shared/builtin-agents';
import { INTERNAL_PROJECT_ID } from '@shared/projects';
import { getRuntime, RUNTIME_IDS, type RuntimeId } from '@shared/runtime-registry';
import type { CatalogIndex } from '@shared/skills/types';
import { ensureUniqueTaskDisplayName, taskNameFromPrompt } from '@shared/task-name';
import { useAgents } from '@renderer/features/agents-config/use-agents';
import {
  asMounted,
  getProjectManagerStore,
  getRepositoryStore,
} from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { recordSkillInvocation } from '@renderer/features/skills/skill-usage-stats';
import type { ConversationStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { initialConversationTitle } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { useEffectiveRuntime } from '@renderer/features/tasks/conversations/use-effective-runtime';
import { ProjectSelector } from '@renderer/features/tasks/create-task-modal/project-selector';
import { useRuntimeAutoApproveDefaults } from '@renderer/features/tasks/hooks/useRuntimeAutoApproveDefaults';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { AgentSlotSelector } from '@renderer/lib/components/agent-slot/agent-slot-selector';
import { toast } from '@renderer/lib/hooks/use-toast';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '@renderer/lib/ui/combobox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Textarea } from '@renderer/lib/ui/textarea';
import { isImeComposing } from '@renderer/utils/ime';
import { cn } from '@renderer/utils/utils';
import {
  applyMarkdownEnterEdit,
  applyMarkdownTabEdit,
  type MarkdownTextareaEdit,
  type TextSelection,
} from './markdown-textarea-editing';
import {
  applyPathCompletion,
  buildPathCompletionItems,
  findActivePathMention,
  splitPathMentionQuery,
  type ActivePathMention,
  type PathCompletionItem,
} from './path-mention-autocomplete';

type TaskStrategyKind = 'new-branch' | 'no-worktree';
type HomeRunMode = 'normal' | 'brainstorm' | 'compare' | 'review' | 'team';
type RunHostKind = 'local' | 'ssh';
type SkillShortcutPrefix = '/' | '$';
type TeamRoleId = 'ceo' | 'product' | 'engineering' | 'uiux' | 'operations';
type TeamRuntimeSelection = Record<TeamRoleId, RuntimeId>;

/**
 * Humanize a model id for the run-mode chip, e.g. `claude-opus-4-8` → `Opus 4.8`.
 * Falls back to the raw id when the shape is unfamiliar. `null` (runtime default)
 * is handled by the caller, not here.
 */
function formatModelLabel(model: string): string {
  const known = ['opus', 'sonnet', 'haiku', 'gpt', 'gemini', 'qwen', 'kimi', 'mistral'];
  const segments = model.split(/[-_]/).filter(Boolean);
  const tierIndex = segments.findIndex((segment) => known.includes(segment.toLowerCase()));
  if (tierIndex === -1) return model;
  const tier = segments[tierIndex];
  const version = segments
    .slice(tierIndex + 1)
    .filter((segment) => /\d/.test(segment))
    .join('.');
  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
  return version ? `${tierLabel} ${version}` : tierLabel;
}

interface RunModeInputChrome {
  icon: ComponentType<{ className?: string }>;
  labelKey: string;
  containerClassName: string;
  badgeClassName: string;
}

const MIN_COMPARE_AGENTS = 2;
const MAX_COMPARE_AGENTS = 6;
const REVIEW_MAX_ROUNDS = 3;
const CONVERSATION_TURN_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_COMPARE_RUNTIMES: RuntimeId[] = ['claude', 'codex'];
const DEFAULT_REVIEWER_RUNTIME: RuntimeId = 'claude';
const DEFAULT_TEAM_PROVIDERS: TeamRuntimeSelection = {
  ceo: 'claude',
  product: 'claude',
  engineering: 'codex',
  uiux: 'claude',
  operations: 'codex',
};

const NORMAL_PROMPT_KEY = 'normal:agent';
const REVIEW_IMPLEMENTER_PROMPT_KEY = 'review:implementer';
const REVIEW_REVIEWER_PROMPT_KEY = 'review:reviewer';
const SPEC_PROMPT_KEY = 'brainstorm:agent';

/** The built-in Agent preset a slot defaults to when nothing is selected. */
const SLOT_DEFAULT_BUILTIN_KEY: Record<string, string> = {
  [NORMAL_PROMPT_KEY]: BUILTIN_AGENT_KEYS.general,
  [SPEC_PROMPT_KEY]: BUILTIN_AGENT_KEYS.spec,
  [REVIEW_IMPLEMENTER_PROMPT_KEY]: BUILTIN_AGENT_KEYS.reviewImplementer,
  [REVIEW_REVIEWER_PROMPT_KEY]: BUILTIN_AGENT_KEYS.reviewReviewer,
  'team:ceo': BUILTIN_AGENT_KEYS.teamCeo,
  'team:product': BUILTIN_AGENT_KEYS.teamProduct,
  'team:engineering': BUILTIN_AGENT_KEYS.teamEngineering,
  'team:uiux': BUILTIN_AGENT_KEYS.teamUiux,
  'team:operations': BUILTIN_AGENT_KEYS.teamOperations,
};

function defaultBuiltinKeyForSlot(slotKey: string): string | undefined {
  if (slotKey.startsWith('compare:')) return BUILTIN_AGENT_KEYS.general;
  return SLOT_DEFAULT_BUILTIN_KEY[slotKey];
}
const ADVANCED_INPUT_CONTAINER_CLASS =
  'border-border bg-background-1 ring-1 ring-sky-500/15 focus-within:border-sky-500/30 focus-within:ring-sky-500/25';
const ADVANCED_INPUT_BADGE_CLASS =
  'border-sky-500/25 bg-sky-500/10 text-sky-700 shadow-sm ydark:text-sky-300';

const TEAM_ROLES = [
  {
    id: 'ceo',
    icon: Crown,
    labelKey: 'home.teamRoleCeo',
    taskSuffix: 'ceo',
    builtinKey: BUILTIN_AGENT_KEYS.teamCeo,
  },
  {
    id: 'product',
    icon: Briefcase,
    labelKey: 'home.teamRoleProduct',
    taskSuffix: 'product',
    builtinKey: BUILTIN_AGENT_KEYS.teamProduct,
  },
  {
    id: 'engineering',
    icon: Code2,
    labelKey: 'home.teamRoleEngineering',
    taskSuffix: 'engineering',
    builtinKey: BUILTIN_AGENT_KEYS.teamEngineering,
  },
  {
    id: 'uiux',
    icon: Palette,
    labelKey: 'home.teamRoleUiux',
    taskSuffix: 'uiux',
    builtinKey: BUILTIN_AGENT_KEYS.teamUiux,
  },
  {
    id: 'operations',
    icon: Megaphone,
    labelKey: 'home.teamRoleOperations',
    taskSuffix: 'operations',
    builtinKey: BUILTIN_AGENT_KEYS.teamOperations,
  },
] as const satisfies ReadonlyArray<{
  id: TeamRoleId;
  icon: ComponentType<{ className?: string }>;
  labelKey: string;
  taskSuffix: string;
  builtinKey: string;
}>;

interface SkillShortcutOption {
  value: string;
  label: string;
  description: string;
  command: string;
}

interface ActiveSkillShortcut {
  start: number;
  end: number;
  prefix: SkillShortcutPrefix;
  query: string;
}

function getGreetingKey(hour: number): string {
  if (hour >= 5 && hour < 9) return 'home.greeting.earlyMorning';
  if (hour >= 9 && hour < 12) return 'home.greeting.morning';
  if (hour >= 12 && hour < 14) return 'home.greeting.noon';
  if (hour >= 14 && hour < 18) return 'home.greeting.afternoon';
  if (hour >= 18 && hour < 22) return 'home.greeting.evening';
  return 'home.greeting.lateNight';
}

function insertPromptText(
  value: string,
  selection: { start: number; end: number },
  insertText: string
): { value: string; caret: number } {
  const start = Math.max(0, Math.min(selection.start, value.length));
  const end = Math.max(start, Math.min(selection.end, value.length));
  const before = value.slice(0, start);
  const after = value.slice(end);
  const leading = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
  const trailing = after.length > 0 ? (/^\s/.test(after) ? '' : ' ') : ' ';
  const insertion = `${leading}${insertText}${trailing}`;
  return {
    value: `${before}${insertion}${after}`,
    caret: before.length + insertion.length,
  };
}

// Applies a programmatic edit through the native editing pipeline
// (execCommand) so the browser undo stack (Ctrl/Cmd+Z) keeps working.
// Direct value assignment on a controlled textarea would wipe it.
function applyNativeTextareaEdit(
  textarea: HTMLTextAreaElement,
  nextValue: string,
  selection: TextSelection
): void {
  const current = textarea.value;
  if (current !== nextValue) {
    let prefix = 0;
    const maxShared = Math.min(current.length, nextValue.length);
    while (prefix < maxShared && current[prefix] === nextValue[prefix]) prefix += 1;
    let suffix = 0;
    while (
      suffix < maxShared - prefix &&
      current[current.length - 1 - suffix] === nextValue[nextValue.length - 1 - suffix]
    ) {
      suffix += 1;
    }
    const inserted = nextValue.slice(prefix, nextValue.length - suffix);
    textarea.focus();
    textarea.setSelectionRange(prefix, current.length - suffix);
    const applied =
      inserted.length > 0
        ? document.execCommand('insertText', false, inserted)
        : document.execCommand('delete');
    if (!applied || textarea.value !== nextValue) {
      // Fallback: assign via the native setter so React's value tracker
      // still sees the change and onChange fires.
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      setValue?.call(textarea, nextValue);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  textarea.setSelectionRange(selection.start, selection.end);
}

function findActiveSkillShortcut(value: string, caret: number): ActiveSkillShortcut | null {
  const beforeCaret = value.slice(0, caret);
  const match = /(^|[\s([{,])([/$])([A-Za-z0-9_:-]*)$/.exec(beforeCaret);
  if (!match) return null;

  const query = match[3] ?? '';
  return {
    start: caret - query.length - 1,
    end: caret,
    prefix: match[2] as SkillShortcutPrefix,
    query,
  };
}

function applySkillShortcut(
  value: string,
  shortcut: ActiveSkillShortcut,
  command: string
): { value: string; caret: number } {
  const before = value.slice(0, shortcut.start);
  const after = value.slice(shortcut.end);
  const trailing = after.length > 0 ? (/^\s/.test(after) ? '' : ' ') : ' ';
  const insertion = `${command}${trailing}`;
  return {
    value: `${before}${insertion}${after}`,
    caret: before.length + insertion.length,
  };
}

// Returns a match score for `query` against `text`, or null when no match.
// Higher is better. Exact > prefix > substring > subsequence (fuzzy).
function fuzzyMatchScore(text: string, query: string): number | null {
  if (text === query) return 1000;
  if (text.startsWith(query)) return 900 - text.length;
  const idx = text.indexOf(query);
  if (idx >= 0) return 700 - idx - text.length;

  // Subsequence match: every query char appears in order (e.g. "factch" -> "fact-check").
  // Require at least 2 chars so a single letter doesn't fuzzy-match everything.
  if (query.length < 2) return null;
  let firstMatch = -1;
  let ti = 0;
  let gaps = 0;
  let prevMatch = -1;
  for (let qi = 0; qi < query.length; qi++) {
    const ch = query[qi];
    const found = text.indexOf(ch, ti);
    if (found < 0) return null;
    if (firstMatch < 0) firstMatch = found;
    if (prevMatch >= 0) gaps += found - prevMatch - 1;
    prevMatch = found;
    ti = found + 1;
  }
  // Reject matches whose span is wildly larger than the query — those are coincidental.
  const span = prevMatch - firstMatch + 1;
  if (span > query.length * 3 + 2) return null;
  return 400 - gaps - text.length;
}

function skillShortcutOptionScore(item: SkillShortcutOption, query: string): number | null {
  const q = query.toLowerCase();
  // Fuzzy (subsequence) only on the short identifiers — label/value/command.
  // description is matched by substring only; subsequence over long prose matches almost anything.
  const scores = [
    fuzzyMatchScore(item.label.toLowerCase(), q),
    fuzzyMatchScore(item.value.toLowerCase(), q),
    fuzzyMatchScore(item.command.toLowerCase(), q),
    item.description.toLowerCase().includes(q) ? 200 : null,
  ].filter((s): s is number => s !== null);
  return scores.length > 0 ? Math.max(...scores) : null;
}

function uniqueRuntimes(providers: RuntimeId[]): RuntimeId[] {
  return Array.from(new Set(providers));
}

function normalizeCompareProviders(
  saved: RuntimeId[] | undefined,
  primary: RuntimeId | null
): RuntimeId[] {
  const providers = uniqueRuntimes([
    ...(primary ? [primary] : []),
    ...(saved && saved.length > 0 ? saved : DEFAULT_COMPARE_RUNTIMES),
  ]);
  if (providers.length >= MIN_COMPARE_AGENTS) return providers.slice(0, MAX_COMPARE_AGENTS);

  for (const id of RUNTIME_IDS) {
    if (!providers.includes(id)) providers.push(id);
    if (providers.length >= MIN_COMPARE_AGENTS) break;
  }
  return providers.slice(0, MAX_COMPARE_AGENTS);
}

function nextAvailableProvider(existing: RuntimeId[]): RuntimeId {
  return RUNTIME_IDS.find((id) => !existing.includes(id)) ?? existing[0] ?? 'claude';
}

function getRunModeInputChrome(mode: HomeRunMode): RunModeInputChrome {
  switch (mode) {
    case 'brainstorm':
      return {
        icon: Lightbulb,
        labelKey: 'home.modeBrainstorm',
        containerClassName: ADVANCED_INPUT_CONTAINER_CLASS,
        badgeClassName: ADVANCED_INPUT_BADGE_CLASS,
      };
    case 'compare':
      return {
        icon: GitCompare,
        labelKey: 'home.modeCompare',
        containerClassName: ADVANCED_INPUT_CONTAINER_CLASS,
        badgeClassName: ADVANCED_INPUT_BADGE_CLASS,
      };
    case 'review':
      return {
        icon: ShieldCheck,
        labelKey: 'home.modeReview',
        containerClassName: ADVANCED_INPUT_CONTAINER_CLASS,
        badgeClassName: ADVANCED_INPUT_BADGE_CLASS,
      };
    case 'team':
      return {
        icon: Users,
        labelKey: 'home.modeTeam',
        containerClassName: ADVANCED_INPUT_CONTAINER_CLASS,
        badgeClassName: ADVANCED_INPUT_BADGE_CLASS,
      };
    case 'normal':
      return {
        icon: Bot,
        labelKey: 'home.modeNormal',
        containerClassName: 'border-border bg-background-1',
        badgeClassName: 'border-border bg-background-2 text-foreground-muted',
      };
  }

  const exhaustive: never = mode;
  return exhaustive;
}

function comparePromptKey(index: number): string {
  return `compare:${index}`;
}

function teamPromptKey(roleId: TeamRoleId): string {
  return `team:${roleId}`;
}

/**
 * Resolve what a slot runs with. A slot is an Agent assignment: its system
 * prompt is the Agent's prompt, and its runtime is the per-slot override (loose
 * coupling) falling back to the Agent's preferred runtime. With no Agent the
 * slot cannot run — provider is null and the caller must bail.
 */
function resolveAgentSlot(args: {
  selectedAgentId: string | null;
  agents: Agent[];
  runtimeOverride: RuntimeId | null;
}): { provider: RuntimeId | null; systemPrompt: string; agent: Agent | null } {
  const agent = args.selectedAgentId
    ? (args.agents.find((a) => a.id === args.selectedAgentId) ?? null)
    : null;
  if (!agent) return { provider: null, systemPrompt: '', agent: null };
  return {
    provider: args.runtimeOverride ?? agent.preferredRuntime,
    systemPrompt: agent.systemPrompt,
    agent,
  };
}

function withSystemPrompt(systemPrompt: string, body: string): string {
  const trimmedSystemPrompt = systemPrompt.trim();
  if (!trimmedSystemPrompt) return body;
  return [`System prompt:`, trimmedSystemPrompt, '', body].join('\n');
}

function buildRequirementPrompt(args: { requirement: string; systemPrompt: string }): string {
  return withSystemPrompt(
    args.systemPrompt,
    [`User requirement:`, args.requirement || '(No explicit requirement was provided.)'].join('\n')
  );
}

function buildSpecPrompt(args: { requirement: string; systemPrompt: string }): string {
  return withSystemPrompt(
    args.systemPrompt,
    [
      `Rough user requirement:`,
      args.requirement || '(No explicit requirement was provided.)',
      '',
      `Start the spec session now. Ask only material clarifying questions before drafting final artifacts unless the user explicitly asks you to draft from the current information.`,
    ].join('\n')
  );
}

function stripTerminalControlSequences(value: string): string {
  return value
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[=>]/g, '')
    .replace(/\r/g, '');
}

function parseReviewResult(output: string): { passed: boolean; feedback: string } {
  const clean = stripTerminalControlSequences(output).trim();
  const match = /YODA_REVIEW_RESULT:\s*(PASS|FAIL)/i.exec(clean);
  const passed = match?.[1]?.toUpperCase() === 'PASS';
  return {
    passed,
    feedback: clean.slice(-12_000),
  };
}

function buildReviewPrompt(args: {
  requirement: string;
  round: number;
  systemPrompt: string;
}): string {
  return withSystemPrompt(
    args.systemPrompt,
    [
      `Original requirement:`,
      args.requirement || '(No explicit requirement was provided.)',
      '',
      `Round: ${args.round}`,
      '',
      `Protocol:`,
      `- Do not modify files.`,
      `- End your response with exactly one marker line:`,
      `YODA_REVIEW_RESULT: PASS`,
      `or`,
      `YODA_REVIEW_RESULT: FAIL`,
      '',
      `If the result is FAIL, list concrete fixes for implementer agent A before the marker.`,
    ].join('\n')
  );
}

function buildImplementerFeedbackPrompt(args: {
  requirement: string;
  reviewFeedback: string;
}): string {
  return [
    `Reviewer agent B found issues in your implementation.`,
    '',
    `Original requirement:`,
    args.requirement || '(No explicit requirement was provided.)',
    '',
    `Review feedback:`,
    args.reviewFeedback,
    '',
    `Please address the issues in this same worktree. Keep the existing direction where possible, update tests if needed, and stop when the next implementation round is complete.`,
  ].join('\n');
}

function buildTeamCeoPrompt(args: { requirement: string; systemPrompt: string }): string {
  return withSystemPrompt(
    args.systemPrompt,
    [
      `Original requirement:`,
      args.requirement || '(No explicit requirement was provided.)',
      '',
      `Target specialist agents:`,
      `- Product manager agent, role-playing Steve Jobs`,
      `- Engineering agent, role-playing Linus Torvalds`,
      `- UI/UX agent, role-playing Jony Ive`,
      `- User operations agent, role-playing Tim Cook`,
    ].join('\n')
  );
}

function buildTeamRolePrompt(args: {
  requirement: string;
  ceoPlan: string;
  systemPrompt: string;
}): string {
  return withSystemPrompt(
    args.systemPrompt,
    [
      `Original requirement:`,
      args.requirement || '(No explicit requirement was provided.)',
      '',
      `CEO decomposition and assignments:`,
      args.ceoPlan,
    ].join('\n')
  );
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendPromptToConversation(
  conversation: ConversationStore,
  text: string
): Promise<void> {
  const payload = buildPromptInjectionPayload(text);
  if (!payload) return;

  conversation.setWorking({ force: true });
  const first = await rpc.pty.sendInput(conversation.session.sessionId, payload);
  if (!first.success) throw new Error('Could not send prompt to agent session.');

  await sleep(getAgentCommandSubmitDelayMs(conversation.data.runtimeId));
  const submit = await rpc.pty.sendInput(conversation.session.sessionId, '\r');
  if (!submit.success) throw new Error('Could not submit prompt to agent session.');
}

function waitForConversationTurn(conversation: ConversationStore): Promise<void> {
  if (conversation.status !== 'working') return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;
    let dispose: (() => void) | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      dispose?.();
      if (timeout) clearTimeout(timeout);
    };

    timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for the agent turn to finish.'));
    }, CONVERSATION_TURN_TIMEOUT_MS);

    dispose = reaction(
      () => conversation.status !== 'working',
      (done) => {
        if (!done) return;
        cleanup();
        resolve();
      },
      { fireImmediately: true }
    );
  });
}

async function readConversationOutput(conversation: ConversationStore): Promise<string> {
  const result = await rpc.pty.subscribe(conversation.session.sessionId);
  await rpc.pty.unsubscribe(conversation.session.sessionId).catch(() => {});
  return result.success ? result.data.buffer : '';
}

async function getConversationStore(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<ConversationStore> {
  const provisioned = asProvisioned(getTaskStore(projectId, taskId));
  if (!provisioned) throw new Error('Task is not ready for orchestration.');
  await provisioned.conversations.load();
  const conversation = provisioned.conversations.conversations.get(conversationId);
  if (!conversation) throw new Error('Agent conversation was not found.');
  return conversation;
}

async function waitForInitialConversationOutput(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<string> {
  const conversation = await getConversationStore(projectId, taskId, conversationId);
  await waitForConversationTurn(conversation);
  return stripTerminalControlSequences(await readConversationOutput(conversation)).trim();
}

async function runReviewOrchestration(args: {
  projectId: string;
  taskId: string;
  implementationConversationId: string;
  implementationReady: Promise<unknown>;
  requirement: string;
  reviewerRuntime: RuntimeId;
  reviewerSystemPrompt: string;
  getAutoApprove: (runtimeId: RuntimeId) => boolean;
}): Promise<void> {
  await args.implementationReady;
  const implementation = await getConversationStore(
    args.projectId,
    args.taskId,
    args.implementationConversationId
  );

  for (let round = 1; round <= REVIEW_MAX_ROUNDS; round += 1) {
    await waitForConversationTurn(implementation);
    const provisioned = asProvisioned(getTaskStore(args.projectId, args.taskId));
    if (!provisioned) throw new Error('Task is not ready for review.');

    const reviewerId = crypto.randomUUID();
    const reviewer = await provisioned.conversations.createConversation({
      id: reviewerId,
      projectId: args.projectId,
      taskId: args.taskId,
      runtime: args.reviewerRuntime,
      title: initialConversationTitle(args.reviewerRuntime, args.requirement, []),
      initialPrompt: buildReviewPrompt({
        requirement: args.requirement,
        round,
        systemPrompt: args.reviewerSystemPrompt,
      }),
      autoApprove: args.getAutoApprove(args.reviewerRuntime),
    });
    const reviewerStore = provisioned.conversations.conversations.get(reviewer.id);
    if (!reviewerStore) throw new Error('Reviewer conversation was not found.');
    reviewerStore.setWorking({ force: true });
    await waitForConversationTurn(reviewerStore);

    const result = parseReviewResult(await readConversationOutput(reviewerStore));
    if (result.passed) return;

    await sendPromptToConversation(
      implementation,
      buildImplementerFeedbackPrompt({
        requirement: args.requirement,
        reviewFeedback: result.feedback,
      })
    );
  }
}

/** Home renders no titlebar row — the view owns its full height. */
export function HomeTitlebar() {
  return null;
}

interface HomeViewWrapperProps {
  children: ReactNode;
  projectId?: string;
}

export function HomeViewWrapper({ children }: HomeViewWrapperProps) {
  return <>{children}</>;
}

export const HomeMainPanel = observer(function HomeMainPanel() {
  const { t } = useTranslation();
  const { effectiveTheme } = useTheme();
  const { data: accountSession } = useAccountSession();
  const sessionUser = accountSession?.user;
  const greetingName = sessionUser?.name?.trim() || sessionUser?.username || '';

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-1 flex-col px-5 pb-8 pt-14 sm:px-8 lg:px-10">
        <div className="flex flex-1 flex-col justify-center gap-8 py-4">
          <div className="text-center">
            <div className="mb-4 flex items-center justify-center">
              <img
                key={effectiveTheme}
                src={effectiveTheme === 'ydark' ? yodaLogoWhite : yodaLogo}
                alt="Yoda"
                className="h-9"
              />
            </div>
            <h1 className="text-2xl font-semibold">
              {greetingName
                ? t(getGreetingKey(new Date().getHours()), { name: greetingName })
                : t('home.headline')}
            </h1>
          </div>

          <HomeComposer className="mx-auto w-full max-w-4xl" />
        </div>
      </div>
    </div>
  );
});

/**
 * The new-task prompt composer — the heart of the home page, also reusable
 * inside a modal (the tab strip's "+" within a task) so starting new work
 * doesn't shift attention away. Drafts persist to the shared `homeDraft`
 * setting in both hosts.
 */
export const HomeComposer = observer(function HomeComposer({
  className,
  onSubmitted,
}: {
  className?: string;
  /** Called after a successful submit (the composer itself navigates to the new task). */
  onSubmitted?: () => void;
}) {
  const { t } = useTranslation();
  const showAddProjectModal = useShowModal('addProjectModal');
  const { navigate } = useNavigate();

  const projectManager = getProjectManagerStore();

  const { params: homeParams, setParams: setHomeParams } = useParams('home');
  const homeProjectId = homeParams.projectId;

  const navProjectId = (() => {
    const nav = appState.navigation;
    if (nav.currentViewId === 'task') {
      return (nav.viewParamsStore['task'] as { projectId?: string } | undefined)?.projectId;
    }
    if (nav.currentViewId === 'project') {
      return (nav.viewParamsStore['project'] as { projectId?: string } | undefined)?.projectId;
    }
    return undefined;
  })();

  const { value: draft, update: updateDraft } = useAppSettingsKey('homeDraft');

  const selectedProjectId =
    homeProjectId ??
    navProjectId ??
    (draft === undefined ? undefined : (draft.selectedProjectId ?? undefined));
  const setSelectedProjectId = useCallback(
    (next: string | undefined) => {
      updateDraft({ selectedProjectId: next ?? null });
    },
    [updateDraft]
  );

  useEffect(() => {
    if (!homeProjectId) return;
    updateDraft({ selectedProjectId: homeProjectId });
    setHomeParams({ projectId: undefined });
  }, [homeProjectId, setHomeParams, updateDraft]);

  const projectStore = selectedProjectId
    ? projectManager.projects.get(selectedProjectId)
    : undefined;
  const mounted = asMounted(projectStore);
  const projectData = mounted?.data;
  const connectionId = projectData?.type === 'ssh' ? projectData.connectionId : undefined;

  const repo = selectedProjectId ? getRepositoryStore(selectedProjectId) : undefined;
  const defaultBranch = repo?.defaultBranch;
  const isUnborn = repo?.isUnborn ?? false;
  const branchLabel = defaultBranch?.branch ?? repo?.currentBranch ?? 'main';
  const runHostKind: RunHostKind = projectData?.type === 'ssh' ? 'ssh' : 'local';
  const strategyLabels = useMemo(
    () => ({
      chipNewBranch: t('home.strategyChipNewBranch', { branch: branchLabel }),
      chipNoWorktree: t('home.strategyChipNoWorktree', { branch: branchLabel }),
      newBranchTitle: t('home.strategyNewBranchTitle', { branch: branchLabel }),
      newBranchDesc: t('home.strategyNewBranchDesc', { branch: branchLabel }),
      noWorktreeTitle: t('home.strategyNoWorktreeTitle', { branch: branchLabel }),
      noWorktreeDesc: t('home.strategyNoWorktreeDesc'),
    }),
    [branchLabel, t]
  );
  const reviewStrategyLabels = useMemo(
    () => ({
      chipNewBranch: t('home.reviewStrategyChipNewBranch', { branch: branchLabel }),
      chipNoWorktree: t('home.reviewStrategyChipSameBranch', { branch: branchLabel }),
      newBranchTitle: t('home.reviewStrategyNewBranchTitle', { branch: branchLabel }),
      newBranchDesc: t('home.reviewStrategyNewBranchDesc', { branch: branchLabel }),
      noWorktreeTitle: t('home.reviewStrategySameBranchTitle', { branch: branchLabel }),
      noWorktreeDesc: t('home.reviewStrategySameBranchDesc'),
    }),
    [branchLabel, t]
  );

  const providerOverrideValue = draft?.runtimeOverride ?? null;
  const setRuntimeOverridePersisted = useCallback(
    (id: RuntimeId | null) => {
      updateDraft({ runtimeOverride: id });
    },
    [updateDraft]
  );
  const { runtimeId, setRuntimeOverride } = useEffectiveRuntime(connectionId, {
    value: providerOverrideValue,
    set: setRuntimeOverridePersisted,
  });
  const persistedRunMode: HomeRunMode = draft?.runMode ?? 'normal';
  const [runMode, setRunModeState] = useState<HomeRunMode>('normal');
  const hasManualRunModeRef = useRef(false);
  useEffect(() => {
    if (draft === undefined || hasManualRunModeRef.current) return;
    setRunModeState(persistedRunMode);
  }, [draft, persistedRunMode]);
  const setRunMode = useCallback(
    (next: HomeRunMode) => {
      hasManualRunModeRef.current = true;
      setRunModeState(next);
      updateDraft({ runMode: next });
    },
    [updateDraft]
  );
  const compareRuntimes = useMemo(
    () => normalizeCompareProviders(draft?.compareRuntimes, runtimeId),
    [draft?.compareRuntimes, runtimeId]
  );
  const setCompareProvider = useCallback(
    (index: number, next: RuntimeId) => {
      const providers = [...compareRuntimes];
      providers[index] = next;
      updateDraft({ compareRuntimes: uniqueRuntimes(providers).slice(0, MAX_COMPARE_AGENTS) });
    },
    [compareRuntimes, updateDraft]
  );
  const addCompareProvider = useCallback(() => {
    updateDraft({
      compareRuntimes: [...compareRuntimes, nextAvailableProvider(compareRuntimes)].slice(
        0,
        MAX_COMPARE_AGENTS
      ),
    });
  }, [compareRuntimes, updateDraft]);
  const removeCompareProvider = useCallback(
    (index: number) => {
      if (compareRuntimes.length <= MIN_COMPARE_AGENTS) return;
      updateDraft({ compareRuntimes: compareRuntimes.filter((_, i) => i !== index) });
    },
    [compareRuntimes, updateDraft]
  );
  const reviewerRuntime = draft?.reviewReviewerRuntime ?? DEFAULT_REVIEWER_RUNTIME;
  const setReviewerProvider = useCallback(
    (next: RuntimeId) => {
      updateDraft({ reviewReviewerRuntime: next });
    },
    [updateDraft]
  );
  const teamRuntimes = useMemo<TeamRuntimeSelection>(
    () => draft?.teamRuntimes ?? DEFAULT_TEAM_PROVIDERS,
    [draft?.teamRuntimes]
  );
  const setTeamProvider = useCallback(
    (roleId: TeamRoleId, next: RuntimeId) => {
      updateDraft({ teamRuntimes: { ...teamRuntimes, [roleId]: next } });
    },
    [teamRuntimes, updateDraft]
  );
  const { agents: userAgents } = useAgents();
  const selectedAgentIdsByMode = useMemo<Record<string, string[]>>(
    () => draft?.selectedAgentIds ?? {},
    [draft?.selectedAgentIds]
  );
  // Per-slot Agent selection. We reuse the persisted `selectedAgentIds`
  // string→string[] map, keyed by each slot's prompt key. When a slot has no
  // explicit selection, it defaults to the built-in Agent seeded for that slot
  // (matched by slug), so every mode works out of the box.
  const slotAgentId = useCallback(
    (slotKey: string): string | null => {
      const explicit = selectedAgentIdsByMode[slotKey]?.[0];
      if (explicit) return explicit;
      const builtinKey = defaultBuiltinKeyForSlot(slotKey);
      if (!builtinKey) return null;
      return userAgents.find((a) => a.slug === builtinKey)?.id ?? null;
    },
    [selectedAgentIdsByMode, userAgents]
  );
  const setSlotAgent = useCallback(
    (slotKey: string, agentId: string) => {
      updateDraft({ selectedAgentIds: { ...selectedAgentIdsByMode, [slotKey]: [agentId] } });
    },
    [selectedAgentIdsByMode, updateDraft]
  );
  const autoApproveDefaults = useRuntimeAutoApproveDefaults();
  const runModeSummary = useMemo(() => {
    const runtimeName = (id: RuntimeId | null) => (id ? (getRuntime(id)?.name ?? id) : null);
    const modelLabel = (model: string | null) =>
      model ? formatModelLabel(model) : t('home.modelDefault');

    if (runMode === 'compare') {
      return t('home.modeSummaryAgentCount', { count: compareRuntimes.length });
    }
    if (runMode === 'team') {
      const roleCount = Object.keys(teamRuntimes).length;
      return t('home.modeSummaryAgentCount', { count: roleCount });
    }

    // Single-Agent modes (normal / brainstorm / review): the implementer slot's
    // resolved runtime · model.
    const slotKey =
      runMode === 'brainstorm'
        ? SPEC_PROMPT_KEY
        : runMode === 'review'
          ? REVIEW_IMPLEMENTER_PROMPT_KEY
          : NORMAL_PROMPT_KEY;
    const resolved = resolveAgentSlot({
      selectedAgentId: slotAgentId(slotKey),
      agents: userAgents,
      runtimeOverride: runtimeId,
    });

    const name = runtimeName(resolved.provider);
    if (!name) return null;
    return `${name} · ${modelLabel(resolved.agent?.model ?? null)}`;
  }, [runMode, runtimeId, compareRuntimes.length, teamRuntimes, slotAgentId, userAgents, t]);
  // Local project root, so the skill picker can surface project-local skills
  // alongside the global ones. SSH projects have no local path to scan.
  const skillProjectPath = projectData?.type === 'local' ? projectData.path : undefined;
  const {
    data: skillCatalog = null,
    isPending: skillsLoading,
    isError: skillsError,
  } = useQuery<CatalogIndex>({
    queryKey: ['skills', 'catalog', skillProjectPath ?? null],
    queryFn: async () => {
      const result = await rpc.skills.getCatalog(
        skillProjectPath ? { projectPath: skillProjectPath } : undefined
      );
      if (result.success && result.data) return result.data;
      throw new Error(result.error ?? 'Failed to load catalog');
    },
  });
  const skillShortcutOptions = useMemo<SkillShortcutOption[]>(() => {
    const installed = (skillCatalog?.skills ?? [])
      .filter((skill) => skill.installed)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    return installed.map((skill) => ({
      value: skill.id,
      label: skill.displayName,
      description: skill.description,
      command: runtimeId ? applyAgentCommandPrefix(runtimeId, skill.id) : skill.id,
    }));
  }, [runtimeId, skillCatalog?.skills]);
  const skillIdByShortcutCommand = useMemo(
    () => new Map(skillShortcutOptions.map((skill) => [skill.command, skill.value])),
    [skillShortcutOptions]
  );

  const persistedPrompt = draft?.prompt ?? '';
  const [prompt, setPrompt] = useState(persistedPrompt);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  // Landing on home (sidebar "new task", the tab strip's "+") should put the
  // caret straight into the prompt — the panel remounts on every navigation.
  useEffect(() => {
    promptTextareaRef.current?.focus({ preventScroll: true });
  }, []);
  const [promptFocused, setPromptFocused] = useState(false);
  const [promptSelection, setPromptSelection] = useState({ start: 0, end: 0 });
  const promptSelectionRef = useRef(promptSelection);
  const [pathCompletionItems, setPathCompletionItems] = useState<PathCompletionItem[]>([]);
  const [pathCompletionOpen, setPathCompletionOpen] = useState(false);
  const [pathCompletionLoading, setPathCompletionLoading] = useState(false);
  const [pathCompletionError, setPathCompletionError] = useState(false);
  const [activePathCompletionIndex, setActivePathCompletionIndex] = useState(0);
  const [activeSkillShortcutIndex, setActiveSkillShortcutIndex] = useState(0);
  const [dismissedSkillShortcutKey, setDismissedSkillShortcutKey] = useState<string | null>(null);
  const pathCompletionRequestRef = useRef(0);
  const activePathMention = useMemo(
    () =>
      promptSelection.start === promptSelection.end
        ? findActivePathMention(prompt, promptSelection.start)
        : null,
    [prompt, promptSelection]
  );
  const activeSkillShortcut = useMemo(
    () =>
      promptSelection.start === promptSelection.end
        ? findActiveSkillShortcut(prompt, promptSelection.start)
        : null,
    [prompt, promptSelection]
  );
  const activeSkillShortcutKey = activeSkillShortcut
    ? `${activeSkillShortcut.start}:${activeSkillShortcut.end}:${activeSkillShortcut.prefix}:${activeSkillShortcut.query}`
    : null;
  const filteredSkillShortcutOptions = useMemo(() => {
    if (!activeSkillShortcut) return [];
    const query = activeSkillShortcut.query.trim();
    if (!query) return skillShortcutOptions.slice(0, 50);
    const scored = skillShortcutOptions
      .map((item) => ({ item, score: skillShortcutOptionScore(item, query) }))
      .filter(
        (entry): entry is { item: SkillShortcutOption; score: number } => entry.score !== null
      )
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, 50).map((entry) => entry.item);
  }, [activeSkillShortcut, skillShortcutOptions]);
  const effectiveSkillShortcutIndex =
    filteredSkillShortcutOptions.length === 0
      ? 0
      : Math.min(activeSkillShortcutIndex, filteredSkillShortcutOptions.length - 1);
  const skillShortcutMenuOpen =
    promptFocused &&
    !!runtimeId &&
    !!activeSkillShortcut &&
    activeSkillShortcutKey !== dismissedSkillShortcutKey &&
    !skillsError &&
    (skillsLoading ||
      filteredSkillShortcutOptions.length > 0 ||
      activeSkillShortcut.query.length > 0);
  const updatePromptSelection = useCallback((target: HTMLTextAreaElement) => {
    const next = { start: target.selectionStart, end: target.selectionEnd };
    setPromptSelection((current) =>
      current.start === next.start && current.end === next.end ? current : next
    );
  }, []);
  useEffect(() => {
    promptSelectionRef.current = promptSelection;
  }, [promptSelection]);
  const hydratedPromptRef = useRef(false);
  useEffect(() => {
    if (hydratedPromptRef.current) return;
    if (draft === undefined) return;
    hydratedPromptRef.current = true;
    setPrompt(draft.prompt ?? '');
  }, [draft]);
  const runModeAnchorRef = useRef<HTMLDivElement>(null);
  const promptWriteRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!hydratedPromptRef.current) return;
    if (prompt === persistedPrompt) return;
    if (promptWriteRef.current) clearTimeout(promptWriteRef.current);
    promptWriteRef.current = setTimeout(() => {
      updateDraft({ prompt });
    }, 300);
    return () => {
      if (promptWriteRef.current) clearTimeout(promptWriteRef.current);
    };
  }, [prompt, persistedPrompt, updateDraft]);

  const focusPromptForVoiceInput = useCallback(() => {
    const textarea = promptTextareaRef.current;
    if (!textarea) return;
    const selection = promptSelectionRef.current;
    const start = Math.max(0, Math.min(selection.start, textarea.value.length));
    const end = Math.max(start, Math.min(selection.end, textarea.value.length));
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(start, end);
    setPromptFocused(true);
    updatePromptSelection(textarea);
  }, [updatePromptSelection]);

  const [voiceInputTriggering, setVoiceInputTriggering] = useState(false);
  const copyVoiceInputError = useCallback(
    async (message: string) => {
      const result = await rpc.app.clipboardWriteText(message);
      if (result.success) {
        toast.success(t('common.copied'));
        return;
      }
      toast.error(result.error ?? t('common.copyFailed'));
    },
    [t]
  );
  const showVoiceInputErrorToast = useCallback(
    (error: string) => {
      const title = t('home.voiceTriggerFailedToast');
      const copyLabel = t('common.copy');
      const copyText = `${title}\n${error}`;
      toast.error(
        <div className="flex w-full min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
          <button
            type="button"
            aria-label={copyLabel}
            title={copyLabel}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void copyVoiceInputError(copyText);
            }}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Copy className="size-3.5" />
          </button>
        </div>,
        {
          icon: null,
          classNames: {
            content: 'w-full min-w-0',
            title: 'w-full',
            description: 'w-full',
          },
          description: (
            <div className="mt-2 max-h-28 w-full overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-background-1/80 px-2.5 py-2 text-xs leading-relaxed text-foreground-muted">
              {error}
            </div>
          ),
        }
      );
    },
    [copyVoiceInputError, t]
  );
  const handleVoiceInput = useCallback(async () => {
    if (voiceInputTriggering) return;
    focusPromptForVoiceInput();
    setVoiceInputTriggering(true);

    try {
      const result = await rpc.app.triggerVoiceInput({ provider: 'typeless' });
      if (!result.success) {
        showVoiceInputErrorToast(result.error ?? t('common.unknownError'));
        return;
      }
      toast.success(t('home.voiceTriggeredToast', { shortcut: result.shortcut }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showVoiceInputErrorToast(message);
    } finally {
      setVoiceInputTriggering(false);
      focusPromptForVoiceInput();
    }
  }, [focusPromptForVoiceInput, showVoiceInputErrorToast, t, voiceInputTriggering]);

  useEffect(() => {
    if (!activePathMention) {
      pathCompletionRequestRef.current += 1;
      setPathCompletionOpen(false);
      setPathCompletionItems([]);
      setPathCompletionLoading(false);
      setPathCompletionError(false);
      return;
    }

    const queryParts = splitPathMentionQuery(activePathMention.query);
    const projectId = projectData?.id ?? null;
    const requestId = pathCompletionRequestRef.current + 1;
    pathCompletionRequestRef.current = requestId;
    setPathCompletionOpen(true);
    setPathCompletionLoading(true);
    setPathCompletionError(false);

    const timer = setTimeout(() => {
      rpc.fs
        .listPathCompletions(projectId, queryParts.directoryPath, {
          pathKind: queryParts.isAbsolute ? 'absolute' : 'relative',
          recursive: false,
          includeHidden: true,
          maxEntries: 80,
          timeBudgetMs: 1_000,
        })
        .then((result) => {
          if (pathCompletionRequestRef.current !== requestId) return;
          if (!result.success) {
            setPathCompletionItems([]);
            setPathCompletionError(false);
            return;
          }
          setPathCompletionItems(
            buildPathCompletionItems(result.data.entries, queryParts).slice(0, 50)
          );
          setActivePathCompletionIndex(0);
        })
        .catch(() => {
          if (pathCompletionRequestRef.current !== requestId) return;
          setPathCompletionItems([]);
          setPathCompletionError(false);
        })
        .finally(() => {
          if (pathCompletionRequestRef.current !== requestId) return;
          setPathCompletionLoading(false);
        });
    }, 80);

    return () => {
      clearTimeout(timer);
    };
  }, [activePathMention, projectData?.id]);

  const [submitting, setSubmitting] = useState(false);
  const strategyKind: TaskStrategyKind = draft?.strategyKind ?? 'new-branch';
  const setStrategyKind = useCallback(
    (next: TaskStrategyKind) => {
      updateDraft({ strategyKind: next });
    },
    [updateDraft]
  );
  const reviewStrategyKind: TaskStrategyKind = draft?.reviewStrategyKind ?? 'no-worktree';
  const setReviewStrategyKind = useCallback(
    (next: TaskStrategyKind) => {
      updateDraft({ reviewStrategyKind: next });
    },
    [updateDraft]
  );
  const effectiveStandardStrategyKind: TaskStrategyKind = isUnborn ? 'no-worktree' : strategyKind;
  const effectiveReviewStrategyKind: TaskStrategyKind = isUnborn
    ? 'no-worktree'
    : reviewStrategyKind;
  const modeCanRunWithoutProject = runMode === 'normal' || runMode === 'brainstorm';
  const modeRequiresWorktree =
    runMode === 'compare' ||
    runMode === 'team' ||
    (runMode === 'review' && effectiveReviewStrategyKind === 'new-branch');
  const trimmed = prompt.trim();
  // A slot can run only when it has an Agent assigned (the Agent supplies the
  // runtime + prompt). Each mode requires all its slots filled.
  const hasSlotAgent = (slotKey: string) => !!slotAgentId(slotKey);
  const modeHasAgents =
    runMode === 'compare'
      ? compareRuntimes.length >= MIN_COMPARE_AGENTS &&
        compareRuntimes.every((_, index) => hasSlotAgent(comparePromptKey(index)))
      : runMode === 'review'
        ? hasSlotAgent(REVIEW_IMPLEMENTER_PROMPT_KEY) && hasSlotAgent(REVIEW_REVIEWER_PROMPT_KEY)
        : runMode === 'team'
          ? TEAM_ROLES.every((role) => hasSlotAgent(teamPromptKey(role.id)))
          : runMode === 'brainstorm'
            ? hasSlotAgent(SPEC_PROMPT_KEY)
            : hasSlotAgent(NORMAL_PROMPT_KEY);
  const canSubmit =
    !submitting &&
    modeHasAgents &&
    (modeCanRunWithoutProject
      ? !mounted || !!defaultBranch
      : !!mounted && !!defaultBranch && (!modeRequiresWorktree || !isUnborn));

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      // Every successful submit lands on the new task; modal hosts close on it.
      const goToTask = (projectId: string, taskId: string) => {
        navigate('task', { projectId, taskId });
        onSubmitted?.();
      };
      const promptDisplayName = trimmed ? taskNameFromPrompt(trimmed) : '';
      const baseName =
        promptDisplayName || (await rpc.tasks.generateTaskName(trimmed ? { title: trimmed } : {}));
      const reportFailures = (results: PromiseSettledResult<unknown>[]) => {
        const failures = results.filter((result) => result.status === 'rejected');
        if (failures.length > 0) {
          toast.error(
            failures.length === 1
              ? 'One agent task failed to start.'
              : `${failures.length} agent tasks failed to start.`
          );
        }
      };
      // Resolve a slot to its Agent's prompt + runtime (per-slot runtime
      // override wins over the Agent's preferred runtime).
      const resolveSlot = (slotKey: string, runtimeOverride: RuntimeId | null) =>
        resolveAgentSlot({
          selectedAgentId: slotAgentId(slotKey),
          agents: userAgents,
          runtimeOverride,
        });

      if (!mounted) {
        const draftSlot = resolveSlot(
          runMode === 'brainstorm' ? SPEC_PROMPT_KEY : NORMAL_PROMPT_KEY,
          runtimeId
        );
        const draftRuntime = draftSlot.provider;
        if (!draftRuntime) return;
        await projectManager.mountProject(INTERNAL_PROJECT_ID).catch(() => {});
        const internalProject = asMounted(projectManager.projects.get(INTERNAL_PROJECT_ID));
        if (!internalProject) {
          toast.error('Could not open the internal drafts project.');
          return;
        }
        const existingDraftNames = Array.from(
          internalProject.taskManager.tasks.values(),
          (t) => t.data.name
        );
        const taskName = ensureUniqueTaskDisplayName(baseName, existingDraftNames);
        const taskId = crypto.randomUUID();
        const conversationId = crypto.randomUUID();
        const draftSystemPrompt = draftSlot.systemPrompt.trim();
        const initialPrompt =
          runMode === 'brainstorm'
            ? buildSpecPrompt({ requirement: trimmed, systemPrompt: draftSlot.systemPrompt })
            : draftSystemPrompt
              ? buildRequirementPrompt({ requirement: trimmed, systemPrompt: draftSystemPrompt })
              : trimmed || undefined;
        void internalProject.taskManager
          .createTask({
            id: taskId,
            projectId: INTERNAL_PROJECT_ID,
            name: taskName,
            sourceBranch: { type: 'local', branch: 'main' },
            strategy: { kind: 'no-worktree' },
            initialConversation: {
              id: conversationId,
              projectId: INTERNAL_PROJECT_ID,
              taskId,
              runtime: draftRuntime,
              title: initialConversationTitle(draftRuntime, trimmed || undefined, []),
              initialPrompt,
              autoApprove: autoApproveDefaults.getDefault(draftRuntime),
            },
          })
          .catch(() => {
            toast.error('Agent task failed to start.');
          });
        goToTask(INTERNAL_PROJECT_ID, taskId);
        setPrompt('');
        updateDraft({ prompt: '' });
        return;
      }

      if (!defaultBranch) return;

      const existingNames = Array.from(mounted.taskManager.tasks.values(), (t) => t.data.name);
      const reservedNames = [...existingNames];
      const reserveTaskName = (seed: string) => {
        const taskName = ensureUniqueTaskDisplayName(seed, reservedNames);
        reservedNames.push(taskName);
        return taskName;
      };
      const createProjectTask = (args: {
        provider: RuntimeId;
        nameSeed: string;
        initialPrompt: string | undefined;
        titlePrompt?: string;
        strategyKind: TaskStrategyKind;
      }) => {
        const taskId = crypto.randomUUID();
        const conversationId = crypto.randomUUID();
        const taskName = reserveTaskName(args.nameSeed);
        const strategy =
          args.strategyKind === 'no-worktree'
            ? ({ kind: 'no-worktree' } as const)
            : ({ kind: 'new-branch', taskBranch: taskName, pushBranch: false } as const);
        const promise = mounted.taskManager.createTask({
          id: taskId,
          projectId: mounted.data.id,
          name: taskName,
          sourceBranch: defaultBranch,
          strategy,
          initialConversation: {
            id: conversationId,
            projectId: mounted.data.id,
            taskId,
            runtime: args.provider,
            title: initialConversationTitle(
              args.provider,
              args.titlePrompt ?? args.initialPrompt,
              []
            ),
            initialPrompt: args.initialPrompt,
            autoApprove: autoApproveDefaults.getDefault(args.provider),
          },
        });
        return { taskId, taskName, conversationId, runtime: args.provider, promise };
      };

      if (runMode === 'brainstorm') {
        const slot = resolveSlot(SPEC_PROMPT_KEY, runtimeId);
        if (!slot.provider) return;
        const task = createProjectTask({
          provider: slot.provider,
          nameSeed: `${baseName}-spec`,
          initialPrompt: buildSpecPrompt({
            requirement: trimmed,
            systemPrompt: slot.systemPrompt,
          }),
          titlePrompt: trimmed || undefined,
          strategyKind: 'no-worktree',
        });
        goToTask(mounted.data.id, task.taskId);
        void task.promise.catch(() => {
          toast.error('Agent task failed to start.');
        });
        setPrompt('');
        updateDraft({ prompt: '' });
        return;
      }

      if (runMode === 'compare') {
        const launches = compareRuntimes.flatMap((provider, index) => {
          const slot = resolveSlot(comparePromptKey(index), provider);
          if (!slot.provider) return [];
          return [
            createProjectTask({
              provider: slot.provider,
              nameSeed: `${baseName}-agent-${index + 1}-${slot.provider}`,
              initialPrompt: buildRequirementPrompt({
                requirement: trimmed,
                systemPrompt: slot.systemPrompt,
              }),
              titlePrompt: trimmed || undefined,
              strategyKind: 'new-branch',
            }),
          ];
        });
        if (launches.length === 0) return;
        const first = launches[0];
        if (first) goToTask(mounted.data.id, first.taskId);
        void Promise.allSettled(launches.map((launch) => launch.promise)).then(reportFailures);
        setPrompt('');
        updateDraft({ prompt: '' });
        return;
      }

      if (runMode === 'review') {
        const implementerSlot = resolveSlot(REVIEW_IMPLEMENTER_PROMPT_KEY, runtimeId);
        const reviewerSlot = resolveSlot(REVIEW_REVIEWER_PROMPT_KEY, reviewerRuntime);
        if (!implementerSlot.provider || !reviewerSlot.provider) return;
        const implementation = createProjectTask({
          provider: implementerSlot.provider,
          nameSeed: `${baseName}-implement`,
          initialPrompt: buildRequirementPrompt({
            requirement: trimmed,
            systemPrompt: implementerSlot.systemPrompt,
          }),
          titlePrompt: trimmed || undefined,
          strategyKind: effectiveReviewStrategyKind,
        });
        goToTask(mounted.data.id, implementation.taskId);
        void runReviewOrchestration({
          projectId: mounted.data.id,
          taskId: implementation.taskId,
          implementationConversationId: implementation.conversationId,
          implementationReady: implementation.promise,
          requirement: trimmed,
          reviewerRuntime: reviewerSlot.provider,
          reviewerSystemPrompt: reviewerSlot.systemPrompt,
          getAutoApprove: autoApproveDefaults.getDefault,
        }).catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : 'Review mode orchestration failed.');
        });
        setPrompt('');
        updateDraft({ prompt: '' });
        return;
      }

      if (runMode === 'team') {
        const ceoRole = TEAM_ROLES[0];
        const ceoSlot = resolveSlot(teamPromptKey(ceoRole.id), teamRuntimes.ceo);
        if (!ceoSlot.provider) return;
        const ceoProvider = ceoSlot.provider;
        const ceo = createProjectTask({
          provider: ceoProvider,
          nameSeed: `${baseName}-${ceoRole.taskSuffix}`,
          initialPrompt: buildTeamCeoPrompt({
            requirement: trimmed,
            systemPrompt: ceoSlot.systemPrompt,
          }),
          titlePrompt: trimmed || undefined,
          strategyKind: 'new-branch',
        });
        goToTask(mounted.data.id, ceo.taskId);
        void (async () => {
          await ceo.promise;
          const ceoOutput = await waitForInitialConversationOutput(
            mounted.data.id,
            ceo.taskId,
            ceo.conversationId
          );
          const workerLaunches = TEAM_ROLES.filter((role) => role.id !== 'ceo').flatMap((role) => {
            const slot = resolveSlot(teamPromptKey(role.id), teamRuntimes[role.id]);
            if (!slot.provider) return [];
            return [
              createProjectTask({
                provider: slot.provider,
                nameSeed: `${baseName}-${role.taskSuffix}`,
                initialPrompt: buildTeamRolePrompt({
                  requirement: trimmed,
                  ceoPlan: ceoOutput || '(The CEO agent did not produce captured output.)',
                  systemPrompt: slot.systemPrompt,
                }),
                titlePrompt: trimmed || undefined,
                strategyKind: 'new-branch',
              }),
            ];
          });
          reportFailures(await Promise.allSettled(workerLaunches.map((launch) => launch.promise)));
        })().catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : 'Agent team orchestration failed.');
        });
        setPrompt('');
        updateDraft({ prompt: '' });
        return;
      }

      const normalSlot = resolveSlot(NORMAL_PROMPT_KEY, runtimeId);
      if (!normalSlot.provider) return;
      const normalSystemPrompt = normalSlot.systemPrompt.trim();
      const task = createProjectTask({
        provider: normalSlot.provider,
        nameSeed: baseName,
        initialPrompt: normalSystemPrompt
          ? buildRequirementPrompt({ requirement: trimmed, systemPrompt: normalSystemPrompt })
          : trimmed || undefined,
        titlePrompt: trimmed || undefined,
        strategyKind: effectiveStandardStrategyKind,
      });
      goToTask(mounted.data.id, task.taskId);
      void task.promise.catch(() => {
        toast.error('Agent task failed to start.');
      });
      setPrompt('');
      updateDraft({ prompt: '' });
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit,
    mounted,
    runtimeId,
    defaultBranch,
    effectiveReviewStrategyKind,
    effectiveStandardStrategyKind,
    trimmed,
    submitting,
    runMode,
    compareRuntimes,
    reviewerRuntime,
    teamRuntimes,
    userAgents,
    slotAgentId,
    autoApproveDefaults,
    navigate,
    onSubmitted,
    projectManager,
    updateDraft,
  ]);

  const applyPromptEdit = useCallback(
    (value: string, selection: TextSelection) => {
      const textarea = promptTextareaRef.current;
      // Native pipeline first so Ctrl/Cmd+Z can undo programmatic edits;
      // its input event syncs React state through onChange.
      if (textarea) applyNativeTextareaEdit(textarea, value, selection);
      setPrompt(value);
      setPromptSelection(selection);
      requestAnimationFrame(() => {
        const target = promptTextareaRef.current;
        if (!target) return;
        target.focus();
        target.setSelectionRange(selection.start, selection.end);
        updatePromptSelection(target);
      });
    },
    [updatePromptSelection]
  );

  const commitPathCompletion = useCallback(
    (item: PathCompletionItem, mention: ActivePathMention | null = activePathMention) => {
      if (!mention) return;
      const next = applyPathCompletion(prompt, mention, item.insertText);
      applyPromptEdit(next.value, { start: next.caret, end: next.caret });
      setPathCompletionOpen(item.type === 'dir');
    },
    [activePathMention, applyPromptEdit, prompt]
  );

  const commitSkillShortcut = useCallback(
    (command: string, shortcut: ActiveSkillShortcut | null = null) => {
      const next = shortcut
        ? applySkillShortcut(prompt, shortcut, command)
        : insertPromptText(prompt, promptSelection, command);
      const skillId = skillIdByShortcutCommand.get(command);
      if (skillId) recordSkillInvocation(skillId);
      applyPromptEdit(next.value, { start: next.caret, end: next.caret });
      // Selecting an item must close the menu. If the inserted command still
      // parses as an active shortcut at the new caret (e.g. no trailing space
      // was added), dismiss that key so the menu doesn't immediately reopen.
      const lingering = findActiveSkillShortcut(next.value, next.caret);
      setDismissedSkillShortcutKey(
        lingering
          ? `${lingering.start}:${lingering.end}:${lingering.prefix}:${lingering.query}`
          : null
      );
      setActiveSkillShortcutIndex(0);
    },
    [applyPromptEdit, prompt, promptSelection, skillIdByShortcutCommand]
  );

  const applyPromptMarkdownEdit = useCallback(
    (next: MarkdownTextareaEdit) => {
      applyPromptEdit(next.value, next.selection);
    },
    [applyPromptEdit]
  );

  const applyPromptTabEdit = useCallback(
    (target: HTMLTextAreaElement, direction: 'indent' | 'outdent') => {
      applyPromptMarkdownEdit(
        applyMarkdownTabEdit(
          prompt,
          { start: target.selectionStart, end: target.selectionEnd },
          direction
        )
      );
    },
    [applyPromptMarkdownEdit, prompt]
  );

  const applyPromptEnterEdit = useCallback(
    (target: HTMLTextAreaElement): boolean => {
      const next = applyMarkdownEnterEdit(prompt, {
        start: target.selectionStart,
        end: target.selectionEnd,
      });
      if (!next) return false;
      applyPromptMarkdownEdit(next);
      return true;
    },
    [applyPromptMarkdownEdit, prompt]
  );

  const handlePromptKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (skillShortcutMenuOpen && activeSkillShortcut) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveSkillShortcutIndex((index) =>
            filteredSkillShortcutOptions.length === 0
              ? 0
              : (index + 1) % filteredSkillShortcutOptions.length
          );
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveSkillShortcutIndex((index) =>
            filteredSkillShortcutOptions.length === 0
              ? 0
              : (index - 1 + filteredSkillShortcutOptions.length) %
                filteredSkillShortcutOptions.length
          );
          return;
        }
        if ((e.key === 'Enter' && !isImeComposing(e)) || e.key === 'Tab') {
          const item = filteredSkillShortcutOptions[effectiveSkillShortcutIndex];
          if (!item && e.key === 'Tab') {
            e.preventDefault();
            applyPromptTabEdit(e.currentTarget, e.shiftKey ? 'outdent' : 'indent');
            return;
          }
          e.preventDefault();
          if (item) commitSkillShortcut(item.command, activeSkillShortcut);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setDismissedSkillShortcutKey(activeSkillShortcutKey);
          return;
        }
      }

      if (pathCompletionOpen && activePathMention) {
        if (e.key === 'ArrowDown' && pathCompletionItems.length > 0) {
          e.preventDefault();
          setActivePathCompletionIndex((index) => (index + 1) % pathCompletionItems.length);
          return;
        }
        if (e.key === 'ArrowUp' && pathCompletionItems.length > 0) {
          e.preventDefault();
          setActivePathCompletionIndex(
            (index) => (index - 1 + pathCompletionItems.length) % pathCompletionItems.length
          );
          return;
        }
        if (
          ((e.key === 'Enter' && !isImeComposing(e)) || e.key === 'Tab') &&
          pathCompletionItems.length > 0
        ) {
          e.preventDefault();
          commitPathCompletion(pathCompletionItems[activePathCompletionIndex]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setPathCompletionOpen(false);
          return;
        }
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        applyPromptTabEdit(e.currentTarget, e.shiftKey ? 'outdent' : 'indent');
        return;
      }

      if (e.key === 'Enter' && !isImeComposing(e)) {
        if (applyPromptEnterEdit(e.currentTarget)) {
          e.preventDefault();
          return;
        }

        if (!e.shiftKey) {
          e.preventDefault();
          if (canSubmit) void handleSubmit();
        }
      }
    },
    [
      activePathCompletionIndex,
      activePathMention,
      activeSkillShortcut,
      activeSkillShortcutKey,
      applyPromptEnterEdit,
      applyPromptTabEdit,
      canSubmit,
      commitPathCompletion,
      commitSkillShortcut,
      effectiveSkillShortcutIndex,
      filteredSkillShortcutOptions,
      handleSubmit,
      pathCompletionItems,
      pathCompletionOpen,
      skillShortcutMenuOpen,
    ]
  );

  const promptInputChrome = getRunModeInputChrome(runMode);
  const PromptInputModeIcon = promptInputChrome.icon;
  const isNonStandardRunMode = runMode !== 'normal';

  return (
    <div className={className}>
      <div
        className={cn(
          'rounded-lg border shadow-sm transition-[background-color,border-color,box-shadow]',
          promptInputChrome.containerClassName
        )}
      >
        <div className="flex flex-col">
          <div className="relative">
            {isNonStandardRunMode && (
              <div
                className={cn(
                  'pointer-events-none absolute right-3 top-2 z-10 inline-flex h-6 max-w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium',
                  promptInputChrome.badgeClassName
                )}
              >
                <PromptInputModeIcon className="size-3.5 shrink-0" />
                <span className="truncate">{t(promptInputChrome.labelKey)}</span>
              </div>
            )}
            <Textarea
              ref={promptTextareaRef}
              placeholder={t('home.promptPlaceholder')}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                updatePromptSelection(e.target);
              }}
              onSelect={(e) => updatePromptSelection(e.currentTarget)}
              onClick={(e) => updatePromptSelection(e.currentTarget)}
              onFocus={(e) => {
                setPromptFocused(true);
                updatePromptSelection(e.currentTarget);
                if (activePathMention) setPathCompletionOpen(true);
              }}
              onKeyUp={(e) => updatePromptSelection(e.currentTarget)}
              onBlur={() => {
                setPromptFocused(false);
                setPathCompletionOpen(false);
              }}
              onKeyDown={handlePromptKeyDown}
              className={cn(
                'min-h-28 resize-none border-0 bg-transparent px-5 py-4 text-base placeholder:text-foreground-muted focus-visible:border-0 focus-visible:ring-0',
                isNonStandardRunMode && 'pt-10'
              )}
            />
            {pathCompletionOpen && activePathMention && (
              <PathCompletionMenu
                items={pathCompletionItems}
                activeIndex={activePathCompletionIndex}
                loading={pathCompletionLoading}
                error={pathCompletionError}
                showEmpty={activePathMention.query.length > 0}
                labels={{
                  loading: t('common.loading'),
                  error: t('common.error'),
                  noResults: t('common.noResults'),
                }}
                onActiveIndexChange={setActivePathCompletionIndex}
                onSelect={(item) => commitPathCompletion(item, activePathMention)}
              />
            )}
            {skillShortcutMenuOpen && activeSkillShortcut && (
              <SkillShortcutMenu
                items={filteredSkillShortcutOptions}
                activeIndex={effectiveSkillShortcutIndex}
                loading={skillsLoading}
                showEmpty={activeSkillShortcut.query.length > 0}
                labels={{
                  loading: t('common.loading'),
                  noResults: t('skills.noMatches'),
                }}
                onActiveIndexChange={setActiveSkillShortcutIndex}
                onSelect={(item) => commitSkillShortcut(item.command, activeSkillShortcut)}
              />
            )}
          </div>
          <div className="flex items-center justify-between gap-2 px-2.5 py-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={t('home.addAria')}
                onClick={() => showAddProjectModal({ strategy: 'local', mode: 'pick' })}
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground"
              >
                <Plus className="size-4" />
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <SkillShortcutSelector
                runtimeId={runtimeId}
                options={skillShortcutOptions}
                isLoading={skillsLoading}
                isError={skillsError}
                onInsert={commitSkillShortcut}
                className="h-8 gap-1.5 rounded-full border-0 bg-background-2/60 px-3 text-xs font-medium text-foreground transition-colors hover:bg-background-2"
              />
              <button
                type="button"
                aria-label={t('home.voiceAria')}
                aria-busy={voiceInputTriggering}
                title={t('home.voiceTooltip')}
                disabled={voiceInputTriggering}
                onClick={() => void handleVoiceInput()}
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full transition-colors',
                  voiceInputTriggering
                    ? 'bg-primary/10 text-primary hover:bg-primary/15'
                    : 'text-foreground-muted hover:bg-background-2 hover:text-foreground'
                )}
              >
                <Mic className={cn('size-4', voiceInputTriggering && 'animate-pulse')} />
              </button>
              <button
                type="button"
                aria-label={t('home.submitAria')}
                disabled={!canSubmit}
                onClick={() => void handleSubmit()}
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full transition-all duration-150',
                  canSubmit
                    ? 'scale-100 bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
                    : 'scale-95 text-foreground-muted/60'
                )}
              >
                <ArrowUp className={cn('size-4 transition-transform', canSubmit && 'scale-110')} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <div className="overflow-x-auto pb-1">
          <div ref={runModeAnchorRef} className="flex min-w-max flex-wrap items-center gap-2">
            <ProjectSelector
              value={selectedProjectId}
              onChange={setSelectedProjectId}
              allowProjectless
              initializeGitRepositoryOnPick
              trigger={
                <ComboboxTrigger className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background-1 px-2.5 text-xs text-foreground transition-colors hover:bg-background-2">
                  <FolderOpen className="size-3.5 text-foreground-muted" />
                  <ComboboxValue placeholder={t('home.selectProjectPlaceholder')} />
                </ComboboxTrigger>
              }
            />
            <RunHostSelector kind={runHostKind} />
            {runMode === 'brainstorm' && <Chip icon={Lightbulb}>{t('home.brainstormPolicy')}</Chip>}
            {mounted && runMode === 'compare' && (
              <Chip icon={GitFork}>
                {t('home.compareBranchPolicy', { count: compareRuntimes.length })}
              </Chip>
            )}
            {mounted && runMode === 'team' && (
              <Chip icon={GitFork}>{t('home.teamBranchPolicy')}</Chip>
            )}
            {mounted && runMode === 'normal' && (
              <StrategyChip
                strategyKind={effectiveStandardStrategyKind}
                disabled={isUnborn}
                onChange={setStrategyKind}
                ariaLabel={t('home.strategyAria')}
                labels={strategyLabels}
              />
            )}
            {mounted && runMode === 'review' && (
              <StrategyChip
                strategyKind={effectiveReviewStrategyKind}
                disabled={isUnborn}
                onChange={setReviewStrategyKind}
                ariaLabel={t('home.reviewStrategyAria')}
                labels={reviewStrategyLabels}
              />
            )}
            <RunModeSelector
              mode={runMode}
              summary={runModeSummary}
              onChange={setRunMode}
              anchorRef={runModeAnchorRef}
              renderConfiguration={(configurationMode) => (
                <ModeConfigurationPanel
                  mode={configurationMode}
                  runtimeId={runtimeId}
                  onRuntimeChange={setRuntimeOverride}
                  compareRuntimes={compareRuntimes}
                  onCompareProviderChange={setCompareProvider}
                  onAddCompareRuntime={addCompareProvider}
                  onRemoveCompareRuntime={removeCompareProvider}
                  reviewerRuntime={reviewerRuntime}
                  onReviewerProviderChange={setReviewerProvider}
                  teamRuntimes={teamRuntimes}
                  onTeamProviderChange={setTeamProvider}
                  agents={userAgents}
                  slotAgentId={slotAgentId}
                  onSlotAgentChange={setSlotAgent}
                  connectionId={connectionId}
                  className="mt-2 border-t-0 pt-0"
                />
              )}
            />
          </div>
        </div>
      </div>
    </div>
  );
});

interface ChipProps {
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}

interface RunHostSelectorProps {
  kind: RunHostKind;
}

interface PathCompletionMenuProps {
  items: PathCompletionItem[];
  activeIndex: number;
  loading: boolean;
  error: boolean;
  showEmpty: boolean;
  labels: {
    loading: string;
    error: string;
    noResults: string;
  };
  onActiveIndexChange: (index: number) => void;
  onSelect: (item: PathCompletionItem) => void;
}

function PathCompletionMenu({
  items,
  activeIndex,
  loading,
  error,
  showEmpty,
  labels,
  onActiveIndexChange,
  onSelect,
}: PathCompletionMenuProps) {
  if (!loading && !error && items.length === 0 && !showEmpty) return null;

  return (
    <div
      role="listbox"
      className="absolute left-3 right-3 top-full z-40 mt-1 max-h-64 overflow-hidden rounded-lg border border-border bg-background-quaternary py-1 text-sm text-foreground shadow-lg ring-1 ring-foreground/5"
    >
      {loading && items.length === 0 ? (
        <div className="flex items-center gap-2 px-3 py-2 text-foreground-muted">
          <Loader2 className="size-3.5 animate-spin" />
          <span>{labels.loading}</span>
        </div>
      ) : error ? (
        <div className="px-3 py-2 text-foreground-muted">{labels.error}</div>
      ) : items.length === 0 && showEmpty ? (
        <div className="px-3 py-2 text-foreground-muted">{labels.noResults}</div>
      ) : items.length === 0 ? null : (
        <div className="max-h-64 overflow-y-auto">
          {items.map((item, index) => {
            const Icon = item.type === 'dir' ? Folder : FileText;
            const active = index === activeIndex;
            return (
              <button
                key={`${item.type}:${item.path}`}
                type="button"
                role="option"
                aria-selected={active}
                onMouseEnter={() => onActiveIndexChange(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect(item);
                }}
                className={cn(
                  'flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left transition-colors',
                  active ? 'bg-background-2 text-foreground' : 'text-foreground-muted'
                )}
              >
                <Icon className="size-4 shrink-0 text-foreground-passive" />
                <span className="truncate font-mono text-xs">{item.insertText}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface SkillShortcutMenuProps {
  items: SkillShortcutOption[];
  activeIndex: number;
  loading: boolean;
  showEmpty: boolean;
  labels: {
    loading: string;
    noResults: string;
  };
  onActiveIndexChange: (index: number) => void;
  onSelect: (item: SkillShortcutOption) => void;
}

function SkillShortcutMenu({
  items,
  activeIndex,
  loading,
  showEmpty,
  labels,
  onActiveIndexChange,
  onSelect,
}: SkillShortcutMenuProps) {
  const activeItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!loading && items.length === 0 && !showEmpty) return null;

  return (
    <div
      role="listbox"
      className="absolute left-3 right-3 top-full z-40 mt-1 max-h-72 overflow-hidden rounded-lg border border-border bg-background-quaternary py-1 text-sm text-foreground shadow-lg ring-1 ring-foreground/5"
    >
      {loading && items.length === 0 ? (
        <div className="flex items-center gap-2 px-3 py-2 text-foreground-muted">
          <Loader2 className="size-3.5 animate-spin" />
          <span>{labels.loading}</span>
        </div>
      ) : items.length === 0 && showEmpty ? (
        <div className="px-3 py-2 text-foreground-muted">{labels.noResults}</div>
      ) : items.length === 0 ? null : (
        <div className="max-h-72 overflow-y-auto">
          {items.map((item, index) => {
            const active = index === activeIndex;
            return (
              <button
                key={item.value}
                ref={active ? activeItemRef : undefined}
                type="button"
                role="option"
                aria-selected={active}
                onMouseEnter={() => onActiveIndexChange(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect(item);
                }}
                className={cn(
                  'flex w-full min-w-0 items-start gap-2 px-3 py-2 text-left transition-colors',
                  active ? 'bg-background-2 text-foreground' : 'text-foreground-muted'
                )}
              >
                <Sparkles className="mt-0.5 size-4 shrink-0 text-foreground-passive" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <code className="shrink-0 rounded bg-background-quaternary-2 px-1.5 py-0.5 font-mono text-[10px] text-foreground-muted">
                      {item.command}
                    </code>
                  </div>
                  {item.description ? (
                    <p className="mt-0.5 line-clamp-1 text-xs text-foreground-muted">
                      {item.description}
                    </p>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface SkillShortcutSelectorProps {
  runtimeId: RuntimeId | null;
  options: SkillShortcutOption[];
  isLoading: boolean;
  isError: boolean;
  onInsert: (command: string) => void;
  className?: string;
}

interface SkillShortcutGroup {
  value: string;
  label: string;
  items: SkillShortcutOption[];
}

function SkillShortcutSelector({
  runtimeId,
  options,
  isLoading,
  isError,
  onInsert,
  className,
}: SkillShortcutSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const groups = useMemo<SkillShortcutGroup[]>(
    () => [{ value: 'installed', label: t('skills.installed'), items: options }],
    [options, t]
  );
  const disabled = !runtimeId || isLoading || isError || options.length === 0;

  const handleValueChange = useCallback(
    (item: SkillShortcutOption | null) => {
      if (!item || disabled) return;
      onInsert(item.command);
      setOpen(false);
    },
    [disabled, onInsert]
  );

  return (
    <Combobox
      items={groups}
      value={null}
      onValueChange={handleValueChange}
      open={!disabled && open}
      onOpenChange={disabled ? undefined : setOpen}
      isItemEqualToValue={(a: SkillShortcutOption, b: SkillShortcutOption) => a.value === b.value}
      filter={(item: SkillShortcutOption, query) => {
        const q = query.toLowerCase();
        return (
          item.label.toLowerCase().includes(q) ||
          item.value.toLowerCase().includes(q) ||
          item.command.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q)
        );
      }}
      autoHighlight
    >
      <ComboboxTrigger
        disabled={disabled}
        aria-label={t('home.skillShortcutAria')}
        className={cn(
          'flex h-9 min-w-0 items-center gap-2 rounded-md border border-border bg-transparent px-2.5 py-1 text-sm outline-none',
          disabled && 'cursor-not-allowed opacity-60',
          className
        )}
      >
        <Sparkles className="size-3.5 shrink-0 text-foreground-muted" />
        <span className="min-w-0 truncate text-left">{t('home.skillShortcutLabel')}</span>
        {isLoading ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-foreground-muted" />
        ) : (
          <ChevronDown className="size-3.5 shrink-0 text-foreground-muted" />
        )}
      </ComboboxTrigger>
      <ComboboxContent className="w-96 min-w-(--anchor-width)">
        <ComboboxInput showTrigger={false} placeholder={t('home.searchSkills')} />
        <ComboboxEmpty>{t('skills.noMatches')}</ComboboxEmpty>
        <ComboboxList className="pb-0">
          {(group: SkillShortcutGroup) => (
            <ComboboxGroup key={group.value} items={group.items} className="py-1">
              <ComboboxLabel>{group.label}</ComboboxLabel>
              <ComboboxCollection>
                {(item: SkillShortcutOption) => (
                  <ComboboxItem key={item.value} value={item} className="items-start gap-2 py-2">
                    <Sparkles className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        <code className="shrink-0 rounded bg-background-quaternary-2 px-1.5 py-0.5 font-mono text-[10px] text-foreground-muted">
                          {item.command}
                        </code>
                      </div>
                      {item.description ? (
                        <p className="mt-0.5 line-clamp-1 text-xs text-foreground-muted">
                          {item.description}
                        </p>
                      ) : null}
                    </div>
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

const RUN_MODE_OPTIONS: Array<{
  mode: HomeRunMode;
  icon: ComponentType<{ className?: string }>;
  labelKey: string;
  descKey: string;
}> = [
  { mode: 'normal', icon: Bot, labelKey: 'home.modeNormal', descKey: 'home.modeNormalDesc' },
  {
    mode: 'brainstorm',
    icon: Lightbulb,
    labelKey: 'home.modeBrainstorm',
    descKey: 'home.modeBrainstormDesc',
  },
  {
    mode: 'compare',
    icon: GitCompare,
    labelKey: 'home.modeCompare',
    descKey: 'home.modeCompareDesc',
  },
  { mode: 'review', icon: Repeat2, labelKey: 'home.modeReview', descKey: 'home.modeReviewDesc' },
  { mode: 'team', icon: Users, labelKey: 'home.modeTeam', descKey: 'home.modeTeamDesc' },
];

interface RunModeSelectorProps {
  mode: HomeRunMode;
  summary?: string | null;
  onChange: (mode: HomeRunMode) => void;
  renderConfiguration: (mode: HomeRunMode) => ReactNode;
  anchorRef?: RefObject<HTMLElement | null>;
}

function RunModeSelector({
  mode,
  summary,
  onChange,
  renderConfiguration,
  anchorRef,
}: RunModeSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const current = RUN_MODE_OPTIONS.find((option) => option.mode === mode) ?? RUN_MODE_OPTIONS[0];
  const CurrentIcon = current.icon;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={t('home.modeAria')}
            className="flex h-7 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
          >
            <CurrentIcon className="size-3.5" />
            <span>{t(current.labelKey)}</span>
            {summary ? (
              <>
                <span className="text-primary/40">·</span>
                <span className="max-w-[14rem] truncate font-normal text-primary/80">
                  {summary}
                </span>
              </>
            ) : null}
            <ChevronDown className="size-3 text-primary/70" />
          </button>
        }
      />
      <PopoverContent
        align="start"
        anchor={anchorRef}
        className="max-h-[min(70dvh,40rem)] w-[min(44rem,calc(100vw-2rem))] gap-0 overflow-hidden p-0"
      >
        <div className="flex min-h-0 max-h-[inherit] divide-x divide-border/60">
          <div
            role="tablist"
            aria-label={t('home.modeAria')}
            aria-orientation="vertical"
            className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto bg-background-1/50 p-2"
          >
            {RUN_MODE_OPTIONS.map((option) => {
              const Icon = option.icon;
              const active = option.mode === mode;
              return (
                <button
                  key={option.mode}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  title={t(option.descKey)}
                  onClick={() => onChange(option.mode)}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                    active
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-foreground-muted hover:bg-background-2 hover:text-foreground'
                  )}
                >
                  <Icon
                    className={cn(
                      'size-4 shrink-0',
                      active ? 'text-primary' : 'text-foreground-muted'
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{t(option.labelKey)}</span>
                  {active && <Check className="size-3.5 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
            <div className="flex items-center gap-2">
              <CurrentIcon className="size-4 shrink-0 text-primary" />
              <span className="text-sm font-semibold text-foreground">{t(current.labelKey)}</span>
            </div>
            <p className="text-xs text-foreground-muted">{t(current.descKey)}</p>
            {renderConfiguration(mode)}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface StrategyChipLabels {
  chipNewBranch: string;
  chipNoWorktree: string;
  newBranchTitle: string;
  newBranchDesc: string;
  noWorktreeTitle: string;
  noWorktreeDesc: string;
}

interface ModeConfigurationPanelProps {
  mode: HomeRunMode;
  runtimeId: RuntimeId | null;
  onRuntimeChange: (agent: RuntimeId) => void;
  compareRuntimes: RuntimeId[];
  onCompareProviderChange: (index: number, provider: RuntimeId) => void;
  onAddCompareRuntime: () => void;
  onRemoveCompareRuntime: (index: number) => void;
  reviewerRuntime: RuntimeId;
  onReviewerProviderChange: (provider: RuntimeId) => void;
  teamRuntimes: TeamRuntimeSelection;
  onTeamProviderChange: (roleId: TeamRoleId, provider: RuntimeId) => void;
  agents: Agent[];
  slotAgentId: (slotKey: string) => string | null;
  onSlotAgentChange: (slotKey: string, agentId: string) => void;
  connectionId?: string;
  className?: string;
}

function ModeConfigurationPanel({
  mode,
  runtimeId,
  onRuntimeChange,
  compareRuntimes,
  onCompareProviderChange,
  onAddCompareRuntime,
  onRemoveCompareRuntime,
  reviewerRuntime,
  onReviewerProviderChange,
  teamRuntimes,
  onTeamProviderChange,
  agents,
  slotAgentId,
  onSlotAgentChange,
  connectionId,
  className,
}: ModeConfigurationPanelProps) {
  const { t } = useTranslation();

  // A slot card needs its Agent selection. `key` is the slot's stable key (the
  // mode's prompt key, reused purely to key the per-slot selection).
  const slotProps = (key: string) => ({
    agents,
    selectedAgentId: slotAgentId(key),
    onSelectAgent: (agentId: string) => onSlotAgentChange(key, agentId),
  });

  return (
    <div className={cn('mt-3 border-t border-border/60 pt-3', className)}>
      {mode === 'normal' && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Agent
            icon={Bot}
            label={t('home.agentLabel')}
            value={runtimeId}
            onChange={onRuntimeChange}
            connectionId={connectionId}
            {...slotProps(NORMAL_PROMPT_KEY)}
          />
        </div>
      )}

      {mode === 'brainstorm' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Agent
            icon={Lightbulb}
            label={t('home.brainstormAgent')}
            value={runtimeId}
            onChange={onRuntimeChange}
            connectionId={connectionId}
            {...slotProps(SPEC_PROMPT_KEY)}
          />
        </div>
      )}

      {mode === 'compare' && (
        <div className="grid gap-2 sm:grid-cols-2">
          {compareRuntimes.map((agent, index) => (
            <Agent
              key={`${agent}-${index}`}
              icon={GitCompare}
              label={t('home.compareAgent', { index: index + 1 })}
              value={agent}
              onChange={(provider) => onCompareProviderChange(index, provider)}
              connectionId={connectionId}
              {...slotProps(comparePromptKey(index))}
              action={
                <button
                  type="button"
                  aria-label={t('home.removeCompareAgent')}
                  disabled={compareRuntimes.length <= MIN_COMPARE_AGENTS}
                  onClick={() => onRemoveCompareRuntime(index)}
                  className="flex size-8 shrink-0 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <X className="size-3.5" />
                </button>
              }
            />
          ))}
          {compareRuntimes.length < MAX_COMPARE_AGENTS && (
            <button
              type="button"
              onClick={onAddCompareRuntime}
              className="flex min-h-24 items-center justify-center gap-2 rounded-md border border-dashed border-border bg-background-1 text-sm text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground"
            >
              <Plus className="size-4" />
              <span>{t('home.addCompareAgent')}</span>
            </button>
          )}
        </div>
      )}

      {mode === 'review' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Agent
            icon={Bot}
            label={t('home.reviewImplementer')}
            value={runtimeId}
            onChange={onRuntimeChange}
            connectionId={connectionId}
            {...slotProps(REVIEW_IMPLEMENTER_PROMPT_KEY)}
          />
          <Agent
            icon={ShieldCheck}
            label={t('home.reviewReviewer')}
            value={reviewerRuntime}
            onChange={onReviewerProviderChange}
            connectionId={connectionId}
            {...slotProps(REVIEW_REVIEWER_PROMPT_KEY)}
          />
          <div className="sm:col-span-2 text-xs text-foreground-muted">
            {t('home.reviewRoundLimit', { count: REVIEW_MAX_ROUNDS })}
          </div>
        </div>
      )}

      {mode === 'team' && (
        <div className="grid gap-2 sm:grid-cols-2">
          {TEAM_ROLES.map((role) => (
            <Agent
              key={role.id}
              icon={role.icon}
              label={t(role.labelKey)}
              value={teamRuntimes[role.id]}
              onChange={(provider) => onTeamProviderChange(role.id, provider)}
              connectionId={connectionId}
              {...slotProps(teamPromptKey(role.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface AgentProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  /** Per-slot runtime override. Loosely coupled to the Agent's preferred runtime. */
  value: RuntimeId | null;
  onChange: (provider: RuntimeId) => void;
  connectionId?: string;
  action?: ReactNode;
  /** User Agents this slot can pick from. */
  agents: Agent[];
  /** Currently selected Agent id for this slot, or null when none chosen yet. */
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
}

function Agent({
  icon: Icon,
  label,
  value,
  onChange,
  connectionId,
  action,
  agents,
  selectedAgentId,
  onSelectAgent,
}: AgentProps) {
  const { navigate } = useNavigate();
  const showAgentModal = useShowModal('agentEditModal');

  const selectedAgent = selectedAgentId
    ? (agents.find((a) => a.id === selectedAgentId) ?? null)
    : null;
  // Runtime shown on the card: the per-slot override wins, else the Agent's
  // preferred runtime. Editing it here sets the per-slot override (loose
  // coupling — it does not mutate the Agent).
  const runtime = value ?? selectedAgent?.preferredRuntime ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border/70 bg-background-1 p-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-background-2 text-foreground-muted">
          <Icon className="size-3" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-wide text-foreground-muted">
          {label}
        </span>
        {action}
      </div>
      <AgentSlotSelector
        selectedAgent={selectedAgent}
        agents={agents}
        onSelectAgent={onSelectAgent}
        onCreateAgent={() => showAgentModal({ onSuccess: (created) => onSelectAgent(created.id) })}
        onManageAgents={() => navigate('agentManager')}
      />
      {selectedAgent && (
        <AgentSelector
          value={runtime}
          onChange={onChange}
          connectionId={connectionId}
          className="h-9 text-sm"
        />
      )}
    </div>
  );
}

function Chip({ icon: Icon, children }: ChipProps) {
  return (
    <span className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background-1 px-2.5 text-xs text-foreground">
      <Icon className="size-3.5 text-foreground-muted" />
      {children}
    </span>
  );
}

function RunHostSelector({ kind }: RunHostSelectorProps) {
  const { t } = useTranslation();
  const options: Array<{
    kind: RunHostKind;
    icon: ComponentType<{ className?: string }>;
    label: string;
  }> = [
    { kind: 'local', icon: Monitor, label: t('home.runHostLocal') },
    { kind: 'ssh', icon: Server, label: t('home.runHostSsh') },
  ];
  const current = options.find((option) => option.kind === kind) ?? options[0];
  const CurrentIcon = current.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={t('home.runHostAria')}
            className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background-1 px-2.5 text-xs text-foreground transition-colors hover:bg-background-2"
          >
            <CurrentIcon className="size-3.5 text-foreground-muted" />
            <span>{current.label}</span>
            <ChevronDown className="size-3 text-foreground-muted" />
          </button>
        }
      />
      <DropdownMenuContent align="start" className="w-56 p-1.5">
        {options.map((option) => {
          const Icon = option.icon;
          const active = option.kind === kind;
          return (
            <DropdownMenuItem
              key={option.kind}
              disabled={!active}
              className="gap-2 rounded-md px-2.5 py-2"
            >
              <Icon className="size-4 shrink-0 text-foreground-muted" />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {option.label}
              </span>
              {active ? (
                <Check className="size-3.5 shrink-0 text-foreground-muted" />
              ) : option.kind === 'ssh' ? (
                <span className="shrink-0 rounded-sm bg-background-2 px-1.5 py-0.5 text-[10px] text-foreground-muted">
                  {t('common.comingSoon')}
                </span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface StrategyChipProps {
  strategyKind: TaskStrategyKind;
  disabled: boolean;
  onChange: (next: TaskStrategyKind) => void;
  ariaLabel: string;
  labels: StrategyChipLabels;
}

function StrategyChip({ strategyKind, disabled, onChange, ariaLabel, labels }: StrategyChipProps) {
  const isNewBranch = strategyKind === 'new-branch';
  const Icon = isNewBranch ? GitFork : Anchor;
  const chipLabel = isNewBranch ? labels.chipNewBranch : labels.chipNoWorktree;

  if (disabled) {
    return (
      <span className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background-1 px-2.5 text-xs text-foreground">
        <Icon className="size-3.5 text-foreground-muted" />
        {chipLabel}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={ariaLabel}
            className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background-1 px-2.5 text-xs text-foreground transition-colors hover:bg-background-2"
          >
            <Icon className="size-3.5 text-foreground-muted" />
            <span>{chipLabel}</span>
            <ChevronDown className="size-3 text-foreground-muted" />
          </button>
        }
      />
      <DropdownMenuContent align="start" className="w-80 p-1.5">
        <DropdownMenuItem
          onClick={() => onChange('no-worktree')}
          className="items-start gap-3 rounded-md px-2.5 py-2"
        >
          <Anchor className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">{labels.noWorktreeTitle}</span>
            <span className="text-xs leading-snug text-foreground-muted">
              {labels.noWorktreeDesc}
            </span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onChange('new-branch')}
          className="items-start gap-3 rounded-md px-2.5 py-2"
        >
          <GitFork className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">{labels.newBranchTitle}</span>
            <span className="text-xs leading-snug text-foreground-muted">
              {labels.newBranchDesc}
            </span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const homeView = {
  WrapView: HomeViewWrapper,
  TitlebarSlot: HomeTitlebar,
  MainPanel: HomeMainPanel,
};
