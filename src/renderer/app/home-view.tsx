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
  PencilLine,
  Plus,
  Repeat2,
  RotateCcw,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
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
} from 'react';
import { useTranslation } from 'react-i18next';
import yodaLogoWhite from '@/assets/images/yoda/yoda_logo_white.svg';
import yodaLogo from '@/assets/images/yoda/yoda_logo.svg';
import {
  applyAgentCommandPrefix,
  getAgentCommandSubmitDelayMs,
} from '@shared/agent-command-prefix';
import {
  AGENT_PROVIDER_IDS,
  getProvider,
  type AgentProviderId,
} from '@shared/agent-provider-registry';
import type { Agent } from '@shared/agents';
import { INTERNAL_PROJECT_ID } from '@shared/projects';
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
import { useEffectiveProvider } from '@renderer/features/tasks/conversations/use-effective-provider';
import { ProjectSelector } from '@renderer/features/tasks/create-task-modal/project-selector';
import { useAgentAutoApproveDefaults } from '@renderer/features/tasks/hooks/useAgentAutoApproveDefaults';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { toast } from '@renderer/lib/hooks/use-toast';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { buildPromptInjectionPayload } from '@renderer/lib/pty/prompt-injection';
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
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@renderer/lib/ui/popover';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import {
  applyMarkdownEnterEdit,
  applyMarkdownTabEdit,
  type MarkdownTextareaEdit,
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
type TeamProviderSelection = Record<TeamRoleId, AgentProviderId>;
type AgentSystemPromptOverrides = Record<string, string | null>;

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
const DEFAULT_COMPARE_PROVIDERS: AgentProviderId[] = ['claude', 'codex'];
const DEFAULT_REVIEWER_PROVIDER: AgentProviderId = 'claude';
const DEFAULT_TEAM_PROVIDERS: TeamProviderSelection = {
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
const ADVANCED_INPUT_CONTAINER_CLASS =
  'border-border bg-background-1 ring-1 ring-sky-500/15 focus-within:border-sky-500/30 focus-within:ring-sky-500/25';
const ADVANCED_INPUT_BADGE_CLASS =
  'border-sky-500/25 bg-sky-500/10 text-sky-700 shadow-sm ydark:text-sky-300';

const TEAM_ROLES = [
  {
    id: 'ceo',
    icon: Crown,
    persona: 'Elon Musk',
    labelKey: 'home.teamRoleCeo',
    taskSuffix: 'ceo',
  },
  {
    id: 'product',
    icon: Briefcase,
    persona: 'Steve Jobs',
    labelKey: 'home.teamRoleProduct',
    taskSuffix: 'product',
  },
  {
    id: 'engineering',
    icon: Code2,
    persona: 'Linus Torvalds',
    labelKey: 'home.teamRoleEngineering',
    taskSuffix: 'engineering',
  },
  {
    id: 'uiux',
    icon: Palette,
    persona: 'Jony Ive',
    labelKey: 'home.teamRoleUiux',
    taskSuffix: 'uiux',
  },
  {
    id: 'operations',
    icon: Megaphone,
    persona: 'Tim Cook',
    labelKey: 'home.teamRoleOperations',
    taskSuffix: 'operations',
  },
] as const satisfies ReadonlyArray<{
  id: TeamRoleId;
  icon: ComponentType<{ className?: string }>;
  persona: string;
  labelKey: string;
  taskSuffix: string;
}>;

const TEAM_ROLE_BRIEFS: Record<TeamRoleId, string> = {
  ceo: 'Coordinate the team.',
  product: 'Turn the requirement into product behavior, scope, acceptance criteria, and tradeoffs.',
  engineering: 'Implement the code changes with engineering rigor and run the relevant validation.',
  uiux: 'Shape the user experience and UI details, then implement UI changes when appropriate.',
  operations: 'Review user-facing rollout, onboarding, communication, and operational risks.',
};

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

function uniqueProviders(providers: AgentProviderId[]): AgentProviderId[] {
  return Array.from(new Set(providers));
}

function normalizeCompareProviders(
  saved: AgentProviderId[] | undefined,
  primary: AgentProviderId | null
): AgentProviderId[] {
  const providers = uniqueProviders([
    ...(primary ? [primary] : []),
    ...(saved && saved.length > 0 ? saved : DEFAULT_COMPARE_PROVIDERS),
  ]);
  if (providers.length >= MIN_COMPARE_AGENTS) return providers.slice(0, MAX_COMPARE_AGENTS);

  for (const id of AGENT_PROVIDER_IDS) {
    if (!providers.includes(id)) providers.push(id);
    if (providers.length >= MIN_COMPARE_AGENTS) break;
  }
  return providers.slice(0, MAX_COMPARE_AGENTS);
}

function nextAvailableProvider(existing: AgentProviderId[]): AgentProviderId {
  return AGENT_PROVIDER_IDS.find((id) => !existing.includes(id)) ?? existing[0] ?? 'claude';
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

function defaultCompareSystemPrompt(index: number): string {
  return [
    `You are comparison agent ${index + 1}.`,
    `Independently implement the user's requirement in your isolated branch/worktree.`,
    `Prioritize correctness, minimal scope, and clear validation. Do not coordinate with other comparison agents.`,
  ].join('\n');
}

function defaultReviewImplementerSystemPrompt(): string {
  return [
    `You are implementer agent A.`,
    `Implement the user's requirement in the current worktree, then stop when the implementation round is complete.`,
    `When reviewer feedback arrives, address it in the same worktree without restarting the direction unless the review requires it.`,
  ].join('\n');
}

function defaultReviewReviewerSystemPrompt(): string {
  return [
    `You are reviewer agent B.`,
    `Review the current worktree implementation against the original requirement.`,
    `Focus on correctness, regressions, edge cases, missing tests, and whether the implementation actually satisfies the requirement.`,
  ].join('\n');
}

function defaultSpecSystemPrompt(): string {
  return [
    `You are a spec-driven development agent.`,
    `Use a spec-first workflow: clarify requirements, capture UI/UX expectations, outline technical design, break work into tasks, and define verification before implementation.`,
    `Ask only concise, high-leverage questions when missing information materially changes scope, UX, data model, constraints, safety, or acceptance. Prefer explicit assumptions over low-impact questions.`,
    `Do not implement, edit files, or start coding in this mode.`,
    `Maintain a compact, itemized PRD as decisions settle: goals, users, workflows, requirements, UI/UX notes, acceptance criteria, edge cases, assumptions, and open questions.`,
    `When the requirement is specific enough, produce a handoff package with PRD, design notes, implementation tasks, verification plan, and any unresolved decisions.`,
  ].join('\n');
}

function defaultTeamSystemPrompt(role: (typeof TEAM_ROLES)[number]): string {
  if (role.id === 'ceo') {
    return [
      `You are the CEO agent, role-playing ${role.persona} as a demanding technical CEO.`,
      `Receive the user requirement, decompose it, and assign concrete work packages to product, engineering, UI/UX, and user operations agents.`,
      `Do not edit files. Produce concise assignments with acceptance criteria and risks.`,
    ].join('\n');
  }

  return [
    `You are the ${role.id} agent, role-playing ${role.persona}.`,
    TEAM_ROLE_BRIEFS[role.id],
    `Work in your own branch/worktree. Make only the changes appropriate for your role and stop when your contribution is complete.`,
  ].join('\n');
}

function resolveAgentSystemPrompt(
  overrides: AgentSystemPromptOverrides,
  key: string,
  defaultPrompt: string
): string {
  const override = overrides[key];
  return typeof override === 'string' ? override : defaultPrompt;
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
  const payload = buildPromptInjectionPayload({
    providerId: conversation.data.providerId,
    text,
  });
  if (!payload) return;

  conversation.setWorking({ force: true });
  const first = await rpc.pty.sendInput(conversation.session.sessionId, payload);
  if (!first.success) throw new Error('Could not send prompt to agent session.');

  await sleep(getAgentCommandSubmitDelayMs(conversation.data.providerId));
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
  reviewerProvider: AgentProviderId;
  reviewerSystemPrompt: string;
  getAutoApprove: (providerId: AgentProviderId) => boolean;
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
      provider: args.reviewerProvider,
      title: initialConversationTitle(args.reviewerProvider, args.requirement, []),
      initialPrompt: buildReviewPrompt({
        requirement: args.requirement,
        round,
        systemPrompt: args.reviewerSystemPrompt,
      }),
      autoApprove: args.getAutoApprove(args.reviewerProvider),
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

export function HomeTitlebar() {
  return <Titlebar />;
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
  const showAddProjectModal = useShowModal('addProjectModal');
  const { navigate } = useNavigate();
  const { data: accountSession } = useAccountSession();
  const sessionUser = accountSession?.user;
  const greetingName = sessionUser?.name?.trim() || sessionUser?.username || '';

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

  const providerOverrideValue = draft?.providerOverride ?? null;
  const setProviderOverridePersisted = useCallback(
    (id: AgentProviderId | null) => {
      updateDraft({ providerOverride: id });
    },
    [updateDraft]
  );
  const { providerId, setProviderOverride } = useEffectiveProvider(connectionId, {
    value: providerOverrideValue,
    set: setProviderOverridePersisted,
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
  const compareProviders = useMemo(
    () => normalizeCompareProviders(draft?.compareProviders, providerId),
    [draft?.compareProviders, providerId]
  );
  const setCompareProvider = useCallback(
    (index: number, next: AgentProviderId) => {
      const providers = [...compareProviders];
      providers[index] = next;
      updateDraft({ compareProviders: uniqueProviders(providers).slice(0, MAX_COMPARE_AGENTS) });
    },
    [compareProviders, updateDraft]
  );
  const addCompareProvider = useCallback(() => {
    updateDraft({
      compareProviders: [...compareProviders, nextAvailableProvider(compareProviders)].slice(
        0,
        MAX_COMPARE_AGENTS
      ),
    });
  }, [compareProviders, updateDraft]);
  const removeCompareProvider = useCallback(
    (index: number) => {
      if (compareProviders.length <= MIN_COMPARE_AGENTS) return;
      updateDraft({ compareProviders: compareProviders.filter((_, i) => i !== index) });
    },
    [compareProviders, updateDraft]
  );
  const reviewerProvider = draft?.reviewReviewerProvider ?? DEFAULT_REVIEWER_PROVIDER;
  const setReviewerProvider = useCallback(
    (next: AgentProviderId) => {
      updateDraft({ reviewReviewerProvider: next });
    },
    [updateDraft]
  );
  const teamProviders = useMemo<TeamProviderSelection>(
    () => draft?.teamProviders ?? DEFAULT_TEAM_PROVIDERS,
    [draft?.teamProviders]
  );
  const setTeamProvider = useCallback(
    (roleId: TeamRoleId, next: AgentProviderId) => {
      updateDraft({ teamProviders: { ...teamProviders, [roleId]: next } });
    },
    [teamProviders, updateDraft]
  );
  const agentSystemPrompts = useMemo<AgentSystemPromptOverrides>(
    () => draft?.agentSystemPrompts ?? {},
    [draft?.agentSystemPrompts]
  );
  const setAgentSystemPrompt = useCallback(
    (key: string, value: string | null) => {
      updateDraft({ agentSystemPrompts: { ...agentSystemPrompts, [key]: value } });
    },
    [agentSystemPrompts, updateDraft]
  );
  const selectedAgentIdsByMode = useMemo<Record<string, string[]>>(
    () => draft?.selectedAgentIds ?? {},
    [draft?.selectedAgentIds]
  );
  const setSelectedAgentsForMode = useCallback(
    (mode: HomeRunMode, ids: string[]) => {
      updateDraft({ selectedAgentIds: { ...selectedAgentIdsByMode, [mode]: ids } });
    },
    [selectedAgentIdsByMode, updateDraft]
  );
  const { agents: userAgents } = useAgents();
  const autoApproveDefaults = useAgentAutoApproveDefaults();
  const runModeSummary = useMemo(() => {
    const providerName = (id: AgentProviderId | null) =>
      id ? (getProvider(id)?.name ?? id) : null;
    const modelLabel = (model: string | null) =>
      model ? formatModelLabel(model) : t('home.modelDefault');

    if (runMode === 'compare') {
      return t('home.modeSummaryAgentCount', { count: compareProviders.length });
    }
    if (runMode === 'team') {
      const roleCount = Object.keys(teamProviders).length;
      return t('home.modeSummaryAgentCount', { count: roleCount });
    }

    // Single-provider modes (normal / brainstorm / review): provider · model.
    let provider = providerId;
    let model: string | null = null;
    if (runMode === 'normal') {
      const agent = userAgents.find((a) => a.id === (selectedAgentIdsByMode.normal ?? [])[0]);
      if (agent) {
        provider = agent.preferredRuntimeProvider ?? providerId;
        model = agent.model;
      }
    } else if (runMode === 'review') {
      provider = reviewerProvider;
    }

    const name = providerName(provider);
    if (!name) return null;
    return `${name} · ${modelLabel(model)}`;
  }, [
    runMode,
    providerId,
    compareProviders.length,
    teamProviders,
    reviewerProvider,
    userAgents,
    selectedAgentIdsByMode,
    t,
  ]);
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
      command: providerId ? applyAgentCommandPrefix(providerId, skill.id) : skill.id,
    }));
  }, [providerId, skillCatalog?.skills]);
  const skillIdByShortcutCommand = useMemo(
    () => new Map(skillShortcutOptions.map((skill) => [skill.command, skill.value])),
    [skillShortcutOptions]
  );

  const persistedPrompt = draft?.prompt ?? '';
  const [prompt, setPrompt] = useState(persistedPrompt);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
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
    !!providerId &&
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
  const modeHasAgents =
    runMode === 'compare'
      ? compareProviders.length >= MIN_COMPARE_AGENTS
      : runMode === 'review'
        ? !!providerId && !!reviewerProvider
        : runMode === 'team'
          ? TEAM_ROLES.every((role) => !!teamProviders[role.id])
          : !!providerId;
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
      const getSystemPrompt = (key: string, defaultPrompt: string) =>
        resolveAgentSystemPrompt(agentSystemPrompts, key, defaultPrompt);

      if (!mounted) {
        if (!providerId) return;
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
        const normalSystemPrompt = getSystemPrompt(NORMAL_PROMPT_KEY, '').trim();
        const initialPrompt =
          runMode === 'brainstorm'
            ? buildSpecPrompt({
                requirement: trimmed,
                systemPrompt: getSystemPrompt(SPEC_PROMPT_KEY, defaultSpecSystemPrompt()),
              })
            : normalSystemPrompt
              ? buildRequirementPrompt({ requirement: trimmed, systemPrompt: normalSystemPrompt })
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
              provider: providerId,
              title: initialConversationTitle(providerId, trimmed || undefined, []),
              initialPrompt,
              autoApprove: autoApproveDefaults.getDefault(providerId),
            },
          })
          .catch(() => {
            toast.error('Agent task failed to start.');
          });
        navigate('task', { projectId: INTERNAL_PROJECT_ID, taskId });
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
        provider: AgentProviderId;
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
            provider: args.provider,
            title: initialConversationTitle(
              args.provider,
              args.titlePrompt ?? args.initialPrompt,
              []
            ),
            initialPrompt: args.initialPrompt,
            autoApprove: autoApproveDefaults.getDefault(args.provider),
          },
        });
        return { taskId, taskName, conversationId, provider: args.provider, promise };
      };

      if (runMode === 'brainstorm') {
        if (!providerId) return;
        const task = createProjectTask({
          provider: providerId,
          nameSeed: `${baseName}-spec`,
          initialPrompt: buildSpecPrompt({
            requirement: trimmed,
            systemPrompt: getSystemPrompt(SPEC_PROMPT_KEY, defaultSpecSystemPrompt()),
          }),
          titlePrompt: trimmed || undefined,
          strategyKind: 'no-worktree',
        });
        navigate('task', { projectId: mounted.data.id, taskId: task.taskId });
        void task.promise.catch(() => {
          toast.error('Agent task failed to start.');
        });
        setPrompt('');
        updateDraft({ prompt: '' });
        return;
      }

      if (runMode === 'compare') {
        const launches = compareProviders.map((provider, index) =>
          createProjectTask({
            provider,
            nameSeed: `${baseName}-agent-${index + 1}-${provider}`,
            initialPrompt: buildRequirementPrompt({
              requirement: trimmed,
              systemPrompt: getSystemPrompt(
                comparePromptKey(index),
                defaultCompareSystemPrompt(index)
              ),
            }),
            titlePrompt: trimmed || undefined,
            strategyKind: 'new-branch',
          })
        );
        const first = launches[0];
        if (first) navigate('task', { projectId: mounted.data.id, taskId: first.taskId });
        void Promise.allSettled(launches.map((launch) => launch.promise)).then(reportFailures);
        setPrompt('');
        updateDraft({ prompt: '' });
        return;
      }

      if (runMode === 'review') {
        if (!providerId) return;
        const implementation = createProjectTask({
          provider: providerId,
          nameSeed: `${baseName}-implement`,
          initialPrompt: buildRequirementPrompt({
            requirement: trimmed,
            systemPrompt: getSystemPrompt(
              REVIEW_IMPLEMENTER_PROMPT_KEY,
              defaultReviewImplementerSystemPrompt()
            ),
          }),
          titlePrompt: trimmed || undefined,
          strategyKind: effectiveReviewStrategyKind,
        });
        navigate('task', { projectId: mounted.data.id, taskId: implementation.taskId });
        void runReviewOrchestration({
          projectId: mounted.data.id,
          taskId: implementation.taskId,
          implementationConversationId: implementation.conversationId,
          implementationReady: implementation.promise,
          requirement: trimmed,
          reviewerProvider,
          reviewerSystemPrompt: getSystemPrompt(
            REVIEW_REVIEWER_PROMPT_KEY,
            defaultReviewReviewerSystemPrompt()
          ),
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
        const ceo = createProjectTask({
          provider: teamProviders.ceo,
          nameSeed: `${baseName}-${ceoRole.taskSuffix}`,
          initialPrompt: buildTeamCeoPrompt({
            requirement: trimmed,
            systemPrompt: getSystemPrompt(
              teamPromptKey(ceoRole.id),
              defaultTeamSystemPrompt(ceoRole)
            ),
          }),
          titlePrompt: trimmed || undefined,
          strategyKind: 'new-branch',
        });
        navigate('task', { projectId: mounted.data.id, taskId: ceo.taskId });
        void (async () => {
          await ceo.promise;
          const ceoOutput = await waitForInitialConversationOutput(
            mounted.data.id,
            ceo.taskId,
            ceo.conversationId
          );
          const workerLaunches = TEAM_ROLES.filter((role) => role.id !== 'ceo').map((role) =>
            createProjectTask({
              provider: teamProviders[role.id],
              nameSeed: `${baseName}-${role.taskSuffix}`,
              initialPrompt: buildTeamRolePrompt({
                requirement: trimmed,
                ceoPlan: ceoOutput || '(The CEO agent did not produce captured output.)',
                systemPrompt: getSystemPrompt(
                  teamPromptKey(role.id),
                  defaultTeamSystemPrompt(role)
                ),
              }),
              titlePrompt: trimmed || undefined,
              strategyKind: 'new-branch',
            })
          );
          reportFailures(await Promise.allSettled(workerLaunches.map((launch) => launch.promise)));
        })().catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : 'Agent team orchestration failed.');
        });
        setPrompt('');
        updateDraft({ prompt: '' });
        return;
      }

      const normalAgent = userAgents.find((a) => a.id === (selectedAgentIdsByMode.normal ?? [])[0]);
      const normalProvider = normalAgent?.preferredRuntimeProvider ?? providerId;
      if (!normalProvider) return;
      const normalSystemPrompt = (
        normalAgent ? normalAgent.systemPrompt : getSystemPrompt(NORMAL_PROMPT_KEY, '')
      ).trim();
      const task = createProjectTask({
        provider: normalProvider,
        nameSeed: baseName,
        initialPrompt: normalSystemPrompt
          ? buildRequirementPrompt({ requirement: trimmed, systemPrompt: normalSystemPrompt })
          : trimmed || undefined,
        titlePrompt: trimmed || undefined,
        strategyKind: effectiveStandardStrategyKind,
      });
      navigate('task', { projectId: mounted.data.id, taskId: task.taskId });
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
    providerId,
    defaultBranch,
    effectiveReviewStrategyKind,
    effectiveStandardStrategyKind,
    trimmed,
    submitting,
    runMode,
    compareProviders,
    reviewerProvider,
    teamProviders,
    agentSystemPrompts,
    userAgents,
    selectedAgentIdsByMode,
    autoApproveDefaults,
    navigate,
    projectManager,
    updateDraft,
  ]);

  const commitPathCompletion = useCallback(
    (item: PathCompletionItem, mention: ActivePathMention | null = activePathMention) => {
      if (!mention) return;
      const next = applyPathCompletion(prompt, mention, item.insertText);
      setPrompt(next.value);
      setPromptSelection({ start: next.caret, end: next.caret });
      setPathCompletionOpen(item.type === 'dir');
      requestAnimationFrame(() => {
        const textarea = promptTextareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(next.caret, next.caret);
      });
    },
    [activePathMention, prompt]
  );

  const commitSkillShortcut = useCallback(
    (command: string, shortcut: ActiveSkillShortcut | null = null) => {
      const next = shortcut
        ? applySkillShortcut(prompt, shortcut, command)
        : insertPromptText(prompt, promptSelection, command);
      const skillId = skillIdByShortcutCommand.get(command);
      if (skillId) recordSkillInvocation(skillId);
      setPrompt(next.value);
      setPromptSelection({ start: next.caret, end: next.caret });
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
      requestAnimationFrame(() => {
        const textarea = promptTextareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(next.caret, next.caret);
      });
    },
    [prompt, promptSelection, skillIdByShortcutCommand]
  );

  const applyPromptMarkdownEdit = useCallback(
    (next: MarkdownTextareaEdit) => {
      setPrompt(next.value);
      setPromptSelection(next.selection);
      requestAnimationFrame(() => {
        const textarea = promptTextareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(next.selection.start, next.selection.end);
        updatePromptSelection(textarea);
      });
    },
    [updatePromptSelection]
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
        if (e.key === 'Enter' || e.key === 'Tab') {
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
        if ((e.key === 'Enter' || e.key === 'Tab') && pathCompletionItems.length > 0) {
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

      if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
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
                ? `${t(getGreetingKey(new Date().getHours()), { name: greetingName })} · `
                : ''}
              {t('home.headline')}
            </h1>
          </div>

          <div className="mx-auto w-full max-w-4xl">
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
                      providerId={providerId}
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
                      <ArrowUp
                        className={cn('size-4 transition-transform', canSubmit && 'scale-110')}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-2">
              <div className="overflow-x-auto pb-1">
                <div className="flex min-w-max flex-wrap items-center gap-2">
                  <RunModeSelector
                    mode={runMode}
                    summary={runModeSummary}
                    onChange={setRunMode}
                    renderConfiguration={(configurationMode) => (
                      <ModeConfigurationPanel
                        mode={configurationMode}
                        providerId={providerId}
                        onProviderChange={setProviderOverride}
                        compareProviders={compareProviders}
                        onCompareProviderChange={setCompareProvider}
                        onAddCompareProvider={addCompareProvider}
                        onRemoveCompareProvider={removeCompareProvider}
                        reviewerProvider={reviewerProvider}
                        onReviewerProviderChange={setReviewerProvider}
                        teamProviders={teamProviders}
                        onTeamProviderChange={setTeamProvider}
                        agentSystemPrompts={agentSystemPrompts}
                        onAgentSystemPromptChange={setAgentSystemPrompt}
                        selectedAgentIds={selectedAgentIdsByMode[configurationMode] ?? []}
                        onSelectedAgentsChange={(ids) =>
                          setSelectedAgentsForMode(configurationMode, ids)
                        }
                        multiAgent={configurationMode === 'team'}
                        connectionId={connectionId}
                        className="mt-2 border-t-0 pt-0"
                      />
                    )}
                  />
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
                  <TmuxChip />
                  {mounted && runMode === 'normal' && (
                    <StrategyChip
                      strategyKind={effectiveStandardStrategyKind}
                      disabled={isUnborn}
                      onChange={setStrategyKind}
                      ariaLabel={t('home.strategyAria')}
                      labels={strategyLabels}
                    />
                  )}
                  {runMode === 'brainstorm' && (
                    <Chip icon={Lightbulb}>{t('home.brainstormPolicy')}</Chip>
                  )}
                  {mounted && runMode === 'compare' && (
                    <Chip icon={GitFork}>
                      {t('home.compareBranchPolicy', { count: compareProviders.length })}
                    </Chip>
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
                  {mounted && runMode === 'team' && (
                    <Chip icon={GitFork}>{t('home.teamBranchPolicy')}</Chip>
                  )}
                </div>
              </div>
            </div>
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
  providerId: AgentProviderId | null;
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
  providerId,
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
  const disabled = !providerId || isLoading || isError || options.length === 0;

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
}

function RunModeSelector({ mode, summary, onChange, renderConfiguration }: RunModeSelectorProps) {
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

interface AgentCardPickerProps {
  selectedAgentIds: string[];
  onChange: (ids: string[]) => void;
  multi: boolean;
}

function AgentCardPicker({ selectedAgentIds, onChange, multi }: AgentCardPickerProps) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const { agents, isLoading } = useAgents();

  const toggle = (agent: Agent) => {
    if (multi) {
      onChange(
        selectedAgentIds.includes(agent.id)
          ? selectedAgentIds.filter((id) => id !== agent.id)
          : [...selectedAgentIds, agent.id]
      );
    } else {
      onChange(selectedAgentIds.includes(agent.id) ? [] : [agent.id]);
    }
  };

  if (isLoading) return null;

  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-foreground-muted">
          {multi ? t('home.pickAgents') : t('home.pickAgent')}
        </span>
        <button
          type="button"
          onClick={() => navigate('agentManager')}
          className="text-[11px] text-primary transition-colors hover:underline"
        >
          {t('home.manageAgents')}
        </button>
      </div>
      {agents.length === 0 ? (
        <button
          type="button"
          onClick={() => navigate('agentManager')}
          className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border bg-background-1 px-3 py-3 text-xs text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground"
        >
          <Plus className="size-3.5" />
          {t('home.noAgentsCreate')}
        </button>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {agents.map((agent) => {
            const selected = selectedAgentIds.includes(agent.id);
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => toggle(agent)}
                className={cn(
                  'flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors',
                  selected
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-background-1 hover:bg-background-2'
                )}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background-2 text-base">
                  {agent.icon || '🤖'}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className={cn(
                      'flex items-center gap-1.5 truncate text-sm font-medium',
                      selected ? 'text-primary' : 'text-foreground'
                    )}
                  >
                    <span className="truncate">{agent.name}</span>
                    {selected && <Check className="size-3.5 shrink-0" />}
                  </span>
                  <span className="line-clamp-1 text-xs text-foreground-muted">
                    {agent.description || t('agentManager.noDescriptionShort')}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ModeConfigurationPanelProps {
  mode: HomeRunMode;
  providerId: AgentProviderId | null;
  onProviderChange: (agent: AgentProviderId) => void;
  compareProviders: AgentProviderId[];
  onCompareProviderChange: (index: number, provider: AgentProviderId) => void;
  onAddCompareProvider: () => void;
  onRemoveCompareProvider: (index: number) => void;
  reviewerProvider: AgentProviderId;
  onReviewerProviderChange: (provider: AgentProviderId) => void;
  teamProviders: TeamProviderSelection;
  onTeamProviderChange: (roleId: TeamRoleId, provider: AgentProviderId) => void;
  agentSystemPrompts: AgentSystemPromptOverrides;
  onAgentSystemPromptChange: (key: string, prompt: string | null) => void;
  selectedAgentIds: string[];
  onSelectedAgentsChange: (ids: string[]) => void;
  multiAgent?: boolean;
  connectionId?: string;
  className?: string;
}

function ModeConfigurationPanel({
  mode,
  providerId,
  onProviderChange,
  compareProviders,
  onCompareProviderChange,
  onAddCompareProvider,
  onRemoveCompareProvider,
  reviewerProvider,
  onReviewerProviderChange,
  teamProviders,
  onTeamProviderChange,
  agentSystemPrompts,
  onAgentSystemPromptChange,
  selectedAgentIds,
  onSelectedAgentsChange,
  multiAgent = false,
  connectionId,
  className,
}: ModeConfigurationPanelProps) {
  const { t } = useTranslation();

  const getPromptProps = (key: string, defaultPrompt: string) => {
    const savedPrompt = agentSystemPrompts[key];
    return {
      systemPrompt: typeof savedPrompt === 'string' ? savedPrompt : defaultPrompt,
      hasCustomSystemPrompt: typeof savedPrompt === 'string',
      onSystemPromptChange: (next: string) => onAgentSystemPromptChange(key, next),
      onSystemPromptReset: () => onAgentSystemPromptChange(key, null),
    };
  };

  const supportsAgentCards = mode === 'normal' || mode === 'team';

  return (
    <div className={cn('mt-3 border-t border-border/60 pt-3', className)}>
      {supportsAgentCards && (
        <AgentCardPicker
          selectedAgentIds={selectedAgentIds}
          onChange={onSelectedAgentsChange}
          multi={multiAgent}
        />
      )}

      {mode === 'normal' && selectedAgentIds.length === 0 && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Agent
            icon={Bot}
            label={t('home.agentLabel')}
            value={providerId}
            onChange={onProviderChange}
            connectionId={connectionId}
            {...getPromptProps(NORMAL_PROMPT_KEY, '')}
          />
        </div>
      )}

      {mode === 'brainstorm' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Agent
            icon={Lightbulb}
            label={t('home.brainstormAgent')}
            value={providerId}
            onChange={onProviderChange}
            connectionId={connectionId}
            {...getPromptProps(SPEC_PROMPT_KEY, defaultSpecSystemPrompt())}
          />
          <div className="flex min-h-24 items-center rounded-lg border border-border/70 bg-background-1 p-3 text-xs leading-relaxed text-foreground-muted">
            {t('home.brainstormGuide')}
          </div>
        </div>
      )}

      {mode === 'compare' && (
        <div className="grid gap-2 sm:grid-cols-2">
          {compareProviders.map((agent, index) => (
            <Agent
              key={`${agent}-${index}`}
              icon={GitCompare}
              label={t('home.compareAgent', { index: index + 1 })}
              value={agent}
              onChange={(provider) => onCompareProviderChange(index, provider)}
              connectionId={connectionId}
              {...getPromptProps(comparePromptKey(index), defaultCompareSystemPrompt(index))}
              action={
                <button
                  type="button"
                  aria-label={t('home.removeCompareAgent')}
                  disabled={compareProviders.length <= MIN_COMPARE_AGENTS}
                  onClick={() => onRemoveCompareProvider(index)}
                  className="flex size-8 shrink-0 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <X className="size-3.5" />
                </button>
              }
            />
          ))}
          {compareProviders.length < MAX_COMPARE_AGENTS && (
            <button
              type="button"
              onClick={onAddCompareProvider}
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
            value={providerId}
            onChange={onProviderChange}
            connectionId={connectionId}
            {...getPromptProps(
              REVIEW_IMPLEMENTER_PROMPT_KEY,
              defaultReviewImplementerSystemPrompt()
            )}
          />
          <Agent
            icon={ShieldCheck}
            label={t('home.reviewReviewer')}
            value={reviewerProvider}
            onChange={onReviewerProviderChange}
            connectionId={connectionId}
            {...getPromptProps(REVIEW_REVIEWER_PROMPT_KEY, defaultReviewReviewerSystemPrompt())}
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
              value={teamProviders[role.id]}
              onChange={(provider) => onTeamProviderChange(role.id, provider)}
              connectionId={connectionId}
              {...getPromptProps(teamPromptKey(role.id), defaultTeamSystemPrompt(role))}
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
  value: AgentProviderId | null;
  onChange: (provider: AgentProviderId) => void;
  systemPrompt: string;
  hasCustomSystemPrompt: boolean;
  onSystemPromptChange: (prompt: string) => void;
  onSystemPromptReset: () => void;
  connectionId?: string;
  action?: ReactNode;
}

function Agent({
  icon: Icon,
  label,
  value,
  onChange,
  systemPrompt,
  hasCustomSystemPrompt,
  onSystemPromptChange,
  onSystemPromptReset,
  connectionId,
  action,
}: AgentProps) {
  const { t } = useTranslation();
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState(systemPrompt);
  const promptPreview = systemPrompt.trim() || t('home.agentSystemPromptEmpty');

  const handlePromptOpenChange = (open: boolean) => {
    setPromptOpen(open);
    if (open) setPromptDraft(systemPrompt);
  };

  const savePrompt = () => {
    onSystemPromptChange(promptDraft);
    setPromptOpen(false);
  };

  const resetPrompt = () => {
    onSystemPromptReset();
    setPromptOpen(false);
  };

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border/70 bg-background-1 p-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-background-2 text-foreground-muted">
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-wide text-foreground-muted">
          {label}
        </span>
        <span
          className={cn(
            'shrink-0 rounded-sm px-1.5 py-0.5 text-[10px]',
            hasCustomSystemPrompt
              ? 'bg-primary/10 text-primary'
              : 'bg-background-2 text-foreground-muted'
          )}
        >
          {hasCustomSystemPrompt
            ? t('home.agentSystemPromptCustom')
            : t('home.agentSystemPromptDefault')}
        </span>
        {action}
      </div>
      <AgentSelector
        value={value}
        onChange={onChange}
        connectionId={connectionId}
        className="h-9 text-sm"
      />
      <Popover open={promptOpen} onOpenChange={handlePromptOpenChange}>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label={t('home.agentSystemPromptAria', { label })}
              className="flex h-8 min-w-0 items-center gap-2 rounded-md bg-background-1 px-2 text-left text-xs text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground"
            >
              <FileText className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{promptPreview}</span>
              <PencilLine className="size-3.5 shrink-0" />
            </button>
          }
        />
        <PopoverContent
          align="start"
          className="max-h-(--available-height) w-96 max-w-[calc(100vw-2rem)] gap-3 overflow-y-auto overscroll-contain p-3"
        >
          <PopoverHeader>
            <PopoverTitle>{t('home.agentSystemPromptTitle', { label })}</PopoverTitle>
          </PopoverHeader>
          <Textarea
            value={promptDraft}
            onChange={(event) => setPromptDraft(event.target.value)}
            placeholder={t('home.agentSystemPromptPlaceholder')}
            className="h-64 max-h-[40dvh] min-h-48 resize-y overflow-y-auto rounded-md border border-border bg-background px-3 py-2 font-mono text-xs field-sizing-fixed leading-relaxed focus-visible:ring-1"
          />
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={resetPrompt}
              className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground"
            >
              <RotateCcw className="size-3.5" />
              <span>{t('home.agentSystemPromptReset')}</span>
            </button>
            <button
              type="button"
              onClick={savePrompt}
              className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Check className="size-3.5" />
              <span>{t('home.agentSystemPromptSave')}</span>
            </button>
          </div>
        </PopoverContent>
      </Popover>
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

function TmuxChip() {
  const { t } = useTranslation();
  const { value: project, update, isLoading, isSaving } = useAppSettingsKey('project');
  const enabled = project?.tmuxByDefault ?? true;

  return (
    <label
      title={t('settings.tasks.enableTmuxDescription')}
      className={cn(
        'flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background-1 px-2.5 text-xs text-foreground transition-colors hover:bg-background-2',
        (isLoading || isSaving) && 'cursor-not-allowed opacity-50'
      )}
    >
      <Terminal className="size-3.5 text-foreground-muted" />
      tmux
      <Switch
        size="sm"
        checked={enabled}
        disabled={isLoading || isSaving}
        onCheckedChange={(checked) => update({ tmuxByDefault: checked })}
        aria-label={t('settings.tasks.enableTmux')}
      />
    </label>
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
