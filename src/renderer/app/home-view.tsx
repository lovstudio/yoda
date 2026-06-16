import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Anchor,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  GitCompare,
  GitFork,
  Image as ImageIcon,
  Lightbulb,
  Loader2,
  Mic,
  Monitor,
  Paperclip,
  Plus,
  Repeat2,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type ComponentType,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import yodaLogoWhite from '@/assets/images/yoda/yoda_logo_white.svg';
import yodaLogo from '@/assets/images/yoda/yoda_logo.svg';
import { applyAgentCommandPrefix } from '@shared/agent-command-prefix';
import { BUILTIN_STARTUP_TEAM_ID, type AgentTeam } from '@shared/agent-team';
import type { Agent } from '@shared/agents';
import { BUILTIN_AGENT_KEYS } from '@shared/builtin-agents';
import type { ClaudeMemoryFile } from '@shared/conversations';
import type { Branch } from '@shared/git';
import type { ComposerDefaults, ProjectPromptPrinciples } from '@shared/project-settings';
import { INTERNAL_PROJECT_ID } from '@shared/projects';
import { withSystemPrompt } from '@shared/prompt-format';
import { REVIEW_MAX_ROUNDS } from '@shared/review-protocol';
import { getRuntime, RUNTIME_IDS, type RuntimeId } from '@shared/runtime-registry';
import type { CatalogIndex } from '@shared/skills/types';
import { ensureUniqueTaskDisplayName, taskNameFromPrompt } from '@shared/task-name';
import { useAgents } from '@renderer/features/agents-config/use-agents';
import {
  effectiveGlobalEnabled,
  setGlobalOverride,
  setProjectItems,
} from '@renderer/features/projects/project-prompt-principles';
import {
  asMounted,
  getProjectManagerStore,
  getProjectSettingsStore,
  getRepositoryStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { recordSkillInvocation } from '@renderer/features/skills/skill-usage-stats';
import { ContextItem, memoryFileLabel } from '@renderer/features/tasks/components/context-item';
import { initialConversationTitle } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { useEffectiveRuntime } from '@renderer/features/tasks/conversations/use-effective-runtime';
import { ProjectSelector } from '@renderer/features/tasks/create-task-modal/project-selector';
import { useRuntimeAutoApproveDefaults } from '@renderer/features/tasks/hooks/useRuntimeAutoApproveDefaults';
import { splitViewStore } from '@renderer/features/tasks/split-view/split-view-store';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { AgentSlotSelector } from '@renderer/lib/components/agent-slot/agent-slot-selector';
import { ProjectBranchSelector } from '@renderer/lib/components/project-branch-selector';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { toast } from '@renderer/lib/hooks/use-toast';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { rpc } from '@renderer/lib/ipc';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@renderer/lib/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { InfoTooltip } from '@renderer/lib/ui/info-tooltip';
import { MicroLabel } from '@renderer/lib/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { formatBytes } from '@renderer/utils/formatBytes';
import { isImeComposing } from '@renderer/utils/ime';
import { cn } from '@renderer/utils/utils';
import {
  dualField,
  withComposerDefault,
  type ComposerOverrideScope,
} from './composer-project-overrides';
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
import {
  fileTokenLabel,
  findTokenRanges,
  measureTokenRects,
  serializePromptWithTokens,
  snapSelectionToTokens,
  tokenAtPoint,
  tokenText,
  uniqueTokenLabel,
  type PromptToken,
  type PromptTokenKind,
  type TokenRect,
} from './prompt-attachment-tokens';

type TaskStrategyKind = 'new-branch' | 'no-worktree';
/** Strategy actually submitted to createTask — adds checkout-existing, which is
 *  derived (not forking + a non-current local branch picked), never persisted. */
type TaskSubmitStrategyKind = TaskStrategyKind | 'checkout-existing';
type HomeRunMode = 'normal' | 'brainstorm' | 'compare' | 'review' | 'team';
type RunHostKind = 'local' | 'ssh';
type SkillShortcutPrefix = '/' | '$';

type HomeComposerSubmitTarget =
  | { kind: 'new-task'; parentTask?: { projectId: string; taskId: string } }
  | { kind: 'existing-task'; projectId: string; taskId: string };

export type HomeComposerSubmitResult =
  | { kind: 'task'; projectId: string; taskId: string }
  | { kind: 'conversation'; projectId: string; taskId: string; conversationIds: string[] };

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
  containerClassName: string;
}

const MIN_COMPARE_AGENTS = 2;
const MAX_COMPARE_AGENTS = 6;
const DEFAULT_COMPARE_RUNTIMES: RuntimeId[] = ['claude', 'codex'];
const DEFAULT_REVIEWER_RUNTIME: RuntimeId = 'claude';

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
};

function defaultBuiltinKeyForSlot(slotKey: string): string | undefined {
  if (slotKey.startsWith('compare:')) return BUILTIN_AGENT_KEYS.general;
  return SLOT_DEFAULT_BUILTIN_KEY[slotKey];
}
const ADVANCED_INPUT_CONTAINER_CLASS =
  'border-border bg-background-1 ring-1 ring-sky-500/15 focus-within:border-sky-500/30 focus-within:ring-sky-500/25';

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

const IMAGE_ATTACHMENT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

function readFileAsBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
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
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
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
        containerClassName: ADVANCED_INPUT_CONTAINER_CLASS,
      };
    case 'compare':
      return {
        containerClassName: ADVANCED_INPUT_CONTAINER_CLASS,
      };
    case 'review':
      return {
        containerClassName: ADVANCED_INPUT_CONTAINER_CLASS,
      };
    case 'team':
      return {
        containerClassName: ADVANCED_INPUT_CONTAINER_CLASS,
      };
    case 'normal':
      return {
        containerClassName: 'border-border bg-background-1',
      };
  }

  const exhaustive: never = mode;
  return exhaustive;
}

function comparePromptKey(index: number): string {
  return `compare:${index}`;
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

/**
 * Home owns its full height when the sidebar is open — nav + toggle live in
 * the sidebar. When the sidebar is collapsed we fall back to the default
 * Titlebar so the toggle/back/forward buttons stay reachable.
 */
export const HomeTitlebar = observer(function HomeTitlebar() {
  const { isLeftOpen } = useWorkspaceLayoutContext();
  if (isLeftOpen) return null;
  return <Titlebar />;
});

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
    <div className="@container flex h-full flex-col overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-1 flex-col px-5 pb-8 pt-14 @2xl:px-8 @5xl:px-10">
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
 * The home prompt composer. By default it creates tasks; in task-scoped hosts
 * it reuses the same UI to create conversations inside the existing task.
 * Drafts persist to the shared `homeDraft` setting in both hosts.
 */
export const HomeComposer = observer(function HomeComposer({
  className,
  onSubmitted,
  submitTarget = { kind: 'new-task' },
}: {
  className?: string;
  /** Called after a successful submit. New-task mode navigates before firing it. */
  onSubmitted?: (result: HomeComposerSubmitResult) => void;
  submitTarget?: HomeComposerSubmitTarget;
}) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const taskScopedTarget = submitTarget.kind === 'existing-task' ? submitTarget : null;
  // Subtask mode: still creates tasks, but locked to the parent's project and
  // linked via parentTaskId; new branches fork off the parent's branch.
  const parentTarget = submitTarget.kind === 'new-task' ? (submitTarget.parentTask ?? null) : null;

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

  const isProjectLocked = !!(taskScopedTarget || parentTarget);
  const selectedProjectId =
    taskScopedTarget?.projectId ??
    parentTarget?.projectId ??
    homeProjectId ??
    navProjectId ??
    (draft === undefined ? undefined : (draft.selectedProjectId ?? undefined));
  const setSelectedProjectId = useCallback(
    (next: string | undefined) => {
      if (isProjectLocked) return;
      // The picked base branch belongs to the previous project — reset it.
      updateDraft({ selectedProjectId: next ?? null, baseBranch: null });
    },
    [isProjectLocked, updateDraft]
  );

  const draftProjectId = draft?.selectedProjectId ?? null;
  useEffect(() => {
    if (!homeProjectId || isProjectLocked) return;
    updateDraft(
      homeProjectId === draftProjectId
        ? { selectedProjectId: homeProjectId }
        : { selectedProjectId: homeProjectId, baseBranch: null }
    );
    setHomeParams({ projectId: undefined });
  }, [homeProjectId, setHomeParams, isProjectLocked, updateDraft, draftProjectId]);

  const projectStore = selectedProjectId
    ? projectManager.projects.get(selectedProjectId)
    : undefined;
  const mounted = asMounted(projectStore);
  const projectData = mounted?.data;
  const connectionId = projectData?.type === 'ssh' ? projectData.connectionId : undefined;
  const taskScopedTaskStore = taskScopedTarget
    ? getTaskStore(taskScopedTarget.projectId, taskScopedTarget.taskId)
    : undefined;
  const lockedProjectName = isProjectLocked
    ? (projectDisplayName(projectStore) ?? selectedProjectId)
    : undefined;

  // Project-level layer for composer settings. `composerDefaults` overrides the
  // user's global homeDraft per project (run config + attach mode); a present
  // field overrides, an absent field inherits. Same model + storage as
  // promptPrinciples — edited into project settings, shared via `.yoda.json`.
  const projectSettingsStore = selectedProjectId
    ? getProjectSettingsStore(selectedProjectId)
    : undefined;
  const projectSettings = projectSettingsStore?.settings ?? null;
  const hasProjectOverrideTarget = Boolean(selectedProjectId);
  const composerDefaults = projectSettings?.composerDefaults;
  const setComposerDefault = useCallback(
    <K extends keyof ComposerDefaults>(field: K, value: ComposerDefaults[K] | undefined) => {
      if (!projectSettingsStore || !projectSettings) return;
      void projectSettingsStore.save({
        ...projectSettings,
        composerDefaults: withComposerDefault(projectSettings.composerDefaults, field, value),
      });
    },
    [projectSettingsStore, projectSettings]
  );

  // Subtasks branch off the parent task's branch instead of the project default.
  const parentTaskStore = parentTarget
    ? getTaskStore(parentTarget.projectId, parentTarget.taskId)
    : undefined;
  const parentBranchName =
    asProvisioned(parentTaskStore)?.workspace.git.branchName ??
    (parentTaskStore && 'taskBranch' in parentTaskStore.data
      ? parentTaskStore.data.taskBranch
      : undefined);

  const repo = selectedProjectId ? getRepositoryStore(selectedProjectId) : undefined;
  const defaultBranch = repo?.defaultBranch;
  const isUnborn = repo?.isUnborn ?? false;

  // Base branch for forked tasks: the persisted pick, resolved against the
  // live branch list so a stale pick silently falls back to the default.
  const draftBaseBranch = draft?.baseBranch ?? null;
  const pickedBaseBranch = draftBaseBranch
    ? repo?.branches.find(
        (b) =>
          b.type === draftBaseBranch.type &&
          b.branch === draftBaseBranch.branch &&
          (b.type !== 'remote' || b.remote.name === draftBaseBranch.remoteName)
      )
    : undefined;
  const setBaseBranch = useCallback(
    (next: Branch) => {
      updateDraft({
        baseBranch: {
          type: next.type,
          branch: next.branch,
          ...(next.type === 'remote' ? { remoteName: next.remote.name } : {}),
        },
      });
    },
    [updateDraft]
  );
  // Subtasks always branch off the parent task's branch.
  const forkBaseBranch: Branch | undefined = useMemo(
    () =>
      parentBranchName
        ? { type: 'local', branch: parentBranchName }
        : (pickedBaseBranch ?? defaultBranch),
    [parentBranchName, pickedBaseBranch, defaultBranch]
  );
  const forkBaseLabel = forkBaseBranch
    ? forkBaseBranch.type === 'remote'
      ? `${forkBaseBranch.remote.name}/${forkBaseBranch.branch}`
      : forkBaseBranch.branch
    : 'main';
  // Not forking: picking the current checkout (or nothing) runs the task in
  // place (no-worktree); picking another existing local branch checks it out
  // in an isolated worktree (checkout-existing) — no new branch, and the
  // project directory is left untouched. Subtasks never re-target the pick.
  const currentBranchName = repo?.currentBranch;
  const inPlacePick =
    !parentBranchName &&
    pickedBaseBranch?.type === 'local' &&
    pickedBaseBranch.branch !== currentBranchName
      ? pickedBaseBranch
      : undefined;
  const inPlaceKind: 'no-worktree' | 'checkout-existing' = inPlacePick
    ? 'checkout-existing'
    : 'no-worktree';
  const inPlaceBranchLabel = inPlacePick?.branch ?? currentBranchName ?? forkBaseLabel;
  const inPlaceValue: Branch | undefined =
    inPlacePick ?? (currentBranchName ? { type: 'local', branch: currentBranchName } : undefined);
  const runHostKind: RunHostKind = projectData?.type === 'ssh' ? 'ssh' : 'local';
  const strategyLabels = useMemo(
    () => ({
      newBranchTitle: t('home.strategyNewBranchTitle', { branch: forkBaseLabel }),
      newBranchDesc: t('home.strategyNewBranchDesc', { branch: forkBaseLabel }),
      noWorktreeTitle:
        inPlaceKind === 'checkout-existing'
          ? t('home.strategyCheckoutExistingTitle', { branch: inPlaceBranchLabel })
          : t('home.strategyNoWorktreeTitle', { branch: inPlaceBranchLabel }),
      noWorktreeDesc:
        inPlaceKind === 'checkout-existing'
          ? t('home.strategyCheckoutExistingDesc', { branch: inPlaceBranchLabel })
          : t('home.strategyNoWorktreeDesc'),
    }),
    [forkBaseLabel, inPlaceBranchLabel, inPlaceKind, t]
  );
  const reviewStrategyLabels = useMemo(
    () => ({
      newBranchTitle: t('home.reviewStrategyNewBranchTitle', { branch: forkBaseLabel }),
      newBranchDesc: t('home.reviewStrategyNewBranchDesc', { branch: forkBaseLabel }),
      noWorktreeTitle:
        inPlaceKind === 'checkout-existing'
          ? t('home.strategyCheckoutExistingTitle', { branch: inPlaceBranchLabel })
          : t('home.reviewStrategySameBranchTitle', { branch: inPlaceBranchLabel }),
      noWorktreeDesc:
        inPlaceKind === 'checkout-existing'
          ? t('home.strategyCheckoutExistingDesc', { branch: inPlaceBranchLabel })
          : t('home.reviewStrategySameBranchDesc'),
    }),
    [forkBaseLabel, inPlaceBranchLabel, inPlaceKind, t]
  );

  // Run config below resolves project override ?? global homeDraft. A present
  // `composerDefaults` field means the chip edits the project layer; otherwise
  // it edits the user's global default. The scope pills live in the gear popover.
  const runtimeOverridden = composerDefaults?.runtimeId !== undefined;
  const providerOverrideValue = composerDefaults?.runtimeId ?? draft?.runtimeOverride ?? null;
  const setRuntimeOverridePersisted = useCallback(
    (id: RuntimeId | null) => {
      if (runtimeOverridden) setComposerDefault('runtimeId', id ?? undefined);
      else updateDraft({ runtimeOverride: id });
    },
    [runtimeOverridden, setComposerDefault, updateDraft]
  );
  const { runtimeId, setRuntimeOverride } = useEffectiveRuntime(connectionId, {
    value: providerOverrideValue,
    set: setRuntimeOverridePersisted,
  });
  const runModeOverridden = composerDefaults?.runMode !== undefined;
  const persistedRunMode: HomeRunMode = composerDefaults?.runMode ?? draft?.runMode ?? 'normal';
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
      if (runModeOverridden) setComposerDefault('runMode', next);
      else updateDraft({ runMode: next });
    },
    [runModeOverridden, setComposerDefault, updateDraft]
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
  // Agent Teams are reusable, project/task-decoupled templates surfaced as the
  // `team` paradigm (「多智能体（name）」). Built-ins + user teams come from the list.
  const { data: teams = [] } = useQuery({
    queryKey: ['agentTeams'],
    queryFn: () => rpc.agentTeams.list(),
  });
  const queryClient = useQueryClient();
  const selectedTeamId = draft?.selectedTeamId ?? BUILTIN_STARTUP_TEAM_ID;
  const setSelectedTeamId = useCallback(
    (next: string) => updateDraft({ selectedTeamId: next }),
    [updateDraft]
  );
  const activeTeam = useMemo<AgentTeam | undefined>(
    () =>
      teams.find((tm) => tm.id === selectedTeamId) ??
      teams.find((tm) => tm.id === BUILTIN_STARTUP_TEAM_ID) ??
      teams[0],
    [teams, selectedTeamId]
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
      return activeTeam?.name ?? null;
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
  }, [runMode, runtimeId, compareRuntimes.length, activeTeam, slotAgentId, userAgents, t]);
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
  // Attachments live inside the prompt as inline sentinel tokens (`@[图片1]`,
  // `@[report.pdf]`); this registry maps each label to its path/preview.
  const [promptTokens, setPromptTokens] = useState<PromptToken[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptTokensRef = useRef(promptTokens);
  promptTokensRef.current = promptTokens;
  // Object URLs survive React state; release them when the composer unmounts.
  useEffect(
    () => () => {
      for (const token of promptTokensRef.current) {
        if (token.previewUrl) URL.revokeObjectURL(token.previewUrl);
      }
    },
    []
  );
  const clearPromptTokens = useCallback(() => {
    setPromptTokens((prev) => {
      for (const token of prev) {
        if (token.previewUrl) URL.revokeObjectURL(token.previewUrl);
      }
      return [];
    });
  }, []);
  // NOTE: registrations are deliberately kept when their sentinel text is
  // deleted — undo (Cmd+Z) restores the text and the mapping must still hold.
  // Serialization only acts on sentinels present in the text; preview URLs
  // are revoked on submit/unmount.
  //
  // Current occurrences of registered tokens in the text, in document order.
  const tokenRanges = useMemo(() => findTokenRanges(prompt, promptTokens), [prompt, promptTokens]);
  const tokenRangesRef = useRef(tokenRanges);
  tokenRangesRef.current = tokenRanges;
  // Pixel rects of each token occurrence inside the textarea (mirror-measured)
  // — drives the pill highlights, hover preview, and right-click hit testing.
  const [tokenRects, setTokenRects] = useState<Map<string, TokenRect[]>>(new Map());
  const [promptScrollTop, setPromptScrollTop] = useState(0);
  const [hoveredTokenId, setHoveredTokenId] = useState<string | null>(null);
  const [tokenMenu, setTokenMenu] = useState<{
    tokenId: string;
    left: number;
    top: number;
  } | null>(null);
  // Layout effect (not rAF): the chip overlay is opaque and must be in place
  // before paint, or the raw sentinel text would flash through while typing.
  useLayoutEffect(() => {
    const textarea = promptTextareaRef.current;
    if (!textarea) return;
    setTokenRects(measureTokenRects(textarea, tokenRanges));
  }, [tokenRanges]);
  useEffect(() => {
    const textarea = promptTextareaRef.current;
    if (!textarea) return;
    const observer = new ResizeObserver(() => {
      setTokenRects(
        measureTokenRects(textarea, findTokenRanges(textarea.value, promptTokensRef.current))
      );
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, []);
  const hitTestToken = useCallback(
    (e: MouseEvent<HTMLTextAreaElement>): string | null => {
      const textarea = e.currentTarget;
      const rect = textarea.getBoundingClientRect();
      return tokenAtPoint(
        tokenRects,
        e.clientX - rect.left,
        e.clientY - rect.top + textarea.scrollTop
      );
    },
    [tokenRects]
  );
  const handlePromptMouseMove = useCallback(
    (e: MouseEvent<HTMLTextAreaElement>) => {
      setHoveredTokenId(hitTestToken(e));
    },
    [hitTestToken]
  );
  const handlePromptContextMenu = useCallback(
    (e: MouseEvent<HTMLTextAreaElement>) => {
      const tokenId = hitTestToken(e);
      if (!tokenId) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      setTokenMenu({ tokenId, left: e.clientX - rect.left, top: e.clientY - rect.top });
    },
    [hitTestToken]
  );
  const handlePromptMouseDown = useCallback(
    (e: MouseEvent<HTMLTextAreaElement>) => {
      // Suppress double-click word-selection on a token — the native selection
      // would paint over the chip (ghosting); the gesture means "open".
      if (e.detail > 1 && hitTestToken(e)) e.preventDefault();
    },
    [hitTestToken]
  );
  const handlePromptDoubleClick = useCallback(
    (e: MouseEvent<HTMLTextAreaElement>) => {
      const tokenId = hitTestToken(e);
      if (!tokenId) return;
      const token = promptTokensRef.current.find((item) => item.id === tokenId);
      if (!token) return;
      e.preventDefault();
      void rpc.app.openIn({ app: 'finder', path: token.path }).catch(() => {});
    },
    [hitTestToken]
  );
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
    const raw = { start: target.selectionStart, end: target.selectionEnd };
    // Tokens are atomic: the caret may not land inside one, and a range
    // selection swallows overlapped tokens whole.
    const next = snapSelectionToTokens(
      raw,
      tokenRangesRef.current,
      promptSelectionRef.current.start
    );
    if (next.start !== raw.start || next.end !== raw.end) {
      target.setSelectionRange(next.start, next.end);
    }
    promptSelectionRef.current = next;
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
    // Re-link the attachment-token registry persisted with the draft — the
    // composer remounts on every navigation and the sentinels in the restored
    // prompt would otherwise be orphaned plain text. Image hover previews
    // (object URLs) don't survive the remount; paths and chips do.
    setPromptTokens(
      (draft.promptTokens ?? []).map((token) => ({ ...token, id: crypto.randomUUID() }))
    );
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
  const standardStrategyOverridden = composerDefaults?.standardStrategyKind !== undefined;
  const strategyKind: TaskStrategyKind =
    composerDefaults?.standardStrategyKind ?? draft?.strategyKind ?? 'new-branch';
  const setStrategyKind = useCallback(
    (next: TaskStrategyKind) => {
      if (standardStrategyOverridden) setComposerDefault('standardStrategyKind', next);
      else updateDraft({ strategyKind: next });
    },
    [standardStrategyOverridden, setComposerDefault, updateDraft]
  );
  const reviewStrategyOverridden = composerDefaults?.reviewStrategyKind !== undefined;
  const reviewStrategyKind: TaskStrategyKind =
    composerDefaults?.reviewStrategyKind ?? draft?.reviewStrategyKind ?? 'no-worktree';
  const setReviewStrategyKind = useCallback(
    (next: TaskStrategyKind) => {
      if (reviewStrategyOverridden) setComposerDefault('reviewStrategyKind', next);
      else updateDraft({ reviewStrategyKind: next });
    },
    [reviewStrategyOverridden, setComposerDefault, updateDraft]
  );
  const effectiveStandardStrategyKind: TaskStrategyKind = isUnborn ? 'no-worktree' : strategyKind;
  const effectiveReviewStrategyKind: TaskStrategyKind = isUnborn
    ? 'no-worktree'
    : reviewStrategyKind;
  // What actually gets submitted: the fork switch picks new-branch, otherwise
  // the in-place pick decides between running in place and checking out an
  // existing branch in a worktree.
  const standardSubmitKind: TaskSubmitStrategyKind =
    effectiveStandardStrategyKind === 'new-branch' ? 'new-branch' : inPlaceKind;
  const reviewSubmitKind: TaskSubmitStrategyKind =
    effectiveReviewStrategyKind === 'new-branch' ? 'new-branch' : inPlaceKind;
  const targetProvisionedTask = asProvisioned(taskScopedTaskStore);
  const setAttachImagesAsPathsGlobal = useCallback(
    (next: boolean) => {
      updateDraft({ attachImagesAsPaths: next });
    },
    [updateDraft]
  );
  const { value: promptPrinciplesValue, update: updatePromptPrinciples } =
    useAppSettingsKey('promptPrinciples');
  const promptPrinciples = promptPrinciplesValue?.items ?? [];
  const setPromptPrincipleEnabled = useCallback(
    (id: string, enabled: boolean) => {
      const items = promptPrinciplesValue?.items ?? [];
      updatePromptPrinciples({
        items: items.map((item) => (item.id === id ? { ...item, enabled } : item)),
      });
    },
    [promptPrinciplesValue, updatePromptPrinciples]
  );
  // When a project is selected, prompt-principle toggles operate on the
  // project's layer (override globals + its own items) stored in project
  // settings; with no project they edit the global defaults above.
  const projectPromptPrinciples = projectSettings?.promptPrinciples;
  const projectPrincipleItems = projectPromptPrinciples?.items ?? [];
  const saveProjectPromptPrinciples = useCallback(
    (next: ProjectPromptPrinciples | undefined) => {
      if (!projectSettingsStore || !projectSettings) return;
      void projectSettingsStore.save({ ...projectSettings, promptPrinciples: next });
    },
    [projectSettingsStore, projectSettings]
  );
  const attachImagesField = dualField<boolean>({
    override: composerDefaults?.attachImagesAsPaths,
    globalValue: draft?.attachImagesAsPaths ?? false,
    setGlobal: setAttachImagesAsPathsGlobal,
    setOverride: (value) => setComposerDefault('attachImagesAsPaths', value),
    hasProject: hasProjectOverrideTarget,
  });
  const attachImagesAsPaths = attachImagesField.value;
  const setGlobalPrincipleProjectOverride = useCallback(
    (principle: { id: string; enabled: boolean }, enabled: boolean) => {
      saveProjectPromptPrinciples(setGlobalOverride(projectPromptPrinciples, principle, enabled));
    },
    [projectPromptPrinciples, saveProjectPromptPrinciples]
  );
  const setProjectPrincipleEnabled = useCallback(
    (id: string, enabled: boolean) => {
      const items = projectPromptPrinciples?.items ?? [];
      saveProjectPromptPrinciples(
        setProjectItems(
          projectPromptPrinciples,
          items.map((item) => (item.id === id ? { ...item, enabled } : item))
        )
      );
    },
    [projectPromptPrinciples, saveProjectPromptPrinciples]
  );
  const modeCanRunWithoutProject = runMode === 'normal' || runMode === 'brainstorm';
  const modeRequiresWorktree =
    !taskScopedTarget &&
    (runMode === 'compare' ||
      runMode === 'team' ||
      (runMode === 'review' && effectiveReviewStrategyKind === 'new-branch'));
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
          ? Boolean(activeTeam && activeTeam.members.length > 0)
          : runMode === 'brainstorm'
            ? hasSlotAgent(SPEC_PROMPT_KEY)
            : hasSlotAgent(NORMAL_PROMPT_KEY);
  // A worktree-requiring mode on a repo without a base commit can't fork until
  // one exists. This covers both an unborn repo (git init, no commit) and a
  // plain folder that was never `git init`-ed — both surface as `isUnborn` with
  // no resolvable `defaultBranch`. Rather than dead-disabling the button, route
  // submit through a modal that seeds the first commit (creating the repo if
  // needed), then proceeds.
  const needsInitialCommit = !!mounted && modeRequiresWorktree && isUnborn && !!selectedProjectId;
  const canSubmit =
    !submitting &&
    modeHasAgents &&
    (taskScopedTarget
      ? !!targetProvisionedTask
      : modeCanRunWithoutProject
        ? !mounted || !!defaultBranch
        : !!mounted && (needsInitialCommit || !!defaultBranch));

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      // Every successful new-task submit lands on the new task; modal hosts close on it.
      const goToTask = (projectId: string, taskId: string) => {
        navigate('task', { projectId, taskId });
        onSubmitted?.({ kind: 'task', projectId, taskId });
      };
      // Attachment transport: inline sentinel tokens are replaced in place —
      // file tokens (and image tokens when the user prefers paths) become
      // @path mentions; remaining image tokens become {{yoda-image:N}} markers
      // the main process expands per runtime (native clipboard paste for TUIs
      // that support it, @path substitution for the rest). Ordering always
      // follows the text.
      const serialized = serializePromptWithTokens(trimmed, promptTokens, {
        imagesAsPaths: attachImagesAsPaths,
      });
      const requirement = serialized.text;
      const imagePaths = serialized.imagePaths.length > 0 ? serialized.imagePaths : undefined;
      const resetComposer = () => {
        setPrompt('');
        updateDraft({ prompt: '', promptTokens: [] });
        clearPromptTokens();
      };
      const reportFailures = (results: PromiseSettledResult<unknown>[]) => {
        const failures = results.filter((result) => result.status === 'rejected');
        if (failures.length > 0) {
          const targetName = taskScopedTarget ? 'conversation' : 'task';
          toast.error(
            failures.length === 1
              ? `One agent ${targetName} failed to start.`
              : `${failures.length} agent ${targetName}s failed to start.`
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

      if (taskScopedTarget) {
        if (!targetProvisionedTask) return;
        const conversationTitleInputs = Array.from(
          targetProvisionedTask.conversations.conversations.values(),
          (conversation) => ({
            runtimeId: conversation.data.runtimeId,
            title: conversation.data.title,
          })
        );
        const createdConversationIds: string[] = [];
        const createTaskConversation = (args: {
          provider: RuntimeId;
          initialPrompt: string | undefined;
          titlePrompt?: string;
        }) => {
          const conversationId = crypto.randomUUID();
          const title = initialConversationTitle(
            args.provider,
            args.titlePrompt ?? args.initialPrompt,
            conversationTitleInputs
          );
          conversationTitleInputs.push({ runtimeId: args.provider, title });
          createdConversationIds.push(conversationId);
          const promise = targetProvisionedTask.conversations.createConversation({
            id: conversationId,
            projectId: taskScopedTarget.projectId,
            taskId: taskScopedTarget.taskId,
            runtime: args.provider,
            title,
            initialPrompt: args.initialPrompt,
            imagePaths,
            autoApprove: autoApproveDefaults.getDefault(args.provider),
          });
          return { conversationId, runtime: args.provider, promise };
        };
        const finishTaskConversationSubmit = () => {
          void getTaskStore(taskScopedTarget.projectId, taskScopedTarget.taskId)?.setNeedsReview(
            false
          );
          onSubmitted?.({
            kind: 'conversation',
            projectId: taskScopedTarget.projectId,
            taskId: taskScopedTarget.taskId,
            conversationIds: createdConversationIds,
          });
          resetComposer();
        };

        if (runMode === 'brainstorm') {
          const slot = resolveSlot(SPEC_PROMPT_KEY, runtimeId);
          if (!slot.provider) return;
          const launch = createTaskConversation({
            provider: slot.provider,
            initialPrompt: buildSpecPrompt({
              requirement,
              systemPrompt: slot.systemPrompt,
            }),
            titlePrompt: trimmed || undefined,
          });
          finishTaskConversationSubmit();
          void launch.promise.catch(() => {
            toast.error('Agent conversation failed to start.');
          });
          return;
        }

        if (runMode === 'compare') {
          // Compare modifies files, so candidates must NOT share a worktree.
          // Spin off one isolated child task per candidate (forked from this
          // task's branch) instead of conversations that would clobber each
          // other in the shared worktree.
          if (!mounted) return;
          const baseBranch =
            targetProvisionedTask.workspace.git.branchName ??
            (taskScopedTaskStore && 'taskBranch' in taskScopedTaskStore.data
              ? taskScopedTaskStore.data.taskBranch
              : undefined);
          const sourceBranch = baseBranch
            ? ({ type: 'local' as const, branch: baseBranch } as const)
            : defaultBranch;
          if (!sourceBranch) return;
          const compareProjectId = mounted.data.id;
          const compareBaseName = trimmed
            ? taskNameFromPrompt(trimmed)
            : await rpc.tasks.generateTaskName({});
          const reservedNames = Array.from(
            mounted.taskManager.tasks.values(),
            (task) => task.data.name
          );
          const launches = compareRuntimes.flatMap((provider, index) => {
            const slot = resolveSlot(comparePromptKey(index), provider);
            if (!slot.provider) return [];
            const taskName = ensureUniqueTaskDisplayName(
              `${compareBaseName}-agent-${index + 1}-${slot.provider}`,
              reservedNames
            );
            reservedNames.push(taskName);
            const taskId = crypto.randomUUID();
            const conversationId = crypto.randomUUID();
            const promise = mounted.taskManager.createTask({
              id: taskId,
              projectId: compareProjectId,
              name: taskName,
              sourceBranch,
              strategy: { kind: 'new-branch', taskBranch: taskName, pushBranch: false },
              parentTaskId: taskScopedTarget.taskId,
              initialConversation: {
                id: conversationId,
                projectId: compareProjectId,
                taskId,
                runtime: slot.provider,
                title: initialConversationTitle(slot.provider, trimmed || undefined, []),
                initialPrompt: buildRequirementPrompt({
                  requirement,
                  systemPrompt: slot.systemPrompt,
                }),
                imagePaths,
                autoApprove: autoApproveDefaults.getDefault(slot.provider),
              },
            });
            return [{ taskId, promise }];
          });
          if (launches.length === 0) return;
          const first = launches[0];
          resetComposer();
          if (first) goToTask(compareProjectId, first.taskId);
          // Tile every candidate side by side; the grid de-dupes the routed primary.
          splitViewStore.replace(
            launches.map((launch) => ({ projectId: compareProjectId, taskId: launch.taskId }))
          );
          void Promise.allSettled(launches.map((launch) => launch.promise)).then(reportFailures);
          return;
        }

        if (runMode === 'review') {
          const implementerSlot = resolveSlot(REVIEW_IMPLEMENTER_PROMPT_KEY, runtimeId);
          const reviewerSlot = resolveSlot(REVIEW_REVIEWER_PROMPT_KEY, reviewerRuntime);
          if (!implementerSlot.provider || !reviewerSlot.provider) return;
          const implementation = createTaskConversation({
            provider: implementerSlot.provider,
            initialPrompt: buildRequirementPrompt({
              requirement,
              systemPrompt: implementerSlot.systemPrompt,
            }),
            titlePrompt: trimmed || undefined,
          });
          finishTaskConversationSubmit();
          const reviewerProvider = reviewerSlot.provider;
          const reviewerSystemPrompt = reviewerSlot.systemPrompt;
          void implementation.promise
            .then(() =>
              rpc.reviewOrchestration.start({
                projectId: taskScopedTarget.projectId,
                taskId: taskScopedTarget.taskId,
                implementerConversationId: implementation.conversationId,
                requirement,
                reviewerRuntime: reviewerProvider,
                reviewerSystemPrompt,
                reviewerAutoApprove: autoApproveDefaults.getDefault(reviewerProvider),
              })
            )
            .catch((error: unknown) => {
              toast.error(
                error instanceof Error ? error.message : 'Review mode orchestration failed.'
              );
            });
          return;
        }

        if (runMode === 'team') {
          if (!activeTeam) return;
          // Instantiate a chat room from the team template on this task; the
          // conductor drives the iterative @-routing (members appear as the
          // task's conversations).
          void rpc.teamRooms
            .createRoomFromTeam({
              projectId: taskScopedTarget.projectId,
              taskId: taskScopedTarget.taskId,
              teamId: activeTeam.id,
              requirement,
            })
            .then(() =>
              queryClient.invalidateQueries({
                queryKey: ['roomForTask', taskScopedTarget.projectId, taskScopedTarget.taskId],
              })
            )
            .catch((error: unknown) => {
              toast.error(
                error instanceof Error ? error.message : 'Agent team orchestration failed.'
              );
            });
          finishTaskConversationSubmit();
          return;
        }

        const normalSlot = resolveSlot(NORMAL_PROMPT_KEY, runtimeId);
        if (!normalSlot.provider) return;
        const normalSystemPrompt = normalSlot.systemPrompt.trim();
        const launch = createTaskConversation({
          provider: normalSlot.provider,
          initialPrompt: normalSystemPrompt
            ? buildRequirementPrompt({ requirement, systemPrompt: normalSystemPrompt })
            : requirement || undefined,
          titlePrompt: trimmed || undefined,
        });
        finishTaskConversationSubmit();
        void launch.promise.catch(() => {
          toast.error('Agent conversation failed to start.');
        });
        return;
      }

      const promptDisplayName = trimmed ? taskNameFromPrompt(trimmed) : '';
      const baseName =
        promptDisplayName || (await rpc.tasks.generateTaskName(trimmed ? { title: trimmed } : {}));

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
            ? buildSpecPrompt({ requirement, systemPrompt: draftSlot.systemPrompt })
            : draftSystemPrompt
              ? buildRequirementPrompt({ requirement, systemPrompt: draftSystemPrompt })
              : requirement || undefined;
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
              imagePaths,
              autoApprove: autoApproveDefaults.getDefault(draftRuntime),
            },
          })
          .catch(() => {
            toast.error('Agent task failed to start.');
          });
        goToTask(INTERNAL_PROJECT_ID, taskId);
        resetComposer();
        return;
      }

      // `defaultBranch` is derived from the repository store, which is stale
      // right after the initial-commit modal seeds a brand-new repo (git init +
      // first commit emit a ref change the store hasn't applied yet). Resolve
      // the fork base from a fresh read so worktree modes get a valid source
      // branch instead of silently bailing here.
      let baseDefaultBranch = defaultBranch;
      if (!baseDefaultBranch) {
        const local = await rpc.repository.getLocalBranches(mounted.data.id);
        if (local.currentBranch) {
          baseDefaultBranch = { type: 'local', branch: local.currentBranch };
        }
      }
      if (!baseDefaultBranch) return;

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
        strategyKind: TaskSubmitStrategyKind;
        parentTaskId?: string;
      }) => {
        const taskId = crypto.randomUUID();
        const conversationId = crypto.randomUUID();
        const taskName = reserveTaskName(args.nameSeed);
        const strategy =
          args.strategyKind === 'no-worktree'
            ? ({ kind: 'no-worktree' } as const)
            : args.strategyKind === 'checkout-existing'
              ? ({ kind: 'checkout-existing' } as const)
              : ({ kind: 'new-branch', taskBranch: taskName, pushBranch: false } as const);
        const promise = mounted.taskManager.createTask({
          id: taskId,
          projectId: mounted.data.id,
          name: taskName,
          sourceBranch:
            args.strategyKind === 'new-branch'
              ? (forkBaseBranch ?? baseDefaultBranch)
              : args.strategyKind === 'checkout-existing'
                ? (inPlacePick ?? baseDefaultBranch)
                : parentBranchName
                  ? { type: 'local', branch: parentBranchName }
                  : baseDefaultBranch,
          strategy,
          parentTaskId: args.parentTaskId ?? parentTarget?.taskId,
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
            imagePaths,
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
            requirement,
            systemPrompt: slot.systemPrompt,
          }),
          titlePrompt: trimmed || undefined,
          strategyKind: 'no-worktree',
        });
        goToTask(mounted.data.id, task.taskId);
        void task.promise.catch(() => {
          toast.error('Agent task failed to start.');
        });
        resetComposer();
        return;
      }

      if (runMode === 'compare') {
        // Each candidate forks off the same base into its own isolated worktree.
        // A dedicated session-less parent task groups them so the alternatives
        // render together in the subtask tree; no candidate doubles as the anchor.
        const parentTaskId = crypto.randomUUID();
        const parentPromise = mounted.taskManager.createTask({
          id: parentTaskId,
          projectId: mounted.data.id,
          name: reserveTaskName(`${baseName}-compare`),
          sourceBranch: forkBaseBranch ?? baseDefaultBranch,
          strategy: { kind: 'no-worktree' },
          parentTaskId: parentTarget?.taskId,
        });
        const launches = compareRuntimes.flatMap((provider, index) => {
          const slot = resolveSlot(comparePromptKey(index), provider);
          if (!slot.provider) return [];
          const launch = createProjectTask({
            provider: slot.provider,
            nameSeed: `${baseName}-agent-${index + 1}-${slot.provider}`,
            initialPrompt: buildRequirementPrompt({
              requirement,
              systemPrompt: slot.systemPrompt,
            }),
            titlePrompt: trimmed || undefined,
            strategyKind: 'new-branch',
            parentTaskId,
          });
          return [launch];
        });
        if (launches.length === 0) return;
        const first = launches[0];
        if (first) goToTask(mounted.data.id, first.taskId);
        // Tile every candidate side by side; the grid de-dupes the routed primary.
        splitViewStore.replace(
          launches.map((launch) => ({ projectId: mounted.data.id, taskId: launch.taskId }))
        );
        void Promise.allSettled([parentPromise, ...launches.map((l) => l.promise)]).then(
          reportFailures
        );
        resetComposer();
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
            requirement,
            systemPrompt: implementerSlot.systemPrompt,
          }),
          titlePrompt: trimmed || undefined,
          strategyKind: reviewSubmitKind,
        });
        goToTask(mounted.data.id, implementation.taskId);
        const reviewerProvider = reviewerSlot.provider;
        const reviewerSystemPrompt = reviewerSlot.systemPrompt;
        void implementation.promise
          .then(() =>
            rpc.reviewOrchestration.start({
              projectId: mounted.data.id,
              taskId: implementation.taskId,
              implementerConversationId: implementation.conversationId,
              requirement,
              reviewerRuntime: reviewerProvider,
              reviewerSystemPrompt,
              reviewerAutoApprove: autoApproveDefaults.getDefault(reviewerProvider),
            })
          )
          .catch((error: unknown) => {
            toast.error(
              error instanceof Error ? error.message : 'Review mode orchestration failed.'
            );
          });
        resetComposer();
        return;
      }

      if (runMode === 'team') {
        if (!activeTeam) return;
        const teamId = activeTeam.id;
        const teamRequirement = requirement;
        // Bare task (no initial conversation) — the room conductor instantiates
        // the team and populates the task's conversations via iterative @-routing.
        const taskId = crypto.randomUUID();
        const taskName = reserveTaskName(baseName);
        const createPromise = mounted.taskManager.createTask({
          id: taskId,
          projectId: mounted.data.id,
          name: taskName,
          sourceBranch: forkBaseBranch ?? baseDefaultBranch,
          strategy: { kind: 'new-branch', taskBranch: taskName, pushBranch: false },
          parentTaskId: parentTarget?.taskId,
        });
        goToTask(mounted.data.id, taskId);
        void createPromise
          .then(() =>
            rpc.teamRooms.createRoomFromTeam({
              projectId: mounted.data.id,
              taskId,
              teamId,
              requirement: teamRequirement,
            })
          )
          .then(() =>
            queryClient.invalidateQueries({
              queryKey: ['roomForTask', mounted.data.id, taskId],
            })
          )
          .catch((error: unknown) => {
            toast.error(
              error instanceof Error ? error.message : 'Agent team orchestration failed.'
            );
          });
        resetComposer();
        return;
      }

      const normalSlot = resolveSlot(NORMAL_PROMPT_KEY, runtimeId);
      if (!normalSlot.provider) return;
      const normalSystemPrompt = normalSlot.systemPrompt.trim();
      const task = createProjectTask({
        provider: normalSlot.provider,
        nameSeed: baseName,
        initialPrompt: normalSystemPrompt
          ? buildRequirementPrompt({ requirement, systemPrompt: normalSystemPrompt })
          : requirement || undefined,
        titlePrompt: trimmed || undefined,
        strategyKind: standardSubmitKind,
      });
      goToTask(mounted.data.id, task.taskId);
      void task.promise.catch(() => {
        toast.error('Agent task failed to start.');
      });
      resetComposer();
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit,
    mounted,
    taskScopedTarget,
    taskScopedTaskStore,
    parentTarget,
    parentBranchName,
    targetProvisionedTask,
    runtimeId,
    defaultBranch,
    forkBaseBranch,
    inPlacePick,
    promptTokens,
    attachImagesAsPaths,
    clearPromptTokens,
    reviewSubmitKind,
    standardSubmitKind,
    trimmed,
    submitting,
    runMode,
    compareRuntimes,
    reviewerRuntime,
    activeTeam,
    queryClient,
    userAgents,
    slotAgentId,
    autoApproveDefaults,
    navigate,
    onSubmitted,
    projectManager,
    updateDraft,
  ]);

  const showInitialCommitModal = useShowModal('initialCommitModal');
  // Single entry point for both the send button and Enter-to-submit. When a
  // worktree mode needs a base commit first, divert to the modal and resume on
  // confirm; otherwise submit straight through.
  const submit = useCallback(() => {
    if (!canSubmit) return;
    if (needsInitialCommit && selectedProjectId) {
      showInitialCommitModal({
        projectId: selectedProjectId,
        reason: t('initialCommit.reasonWorktreeMode'),
        onSuccess: () => void handleSubmit(),
      });
      return;
    }
    void handleSubmit();
  }, [canSubmit, needsInitialCommit, selectedProjectId, showInitialCommitModal, handleSubmit, t]);

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

  // Inserts text at the caret. Reads the live textarea value (not the
  // `prompt` closure) so async insertions (pasted screenshots after the
  // temp-file roundtrip) and batched sequential inserts always land in the
  // current text.
  const insertPromptSnippet = useCallback(
    (snippet: string) => {
      const textarea = promptTextareaRef.current;
      const value = textarea ? textarea.value : prompt;
      const selection = textarea
        ? { start: textarea.selectionStart, end: textarea.selectionEnd }
        : promptSelectionRef.current;
      const next = insertPromptText(value, selection, snippet);
      applyPromptEdit(next.value, { start: next.caret, end: next.caret });
    },
    [applyPromptEdit, prompt]
  );

  // Registers an attachment and inserts its inline sentinel at the caret.
  const insertAttachmentToken = useCallback(
    (kind: PromptTokenKind, path: string, name: string, previewUrl?: string) => {
      const existing = promptTokensRef.current;
      const base =
        kind === 'image'
          ? t('home.imageTokenLabel', {
              index: existing.filter((token) => token.kind === 'image').length + 1,
            })
          : fileTokenLabel(name);
      const label = uniqueTokenLabel(base, existing);
      const next = [...existing, { id: crypto.randomUUID(), kind, label, path, previewUrl }];
      setPromptTokens(next);
      updateDraft({
        promptTokens: next.map((token) => ({
          kind: token.kind,
          label: token.label,
          path: token.path,
        })),
      });
      insertPromptSnippet(tokenText(label));
    },
    [insertPromptSnippet, t, updateDraft]
  );

  // Deletes a token's sentinel from the text; the orphan-GC effect then drops
  // its registration and revokes the preview URL.
  const removeTokenFromPrompt = useCallback(
    (token: PromptToken) => {
      const textarea = promptTextareaRef.current;
      const value = textarea ? textarea.value : prompt;
      const next = value.split(tokenText(token.label)).join('');
      const caret = Math.min(
        textarea ? textarea.selectionStart : promptSelectionRef.current.start,
        next.length
      );
      applyPromptEdit(next, { start: caret, end: caret });
    },
    [applyPromptEdit, prompt]
  );

  const attachFiles = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const filePath = window.electronAPI.getPathForFile(file).trim();
        if (!filePath) continue;
        if (file.type.startsWith('image/') || IMAGE_ATTACHMENT_RE.test(filePath)) {
          insertAttachmentToken('image', filePath, file.name, URL.createObjectURL(file));
        } else {
          insertAttachmentToken('file', filePath, file.name);
        }
      }
    },
    [insertAttachmentToken]
  );

  const handlePromptPaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const imageFiles = Array.from(e.clipboardData.files).filter((file) =>
        file.type.startsWith('image/')
      );
      if (imageFiles.length === 0) return;
      e.preventDefault();
      for (const file of imageFiles) {
        // A file copied from the OS keeps its path; a raw screenshot doesn't,
        // so its bytes get persisted to a temp file in the main process.
        const existingPath = window.electronAPI.getPathForFile(file).trim();
        if (existingPath) {
          insertAttachmentToken('image', existingPath, file.name, URL.createObjectURL(file));
          continue;
        }
        const previewUrl = URL.createObjectURL(file);
        void (async () => {
          try {
            const base64 = await readFileAsBase64(file);
            const result = await rpc.fs.saveClipboardImage(base64, file.type);
            if (!result.success || !result.data) throw new Error('saveClipboardImage failed');
            insertAttachmentToken(
              'image',
              result.data.absPath,
              file.name || 'pasted-image',
              previewUrl
            );
          } catch {
            URL.revokeObjectURL(previewUrl);
            toast.error(t('home.attachPasteFailedToast'));
          }
        })();
      }
    },
    [insertAttachmentToken, t]
  );

  // Dropping a file on the prompt attaches it like the picker/paste paths do;
  // preventDefault stops the textarea's text-insert and the window navigating
  // to the dropped file.
  const handlePromptDrop = useCallback(
    (e: DragEvent<HTMLTextAreaElement>) => {
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      e.preventDefault();
      attachFiles(files);
    },
    [attachFiles]
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

      // Atomic token deletion: Backspace at a token's end (or Delete at its
      // start) removes the whole sentinel. The caret can only sit at token
      // boundaries (selection snapping), so these two cases cover all edits.
      if ((e.key === 'Backspace' || e.key === 'Delete') && !isImeComposing(e)) {
        const target = e.currentTarget;
        if (target.selectionStart === target.selectionEnd) {
          const caret = target.selectionStart;
          const range =
            e.key === 'Backspace'
              ? tokenRangesRef.current.find((item) => item.end === caret)
              : tokenRangesRef.current.find((item) => item.start === caret);
          if (range) {
            e.preventDefault();
            const value = target.value;
            applyPromptEdit(value.slice(0, range.start) + value.slice(range.end), {
              start: range.start,
              end: range.start,
            });
            return;
          }
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
          submit();
        }
      }
    },
    [
      activePathCompletionIndex,
      activePathMention,
      activeSkillShortcut,
      activeSkillShortcutKey,
      applyPromptEdit,
      applyPromptEnterEdit,
      applyPromptTabEdit,
      commitPathCompletion,
      commitSkillShortcut,
      effectiveSkillShortcutIndex,
      filteredSkillShortcutOptions,
      pathCompletionItems,
      pathCompletionOpen,
      skillShortcutMenuOpen,
      submit,
    ]
  );

  const promptInputChrome = getRunModeInputChrome(runMode);

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
              onPaste={handlePromptPaste}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handlePromptDrop}
              onScroll={(e) => setPromptScrollTop(e.currentTarget.scrollTop)}
              onMouseMove={handlePromptMouseMove}
              onMouseLeave={() => setHoveredTokenId(null)}
              onMouseDown={handlePromptMouseDown}
              onDoubleClick={handlePromptDoubleClick}
              onContextMenu={handlePromptContextMenu}
              className={cn(
                'min-h-28 resize-none border-0 bg-transparent px-5 py-4 text-base placeholder:text-foreground-muted focus-visible:border-0 focus-visible:ring-0',
                hoveredTokenId && 'cursor-default'
              )}
            />
            {tokenRects.size > 0 && (
              // Opaque chip overlay ABOVE the textarea text: the sentinel only
              // provides layout/caret geometry, the visible entity is ours
              // (icon + label, hover/selected states). pointer-events-none so
              // clicks, hover and right-click stay on the textarea handlers.
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 z-[5] overflow-hidden"
              >
                {Array.from(tokenRects.entries()).flatMap(([tokenId, rects]) => {
                  const token = promptTokens.find((item) => item.id === tokenId);
                  if (!token) return [];
                  const range = tokenRanges.find((item) => item.token.id === tokenId);
                  const selected =
                    !!range &&
                    promptSelection.start !== promptSelection.end &&
                    promptSelection.start <= range.start &&
                    promptSelection.end >= range.end;
                  const TokenIcon = token.kind === 'image' ? ImageIcon : FileText;
                  return rects.map((rect, index) => (
                    <div
                      key={`${tokenId}:${index}`}
                      className={cn(
                        // Inset within the sentinel rect for breathing room —
                        // the exposed edges are ink-free en-space delimiters.
                        'absolute flex items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-[5px] border bg-background-2 px-1 transition-colors',
                        hoveredTokenId === tokenId
                          ? 'border-primary/60 bg-background-3'
                          : 'border-border',
                        selected && 'border-primary bg-primary/15'
                      )}
                      style={{
                        left: rect.left + 3,
                        // The measured rect is the glyph inline box (~1.2em),
                        // tighter than the chip's contents need — grow 1px
                        // into the line box's half-leading on each side so the
                        // label never clips vertically.
                        top: rect.top - promptScrollTop - 1,
                        width: Math.max(rect.width - 6, 0),
                        height: rect.height + 2,
                      }}
                    >
                      {index === 0 && (
                        <>
                          <TokenIcon className="size-3 shrink-0 text-foreground-muted" />
                          <span className="truncate text-xs leading-none text-foreground">
                            {token.label}
                          </span>
                        </>
                      )}
                    </div>
                  ));
                })}
              </div>
            )}
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
            {!tokenMenu &&
              hoveredTokenId &&
              (() => {
                const token = promptTokens.find((item) => item.id === hoveredTokenId);
                const rect = tokenRects.get(hoveredTokenId)?.[0];
                if (!token || !rect) return null;
                return (
                  <div
                    className="pointer-events-none absolute z-20 max-w-72 rounded-md border border-border bg-background-quaternary p-1.5 shadow-md"
                    style={{ left: rect.left, top: rect.top - promptScrollTop + rect.height + 6 }}
                  >
                    {token.kind === 'image' && token.previewUrl ? (
                      <img
                        src={token.previewUrl}
                        alt={token.label}
                        className="max-h-44 max-w-full rounded-sm object-contain"
                      />
                    ) : null}
                    <div className="mt-1 truncate px-0.5 text-[11px] text-foreground-muted">
                      {token.path}
                    </div>
                  </div>
                );
              })()}
            {tokenMenu &&
              (() => {
                const token = promptTokens.find((item) => item.id === tokenMenu.tokenId);
                if (!token) return null;
                const closeMenu = () => setTokenMenu(null);
                const menuItemClass =
                  'flex w-full items-center rounded-sm px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-background-2';
                return (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={closeMenu}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        closeMenu();
                      }}
                    />
                    <div
                      className="absolute z-40 min-w-44 rounded-md border border-border bg-background-quaternary p-1 shadow-md"
                      style={{ left: tokenMenu.left, top: tokenMenu.top }}
                    >
                      <button
                        type="button"
                        className={menuItemClass}
                        onClick={() => {
                          void navigator.clipboard.writeText(token.path);
                          closeMenu();
                        }}
                      >
                        {t('home.tokenCopyPath')}
                      </button>
                      <button
                        type="button"
                        className={menuItemClass}
                        onClick={() => {
                          void rpc.app
                            .openIn({ app: 'finder', path: token.path, reveal: true })
                            .catch(() => {});
                          closeMenu();
                        }}
                      >
                        {t('home.tokenRevealInFinder')}
                      </button>
                      <button
                        type="button"
                        className={menuItemClass}
                        onClick={() => {
                          void rpc.app.openIn({ app: 'finder', path: token.path }).catch(() => {});
                          closeMenu();
                        }}
                      >
                        {t('home.tokenOpenDefault')}
                      </button>
                      <div className="my-1 h-px bg-border" />
                      <button
                        type="button"
                        className={menuItemClass}
                        onClick={() => {
                          removeTokenFromPrompt(token);
                          closeMenu();
                        }}
                      >
                        {t('home.tokenRemove')}
                      </button>
                    </div>
                  </>
                );
              })()}
          </div>
          <div className="flex items-center justify-between gap-2 px-2.5 py-2">
            <div className="flex items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  attachFiles(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                aria-label={t('home.attachAria')}
                title={
                  runHostKind === 'ssh' ? t('home.attachSshUnsupported') : t('home.attachAria')
                }
                disabled={runHostKind === 'ssh'}
                onClick={() => fileInputRef.current?.click()}
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                <Paperclip className="size-4" />
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
                onClick={submit}
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
        {/* Toolbar chips wrap to extra rows in narrow hosts — never min-w-max +
            overflow-x-auto: macOS overlay scrollbars make clipped chips invisible. */}
        <div className="flex flex-wrap items-center gap-2">
          {isProjectLocked ? (
            <TaskScopedProjectButton
              label={lockedProjectName ?? selectedProjectId ?? ''}
              tooltip={
                taskScopedTarget
                  ? t('home.taskConversationScopeTooltip')
                  : t('home.subtaskScopeTooltip')
              }
            />
          ) : (
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
          )}
          <RunHostSelector kind={runHostKind} />
          {runMode === 'brainstorm' && <Chip icon={Lightbulb}>{t('home.brainstormPolicy')}</Chip>}
          {!taskScopedTarget && mounted && runMode === 'compare' && (
            <Chip icon={GitFork}>
              {t('home.compareBranchPolicy', { count: compareRuntimes.length })}
            </Chip>
          )}
          {!taskScopedTarget && mounted && runMode === 'team' && (
            <Chip icon={GitFork}>{t('home.teamBranchPolicy')}</Chip>
          )}
          {!taskScopedTarget && mounted && runMode === 'normal' && (
            <>
              <BaseBranchChip
                projectId={mounted.data.id}
                forking={effectiveStandardStrategyKind === 'new-branch'}
                locked={Boolean(parentBranchName)}
                value={
                  effectiveStandardStrategyKind === 'new-branch' ? forkBaseBranch : inPlaceValue
                }
                label={
                  effectiveStandardStrategyKind === 'new-branch'
                    ? forkBaseLabel
                    : inPlaceBranchLabel
                }
                inPlace={
                  effectiveStandardStrategyKind !== 'new-branch' && inPlaceKind === 'no-worktree'
                }
                onChange={setBaseBranch}
                ariaLabel={t('home.baseBranchAria')}
              />
              <ForkSwitchChip
                checked={effectiveStandardStrategyKind === 'new-branch'}
                disabled={isUnborn}
                onChange={(forked) => setStrategyKind(forked ? 'new-branch' : 'no-worktree')}
                ariaLabel={t('home.strategyAria')}
                labels={strategyLabels}
              />
            </>
          )}
          {!taskScopedTarget && mounted && runMode === 'review' && (
            <>
              <BaseBranchChip
                projectId={mounted.data.id}
                forking={effectiveReviewStrategyKind === 'new-branch'}
                locked={Boolean(parentBranchName)}
                value={effectiveReviewStrategyKind === 'new-branch' ? forkBaseBranch : inPlaceValue}
                label={
                  effectiveReviewStrategyKind === 'new-branch' ? forkBaseLabel : inPlaceBranchLabel
                }
                inPlace={
                  effectiveReviewStrategyKind !== 'new-branch' && inPlaceKind === 'no-worktree'
                }
                onChange={setBaseBranch}
                ariaLabel={t('home.baseBranchAria')}
              />
              <ForkSwitchChip
                checked={effectiveReviewStrategyKind === 'new-branch'}
                disabled={isUnborn}
                onChange={(forked) => setReviewStrategyKind(forked ? 'new-branch' : 'no-worktree')}
                ariaLabel={t('home.reviewStrategyAria')}
                labels={reviewStrategyLabels}
              />
            </>
          )}
          <RunModeSelector
            mode={runMode}
            summary={runModeSummary}
            onChange={setRunMode}
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
                teams={teams}
                selectedTeamId={selectedTeamId}
                onSelectTeam={setSelectedTeamId}
                agents={userAgents}
                slotAgentId={slotAgentId}
                onSlotAgentChange={setSlotAgent}
                connectionId={connectionId}
                className="mt-2 border-t-0 pt-0"
              />
            )}
          />
          <Popover>
            <PopoverTrigger
              aria-label={t('home.composerSettingsAria')}
              title={t('home.composerSettingsAria')}
              className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground"
            >
              <Settings2 className="size-3.5" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-96 gap-0 p-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="text-xs text-foreground">
                    {t('home.attachImagesAsPathsLabel')}
                  </span>
                  <InfoTooltip
                    label={t('home.attachImagesAsPathsLabel')}
                    content={t('home.attachImagesAsPathsDesc')}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <ComposerScopeToggle
                    source={attachImagesField.source}
                    canOverride={attachImagesField.canOverride}
                    onChange={attachImagesField.setSource}
                  />
                  <Switch
                    size="sm"
                    checked={attachImagesAsPaths}
                    onCheckedChange={attachImagesField.setValue}
                  />
                </div>
              </div>
              <div className="mt-2 flex flex-col gap-1 border-t border-border/60 pt-2">
                <ComposerSettingsHeader
                  label={t('home.composerRunDefaultsLabel')}
                  hint={t('home.composerRunDefaultsHint')}
                />
                <ComposerScopeRow
                  label={t('home.composerDefaultRuntimeLabel')}
                  value={runtimeId ? (getRuntime(runtimeId)?.name ?? runtimeId) : undefined}
                  source={runtimeOverridden ? 'project' : 'global'}
                  canOverride={hasProjectOverrideTarget}
                  onChange={(scope) =>
                    setComposerDefault(
                      'runtimeId',
                      scope === 'project' ? (runtimeId ?? undefined) : undefined
                    )
                  }
                />
                <ComposerScopeRow
                  label={t('home.composerDefaultRunModeLabel')}
                  source={runModeOverridden ? 'project' : 'global'}
                  canOverride={hasProjectOverrideTarget}
                  onChange={(scope) =>
                    setComposerDefault(
                      'runMode',
                      scope === 'project' ? persistedRunMode : undefined
                    )
                  }
                />
                <ComposerScopeRow
                  label={t('home.composerDefaultStrategyLabel')}
                  source={standardStrategyOverridden ? 'project' : 'global'}
                  canOverride={hasProjectOverrideTarget}
                  onChange={(scope) =>
                    setComposerDefault(
                      'standardStrategyKind',
                      scope === 'project' ? strategyKind : undefined
                    )
                  }
                />
              </div>
              <div className="mt-2 flex flex-col gap-1 border-t border-border/60 pt-2">
                <ComposerSettingsHeader
                  label={t('home.promptPrinciplesLabel')}
                  action={
                    <button
                      type="button"
                      className="font-mono text-[10px] uppercase tracking-widest text-foreground-passive transition-colors hover:text-foreground"
                      onClick={() => navigate('library', { section: 'prompts' })}
                    >
                      {t('home.manage')}
                    </button>
                  }
                />
                {promptPrinciples.length === 0 ? (
                  <p className="text-xs text-foreground-passive">{t('settings.prompts.empty')}</p>
                ) : (
                  promptPrinciples.map((principle) => (
                    <div key={principle.id} className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="min-w-0 truncate text-xs text-foreground">
                          {principle.name || t('home.promptPrincipleUnnamed')}
                        </span>
                        {principle.text ? (
                          <InfoTooltip
                            label={principle.name || t('home.promptPrincipleUnnamed')}
                            content={<span className="whitespace-pre-wrap">{principle.text}</span>}
                          />
                        ) : null}
                      </div>
                      <Switch
                        size="sm"
                        checked={
                          selectedProjectId
                            ? effectiveGlobalEnabled(projectPromptPrinciples, principle)
                            : principle.enabled
                        }
                        onCheckedChange={(checked) =>
                          selectedProjectId
                            ? setGlobalPrincipleProjectOverride(principle, checked)
                            : setPromptPrincipleEnabled(principle.id, checked)
                        }
                        aria-label={t('settings.prompts.toggle')}
                      />
                    </div>
                  ))
                )}
                {selectedProjectId && projectPrincipleItems.length > 0 ? (
                  <>
                    <div className="mt-1 text-[10px] font-medium uppercase tracking-wide text-foreground-passive">
                      {t('home.promptPrinciplesProjectHeading')}
                    </div>
                    {projectPrincipleItems.map((principle) => (
                      <div key={principle.id} className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="min-w-0 truncate text-xs text-foreground">
                            {principle.name || t('home.promptPrincipleUnnamed')}
                          </span>
                          {principle.text ? (
                            <InfoTooltip
                              label={principle.name || t('home.promptPrincipleUnnamed')}
                              content={
                                <span className="whitespace-pre-wrap">{principle.text}</span>
                              }
                            />
                          ) : null}
                        </div>
                        <Switch
                          size="sm"
                          checked={principle.enabled}
                          onCheckedChange={(checked) =>
                            setProjectPrincipleEnabled(principle.id, checked)
                          }
                          aria-label={t('settings.prompts.toggle')}
                        />
                      </div>
                    ))}
                  </>
                ) : null}
              </div>
              <InstructionFilesSection projectPath={skillProjectPath} />
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
});

/**
 * Inherit/override pill for a single composer setting. `global` means the row
 * follows the user's global default; `project` overrides it for the current
 * project (persisted to project settings / `.yoda.json`). Disabled with a hint
 * when no project is selected, since there is nothing to override against.
 */
function ComposerScopeToggle({
  source,
  canOverride,
  onChange,
}: {
  source: ComposerOverrideScope;
  canOverride: boolean;
  onChange: (source: ComposerOverrideScope) => void;
}) {
  const { t } = useTranslation();
  const isProject = source === 'project';
  const disabled = !canOverride && !isProject;
  return (
    <button
      type="button"
      disabled={disabled}
      title={
        disabled
          ? t('home.composerScopeProjectRequired')
          : isProject
            ? t('home.composerScopeOverrideTooltip')
            : t('home.composerScopeInheritTooltip')
      }
      onClick={() => onChange(isProject ? 'global' : 'project')}
      className={cn(
        'flex h-5 shrink-0 items-center rounded-full border px-1.5 text-[10px] font-medium transition-colors',
        isProject
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border bg-background-1 text-foreground-passive hover:text-foreground',
        disabled && 'pointer-events-none opacity-40'
      )}
    >
      {isProject ? t('home.composerScopeProject') : t('home.composerScopeGlobal')}
    </button>
  );
}

/** One run-default row in the composer popover: label + inherit/override pill.
 *  The value itself is edited via the matching toolbar chip. */
function ComposerScopeRow({
  label,
  value,
  source,
  canOverride,
  onChange,
}: {
  label: string;
  value?: string;
  source: ComposerOverrideScope;
  canOverride: boolean;
  onChange: (source: ComposerOverrideScope) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 truncate text-xs text-foreground">{label}</span>
      <div className="flex shrink-0 items-center gap-1.5">
        {value ? (
          <span className="max-w-32 truncate text-[11px] text-foreground-passive">{value}</span>
        ) : null}
        <ComposerScopeToggle source={source} canOverride={canOverride} onChange={onChange} />
      </div>
    </div>
  );
}

/** Quiet micro-header for a composer-settings popover section: label + optional hint + trailing action. */
function ComposerSettingsHeader({
  label,
  hint,
  action,
}: {
  label: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <MicroLabel className="text-[10px]">{label}</MicroLabel>
        {hint ? <InfoTooltip label={label} content={hint} /> : null}
      </div>
      {action}
    </div>
  );
}

/**
 * Composer-settings view onto the instruction files that will feed the next
 * session's prompt: the user-global CLAUDE.md (user-level system prompt) and
 * the project's CLAUDE.md / AGENTS.md (project prompt). View + open-to-edit;
 * the runtime's built-in system prompt is not editable and only gets a hint.
 */
function InstructionFilesSection({ projectPath }: { projectPath?: string }) {
  const { t } = useTranslation();
  const { data: files = [] } = useQuery<ClaudeMemoryFile[]>({
    queryKey: ['instructionFiles', projectPath ?? null],
    queryFn: () => rpc.conversations.getInstructionFiles(projectPath),
    refetchOnWindowFocus: false,
  });

  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-border/60 pt-2">
      <ComposerSettingsHeader
        label={t('home.instructionFilesLabel')}
        hint={t('home.instructionFilesHint')}
      />
      {files.length === 0 ? (
        <p className="text-xs text-foreground-passive">{t('home.noInstructionFiles')}</p>
      ) : (
        files.map((file) => (
          <ContextItem
            key={file.path}
            icon={<FileText className="size-3.5" />}
            label={memoryFileLabel(file, t)}
            meta={formatBytes(file.bytes)}
            text={file.content}
            sourcePath={file.path}
          />
        ))
      )}
    </div>
  );
}

interface ChipProps {
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}

interface TaskScopedProjectButtonProps {
  label: string;
  tooltip: string;
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

interface RunModeOption {
  mode: HomeRunMode;
  icon: ComponentType<{ className?: string }>;
  labelKey: string;
  descKey: string;
}

// Modes split into two clusters. The first cluster runs a single converged
// workflow; "compare" stands alone because it fans the same task out across
// isolated branches — a different mental model, so it gets its own group.
const RUN_MODE_GROUPS: Array<{ labelKey: string; options: RunModeOption[] }> = [
  {
    labelKey: 'home.modeGroupWorkflow',
    options: [
      { mode: 'normal', icon: Bot, labelKey: 'home.modeNormal', descKey: 'home.modeNormalDesc' },
      {
        mode: 'brainstorm',
        icon: Lightbulb,
        labelKey: 'home.modeBrainstorm',
        descKey: 'home.modeBrainstormDesc',
      },
      {
        mode: 'review',
        icon: Repeat2,
        labelKey: 'home.modeReview',
        descKey: 'home.modeReviewDesc',
      },
      { mode: 'team', icon: Users, labelKey: 'home.modeTeam', descKey: 'home.modeTeamDesc' },
    ],
  },
  {
    labelKey: 'home.modeGroupExplore',
    options: [
      {
        mode: 'compare',
        icon: GitCompare,
        labelKey: 'home.modeCompare',
        descKey: 'home.modeCompareDesc',
      },
    ],
  },
];

const RUN_MODE_OPTIONS: RunModeOption[] = RUN_MODE_GROUPS.flatMap((group) => group.options);

interface RunModeSelectorProps {
  mode: HomeRunMode;
  summary?: string | null;
  onChange: (mode: HomeRunMode) => void;
  renderConfiguration: (mode: HomeRunMode) => ReactNode;
}

function RunModeSelector({ mode, summary, onChange, renderConfiguration }: RunModeSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // The mode change reshapes the whole development paradigm, so we stage it locally
  // and only commit on explicit confirmation rather than applying on each click.
  const [pendingMode, setPendingMode] = useState<HomeRunMode>(mode);
  const current = RUN_MODE_OPTIONS.find((option) => option.mode === mode) ?? RUN_MODE_OPTIONS[0];
  const CurrentIcon = current.icon;
  const pending =
    RUN_MODE_OPTIONS.find((option) => option.mode === pendingMode) ?? RUN_MODE_OPTIONS[0];
  const PendingIcon = pending.icon;
  const dirty = pendingMode !== mode;
  const isNonStandardMode = mode !== 'normal';

  const handleOpenChange = (next: boolean) => {
    if (next) setPendingMode(mode);
    setOpen(next);
  };

  const handleConfirm = () => {
    if (dirty) onChange(pendingMode);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label={t('home.modeAria')}
            className={cn(
              'flex h-7 min-w-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors',
              isNonStandardMode
                ? 'border-sky-500/25 bg-sky-500/10 text-sky-700 shadow-sm ring-1 ring-sky-500/15 hover:bg-sky-500/15 ydark:text-sky-300'
                : 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
            )}
          >
            <CurrentIcon className="size-3.5 shrink-0" />
            <span className="shrink-0">{t(current.labelKey)}</span>
            {summary ? (
              <>
                <span
                  className={cn(
                    isNonStandardMode ? 'text-sky-600/45 ydark:text-sky-300/45' : 'text-primary/40'
                  )}
                >
                  ·
                </span>
                <span
                  className={cn(
                    'min-w-0 max-w-[14rem] truncate font-normal',
                    isNonStandardMode ? 'text-sky-700/80 ydark:text-sky-300/80' : 'text-primary/80'
                  )}
                >
                  {summary}
                </span>
              </>
            ) : null}
            <ChevronDown
              className={cn(
                'size-3 shrink-0',
                isNonStandardMode ? 'text-sky-700/70 ydark:text-sky-300/70' : 'text-primary/70'
              )}
            />
          </button>
        }
      />
      <DialogContent className="flex h-[min(70dvh,40rem)] w-[min(44rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col gap-0 p-0 sm:max-w-[44rem]">
        <DialogHeader showCloseButton className="min-w-0 px-4 py-3">
          <DialogTitle className="truncate text-sm font-semibold text-foreground">
            {t('home.developmentParadigm')}
          </DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 divide-x divide-border/60 border-t border-border/60">
          <div
            role="tablist"
            aria-label={t('home.modeAria')}
            aria-orientation="vertical"
            className="flex w-44 shrink-0 flex-col gap-1 overflow-y-auto bg-background-1/50 p-2"
          >
            {RUN_MODE_GROUPS.map((group, groupIndex) => (
              <div
                key={group.labelKey}
                className={cn(
                  'flex flex-col gap-0.5',
                  groupIndex > 0 && 'mt-1 border-t border-border/60 pt-2'
                )}
              >
                <span className="px-2.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted/70">
                  {t(group.labelKey)}
                </span>
                {group.options.map((option) => {
                  const Icon = option.icon;
                  const active = option.mode === pendingMode;
                  return (
                    <button
                      key={option.mode}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      title={t(option.descKey)}
                      onClick={() => setPendingMode(option.mode)}
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
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
            <div className="flex items-center gap-2">
              <PendingIcon className="size-4 shrink-0 text-primary" />
              <span className="text-sm font-semibold text-foreground">{t(pending.labelKey)}</span>
            </div>
            <p className="text-xs text-foreground-muted">{t(pending.descKey)}</p>
            {renderConfiguration(pendingMode)}
          </div>
        </div>
        <DialogFooter className="px-3 py-2.5">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex h-8 items-center justify-center rounded-md border border-border bg-background-1 px-3 text-xs font-medium text-foreground transition-colors hover:bg-background-2"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!dirty}
            className="flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            {t('common.confirm')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface StrategyChipLabels {
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
  teams: AgentTeam[];
  selectedTeamId: string;
  onSelectTeam: (teamId: string) => void;
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
  teams,
  selectedTeamId,
  onSelectTeam,
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
    // Slots stack as single-line rows so the panel stays compact regardless of
    // host width (composer popover, settings modal).
    <div className={cn('mt-3 border-t border-border/60 pt-3', className)}>
      {mode === 'normal' && (
        <div className="mt-2 flex flex-col gap-1.5">
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
        <div className="flex flex-col gap-1.5">
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
        <div className="flex flex-col gap-1.5">
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
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
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
              className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-dashed border-border/70 bg-background-1 text-xs text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground"
            >
              <Plus className="size-3.5" />
              <span>{t('home.addCompareAgent')}</span>
            </button>
          )}
        </div>
      )}

      {mode === 'review' && (
        <div className="flex flex-col gap-1.5">
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
          <div className="px-1 text-xs text-foreground-muted">
            {t('home.reviewRoundLimit', { count: REVIEW_MAX_ROUNDS })}
          </div>
        </div>
      )}

      {mode === 'team' &&
        (() => {
          const team = teams.find((tm) => tm.id === selectedTeamId) ?? teams[0];
          return (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                {teams.map((tm) => {
                  const active = tm.id === (team?.id ?? selectedTeamId);
                  return (
                    <button
                      key={tm.id}
                      type="button"
                      onClick={() => onSelectTeam(tm.id)}
                      className={cn(
                        'flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm transition-colors',
                        active
                          ? 'border-primary/50 bg-primary/10 text-primary'
                          : 'border-border text-foreground-muted hover:bg-background-2 hover:text-foreground'
                      )}
                    >
                      <span className="text-base leading-none">{tm.icon}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{tm.name}</span>
                      <span className="shrink-0 text-[11px] text-foreground-muted">
                        {t('home.teamMemberCount', { count: tm.members.length })}
                      </span>
                      {active && <Check className="size-3.5 shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>
              {team && (
                <div className="flex flex-col gap-0.5 rounded-md border border-border/60 bg-background-1/40 p-2">
                  {team.members.map((m) => (
                    <div key={m.handle} className="flex items-center gap-2 px-1 py-1 text-xs">
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {m.displayName}
                      </span>
                      {m.role === 'leader' && (
                        <span className="shrink-0 rounded bg-primary/15 px-1.5 py-px text-[10px] text-primary">
                          {t('home.teamLeader')}
                        </span>
                      )}
                      <span className="shrink-0 font-mono text-[10px] text-foreground-muted">
                        {getRuntime(m.runtime)?.name ?? m.runtime}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <p className="px-1 text-xs text-foreground-muted">{t('home.teamManageHint')}</p>
            </div>
          );
        })()}
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
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-border/70 bg-background-1 py-1 pl-2 pr-1">
      <span title={label} className="flex w-28 shrink-0 items-center gap-1.5 text-foreground-muted">
        <Icon className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate text-[11px] font-medium uppercase tracking-wide">
          {label}
        </span>
      </span>
      <AgentSlotSelector
        selectedAgent={selectedAgent}
        agents={agents}
        onSelectAgent={onSelectAgent}
        onCreateAgent={() => showAgentModal({ onSuccess: (created) => onSelectAgent(created.id) })}
        onManageAgents={() => navigate('agentManager')}
        className="h-8 min-w-0 flex-1 border-transparent bg-background-2/40 hover:bg-background-2"
      />
      {selectedAgent && (
        <AgentSelector
          value={runtime}
          onChange={onChange}
          connectionId={connectionId}
          className="h-8 w-40 shrink-0 border-transparent bg-background-2/40 text-sm transition-colors hover:bg-background-2"
        />
      )}
      {action}
    </div>
  );
}

function TaskScopedProjectButton({ label, tooltip }: TaskScopedProjectButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex min-w-0" />}>
        <button
          type="button"
          disabled
          aria-label={label}
          className="flex h-7 max-w-64 cursor-not-allowed items-center gap-1.5 rounded-md border border-border bg-background-1/60 px-2.5 text-xs text-foreground-muted opacity-75"
        >
          <FolderOpen className="size-3.5 shrink-0 text-foreground-passive" />
          <span className="min-w-0 truncate">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-left">{tooltip}</TooltipContent>
    </Tooltip>
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

interface BaseBranchChipProps {
  projectId: string;
  /** Forking → any branch is a valid base; not forking → local branches only
   *  (current = run in place, another = checkout-existing worktree). */
  forking: boolean;
  /** Subtasks are pinned to the parent task's branch. */
  locked: boolean;
  value: Branch | undefined;
  label: string;
  /** The task will run in place on this branch (anchor icon). */
  inPlace: boolean;
  onChange: (next: Branch) => void;
  ariaLabel: string;
}

function BaseBranchChip({
  projectId,
  forking,
  locked,
  value,
  label,
  inPlace,
  onChange,
  ariaLabel,
}: BaseBranchChipProps) {
  const Icon = inPlace ? Anchor : GitBranch;

  if (locked) {
    return (
      <span className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background-1 px-2.5 text-xs text-foreground">
        <Icon className="size-3.5 text-foreground-muted" />
        {label}
      </span>
    );
  }

  return (
    <ProjectBranchSelector
      projectId={projectId}
      localOnly={!forking}
      value={value}
      onValueChange={onChange}
      trigger={
        <ComboboxTrigger
          aria-label={ariaLabel}
          className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background-1 px-2.5 text-xs text-foreground transition-colors hover:bg-background-2"
        >
          <Icon className="size-3.5 text-foreground-muted" />
          <ComboboxValue />
          <ChevronDown className="size-3 text-foreground-muted" />
        </ComboboxTrigger>
      }
    />
  );
}

interface ForkSwitchChipProps {
  checked: boolean;
  disabled: boolean;
  onChange: (forked: boolean) => void;
  ariaLabel: string;
  labels: StrategyChipLabels;
}

function ForkSwitchChip({ checked, disabled, onChange, ariaLabel, labels }: ForkSwitchChipProps) {
  const { t } = useTranslation();
  const title = checked ? labels.newBranchTitle : labels.noWorktreeTitle;
  const desc = checked ? labels.newBranchDesc : labels.noWorktreeDesc;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={ariaLabel}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background-1 px-2.5 text-xs text-foreground transition-colors hover:bg-background-2 disabled:pointer-events-none disabled:opacity-50"
          >
            <GitFork className="size-3.5 text-foreground-muted" />
            <span>{t('home.forkChipLabel')}</span>
            {/* Visual-only mini switch (the chip button carries the switch role);
                mirrors the sm Switch in @renderer/lib/ui/switch. */}
            <span
              className={cn(
                'relative inline-flex h-[14px] w-[24px] shrink-0 items-center rounded-full border border-border-1 transition-colors',
                checked ? 'bg-background-neutral' : 'bg-background'
              )}
            >
              <span
                className={cn(
                  'pointer-events-none block size-3 rounded-full transition-transform',
                  checked
                    ? 'translate-x-[calc(100%-2px)] bg-background-3'
                    : 'translate-x-0 bg-background-neutral/50'
                )}
              />
            </span>
          </button>
        }
      />
      <TooltipContent align="start" className="max-w-72">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{title}</span>
          <span className="text-foreground-muted">{desc}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export const homeView = {
  WrapView: HomeViewWrapper,
  TitlebarSlot: HomeTitlebar,
  MainPanel: HomeMainPanel,
};
