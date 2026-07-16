import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Anchor,
  Bot,
  Check,
  ChevronDown,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  GitCompare,
  GitFork,
  GripVertical,
  Lightbulb,
  Monitor,
  Repeat2,
  Server,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import yodaLogoWhite from '@/assets/images/yoda/yoda_logo_white.svg';
import yodaLogo from '@/assets/images/yoda/yoda_logo.svg';
import {
  BUILTIN_FEATURE_TEAM_ID,
  BUILTIN_REVIEW_TEAM_ID,
  BUILTIN_STARTUP_TEAM_ID,
  type AgentTeam,
} from '@shared/agent-team';
import { agentToDraft, type Agent } from '@shared/agents';
import { BUILTIN_AGENT_KEYS } from '@shared/builtin-agents';
import type { RuntimeInstructionFile } from '@shared/conversations';
import { FEATURE_WORKFLOW_STAGES, hasFeatureWorkflowContract } from '@shared/feature-workflow';
import type { Branch } from '@shared/git';
import type {
  ComposerDefaults,
  ProjectPromptPrinciples,
  TaskOutputLanguage,
} from '@shared/project-settings';
import { INTERNAL_PROJECT_ID } from '@shared/projects';
import { withSystemPrompt } from '@shared/prompt-format';
import { REVIEW_MAX_ROUNDS } from '@shared/review-protocol';
import { getRuntime, RUNTIME_IDS, type RuntimeId } from '@shared/runtime-registry';
import { normalizeSkillSelection } from '@shared/skills/selection';
import type { SkillSelectionInput } from '@shared/skills/types';
import { ensureUniqueTaskDisplayName, taskNameFromPrompt } from '@shared/task-name';
import { resolveHomeProjectId } from '@renderer/app/home-project-selection';
import { FeatureWorkflowPreview } from '@renderer/features/agent-room/feature-workflow-rail';
import { invalidateTeamRoomQueries } from '@renderer/features/agent-room/team-room-queries';
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
import { useSkills } from '@renderer/features/skills/components/useSkills';
import { ContextItem, memoryFileLabel } from '@renderer/features/tasks/components/context-item';
import { PermissionModeSelect } from '@renderer/features/tasks/components/permission-mode-select';
import { initialConversationTitle } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { useEffectiveRuntime } from '@renderer/features/tasks/conversations/use-effective-runtime';
import { ProjectSelector } from '@renderer/features/tasks/create-task-modal/project-selector';
import { useRuntimePermissionModes } from '@renderer/features/tasks/hooks/useRuntimePermissionModes';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { accountGreetingName } from '@renderer/lib/account-display';
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
import { Badge } from '@renderer/lib/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@renderer/lib/ui/collapsible';
import { ComboboxTrigger, ComboboxValue } from '@renderer/lib/ui/combobox';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Switch } from '@renderer/lib/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { formatBytes } from '@renderer/utils/formatBytes';
import { cn } from '@renderer/utils/utils';
import {
  dualField,
  withComposerDefault,
  type ComposerOverrideScope,
} from './composer-project-overrides';
import { ComposerPromptInput } from './composer-prompt-input';
import { serializePromptWithTokens, type PromptToken } from './prompt-attachment-tokens';
import { promptRewriteFailureDescription } from './submit-prompt-rewrite';

type TaskStrategyKind = 'new-branch' | 'no-worktree';
/** Strategy actually submitted to createTask — adds checkout-existing, which is
 *  derived (not forking + a non-current local or remote branch picked), never persisted. */
type TaskSubmitStrategyKind = TaskStrategyKind | 'checkout-existing';
type HomeRunMode = 'normal' | 'brainstorm' | 'review' | 'team';
type RunHostKind = 'local' | 'ssh';

/**
 * One extra run environment in a multi-config comparison. Each variant is a copy
 * of the base composer config the user can tweak: a different project, runtime,
 * branch strategy, or prompt. On submit, the base config plus every variant each
 * spawn their own task, and a detached window tiles them side by side.
 */
type CompareVariant = {
  id: string;
  projectId: string | null;
  runtimeId: RuntimeId | null;
  strategyKind: TaskStrategyKind;
  /** Selected starting branch; null = the project's default branch. */
  baseBranch: Branch | null;
};

type HomeComposerSubmitTarget =
  | { kind: 'new-task'; parentTask?: { projectId: string; taskId: string } }
  | { kind: 'existing-task'; projectId: string; taskId: string };

export type HomeComposerSubmitResult =
  | { kind: 'task'; projectId: string; taskId: string }
  | { kind: 'conversation'; projectId: string; taskId: string; conversationIds: string[] };

function branchLabel(branch: Branch | undefined, fallback = 'main'): string {
  if (!branch) return fallback;
  return branch.type === 'remote' ? `${branch.remote.name}/${branch.branch}` : branch.branch;
}

function branchNeedsCheckout(
  branch: Branch | undefined,
  currentBranchName: string | null
): boolean {
  if (!branch) return false;
  if (branch.type === 'remote') return true;
  return branch.branch !== currentBranchName;
}

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

const MAX_COMPARE_VARIANTS = 5;
const DEFAULT_REVIEWER_RUNTIME: RuntimeId = 'claude';
const DEFAULT_TASK_OUTPUT_LANGUAGE: TaskOutputLanguage = 'skip';
const DEFAULT_SUMMARY_OUTPUT_LANGUAGE: TaskOutputLanguage = 'app';
const DEFAULT_INPUT_PROMPT_LANGUAGE: TaskOutputLanguage = 'skip';
const TASK_OUTPUT_ENABLED_LANGUAGE_OPTIONS: TaskOutputLanguage[] = ['app', 'prompt', 'zh-CN', 'en'];
const INPUT_PROMPT_ENABLED_LANGUAGE_OPTIONS: TaskOutputLanguage[] = ['app', 'zh-CN', 'en'];
type ExplicitTaskOutputLanguage = Extract<TaskOutputLanguage, 'en' | 'zh-CN'>;

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
  return SLOT_DEFAULT_BUILTIN_KEY[slotKey];
}
const ADVANCED_INPUT_CONTAINER_CLASS =
  'border-border bg-background-1 ring-1 ring-sky-500/15 focus-within:border-sky-500/30 focus-within:ring-sky-500/25';

function getGreetingKey(hour: number): string {
  if (hour >= 5 && hour < 9) return 'home.greeting.earlyMorning';
  if (hour >= 9 && hour < 12) return 'home.greeting.morning';
  if (hour >= 12 && hour < 14) return 'home.greeting.noon';
  if (hour >= 14 && hour < 18) return 'home.greeting.afternoon';
  if (hour >= 18 && hour < 22) return 'home.greeting.evening';
  return 'home.greeting.lateNight';
}

function getRunModeInputChrome(mode: HomeRunMode): RunModeInputChrome {
  switch (mode) {
    case 'brainstorm':
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

function agentSkillSelection(agent: Agent | null): SkillSelectionInput | undefined {
  if (!agent) return undefined;
  return normalizeSkillSelection({
    autoSkillKeys: agent.enabledSkillIds,
    manualSkillKeys: agent.manualSkillIds,
  });
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
  const greetingName = sessionUser ? accountGreetingName(sessionUser) : '';

  return (
    <div
      data-yoda-surface="home"
      className="@container flex h-full flex-col overflow-y-auto bg-background text-foreground"
    >
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-1 flex-col px-5 pb-8 pt-14 @2xl:px-8 @5xl:px-10">
        <div className="flex flex-1 flex-col justify-center gap-8 py-4">
          <div data-yoda-surface="home-hero" className="text-center">
            <div className="dream-skin-status" aria-hidden="true">
              <span />
              DREAM SKIN ONLINE
            </div>
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
  const { t, i18n } = useTranslation();
  const { navigate } = useNavigate();
  const taskScopedTarget = submitTarget.kind === 'existing-task' ? submitTarget : null;
  // Subtask mode: still creates tasks, but locked to the parent's project and
  // linked via parentTaskId; new branches fork off the parent's branch.
  const parentTarget = submitTarget.kind === 'new-task' ? (submitTarget.parentTask ?? null) : null;

  const projectManager = getProjectManagerStore();
  const showAddProjectModal = useShowModal('addProjectModal');

  const { params: homeParams, setParams: setHomeParams } = useParams('home');
  const homeProjectId = homeParams.projectId;
  const homeRouteProject = homeProjectId ? projectManager.projects.get(homeProjectId) : undefined;

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
  const { value: taskSettings, update: updateTaskSettings } = useAppSettingsKey('tasks');

  const isProjectLocked = !!(taskScopedTarget || parentTarget);
  const selectedProjectId = resolveHomeProjectId({
    lockedProjectId: taskScopedTarget?.projectId ?? parentTarget?.projectId,
    homeProjectId,
    navigationProjectId: navProjectId,
    draftProjectId: draft?.selectedProjectId,
  });
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
    if (isProjectLocked) return;
    if (homeProjectId === INTERNAL_PROJECT_ID) {
      if (draftProjectId !== null) {
        updateDraft({ selectedProjectId: null, baseBranch: null });
        return;
      }
      setHomeParams({ projectId: undefined });
      return;
    }
    if (!homeProjectId) return;
    if (!homeRouteProject?.data) return;
    void projectManager.mountProject(homeProjectId).catch(() => {});
    if (homeProjectId !== draftProjectId) {
      updateDraft({ selectedProjectId: homeProjectId, baseBranch: null });
      return;
    }
    // Keep the navigation-scoped project until the optimistic settings update
    // has reached the draft. Clearing it first leaves a render with neither
    // source, so the composer briefly becomes projectless and disables modes
    // that require a project.
    setHomeParams({ projectId: undefined });
  }, [
    homeProjectId,
    homeRouteProject?.data,
    projectManager,
    setHomeParams,
    isProjectLocked,
    updateDraft,
    draftProjectId,
  ]);

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

  // User-selected starting branch. The fork switch is orthogonal: it decides
  // whether work lands on this branch or a new branch based on it.
  const baseBranchOverridden = composerDefaults?.baseBranch !== undefined;
  const draftBaseBranch = composerDefaults?.baseBranch ?? draft?.baseBranch ?? null;
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
      const value = {
        type: next.type,
        branch: next.branch,
        ...(next.type === 'remote' ? { remoteName: next.remote.name } : {}),
      };
      if (baseBranchOverridden) setComposerDefault('baseBranch', value);
      else updateDraft({ baseBranch: value });
    },
    [baseBranchOverridden, setComposerDefault, updateDraft]
  );
  // Subtasks always branch off the parent task's branch.
  const selectedBranch: Branch | undefined = useMemo(
    () =>
      parentBranchName
        ? { type: 'local', branch: parentBranchName }
        : (pickedBaseBranch ?? defaultBranch),
    [parentBranchName, pickedBaseBranch, defaultBranch]
  );
  const selectedBranchLabel = branchLabel(selectedBranch);
  // Not forking means "work on the selected branch". When that branch is not the
  // current local checkout (or is a remote source), execution materializes it in
  // a worktree as checkout-existing; the chip value itself stays unchanged.
  const currentBranchName = repo?.currentBranch ?? null;
  const selectedBranchSubmitKind: 'no-worktree' | 'checkout-existing' =
    !parentBranchName && branchNeedsCheckout(selectedBranch, currentBranchName)
      ? 'checkout-existing'
      : 'no-worktree';
  const selectedBranchRunsInPlace = selectedBranchSubmitKind === 'no-worktree';
  const runHostKind: RunHostKind = projectData?.type === 'ssh' ? 'ssh' : 'local';
  const findProjectIdByRunHost = useCallback(
    (nextKind: RunHostKind): string | null => {
      for (const [id, store] of projectManager.projects) {
        const candidate = asMounted(store);
        if (!candidate || candidate.data.isInternal) continue;
        if ((nextKind === 'ssh') === (candidate.data.type === 'ssh')) return id;
      }
      return null;
    },
    [projectManager.projects]
  );
  const openAddProjectForRunHost = useCallback(
    (nextKind: RunHostKind) => {
      showAddProjectModal({ strategy: nextKind, mode: 'pick' });
    },
    [showAddProjectModal]
  );
  const selectRunHostProject = useCallback(
    (nextKind: RunHostKind) => {
      if (nextKind === runHostKind) return;
      const nextProjectId = findProjectIdByRunHost(nextKind);
      if (nextProjectId) {
        setSelectedProjectId(nextProjectId);
        return;
      }
      openAddProjectForRunHost(nextKind);
    },
    [findProjectIdByRunHost, openAddProjectForRunHost, runHostKind, setSelectedProjectId]
  );
  const strategyLabels = useMemo(
    () => ({
      newBranchTitle: t('home.strategyNewBranchTitle', { branch: selectedBranchLabel }),
      newBranchDesc: t('home.strategyNewBranchDesc', { branch: selectedBranchLabel }),
      noWorktreeTitle:
        selectedBranchSubmitKind === 'checkout-existing'
          ? t('home.strategyCheckoutExistingTitle', { branch: selectedBranchLabel })
          : t('home.strategyNoWorktreeTitle', { branch: selectedBranchLabel }),
      noWorktreeDesc:
        selectedBranchSubmitKind === 'checkout-existing'
          ? t('home.strategyCheckoutExistingDesc', { branch: selectedBranchLabel })
          : t('home.strategyNoWorktreeDesc'),
    }),
    [selectedBranchLabel, selectedBranchSubmitKind, t]
  );
  const reviewStrategyLabels = useMemo(
    () => ({
      newBranchTitle: t('home.reviewStrategyNewBranchTitle', { branch: selectedBranchLabel }),
      newBranchDesc: t('home.reviewStrategyNewBranchDesc', { branch: selectedBranchLabel }),
      noWorktreeTitle:
        selectedBranchSubmitKind === 'checkout-existing'
          ? t('home.strategyCheckoutExistingTitle', { branch: selectedBranchLabel })
          : t('home.reviewStrategySameBranchTitle', { branch: selectedBranchLabel }),
      noWorktreeDesc:
        selectedBranchSubmitKind === 'checkout-existing'
          ? t('home.strategyCheckoutExistingDesc', { branch: selectedBranchLabel })
          : t('home.reviewStrategySameBranchDesc'),
    }),
    [selectedBranchLabel, selectedBranchSubmitKind, t]
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
  // Extra comparison environments (ephemeral, not persisted). Empty = a plain
  // single-task submit; non-empty = multi-config compare (base + variants).
  const [compareVariants, setCompareVariants] = useState<CompareVariant[]>([]);
  const updateVariant = useCallback((id: string, patch: Partial<CompareVariant>) => {
    setCompareVariants((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }, []);
  const removeVariant = useCallback((id: string) => {
    setCompareVariants((prev) => prev.filter((v) => v.id !== id));
  }, []);
  // Drag-handle reorder: drop the dragged variant in front of the target row.
  const reorderVariant = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;
    setCompareVariants((prev) => {
      const fromIndex = prev.findIndex((v) => v.id === fromId);
      const toIndex = prev.findIndex((v) => v.id === toId);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      if (moved) next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);
  const reviewerOverridden = composerDefaults?.reviewerRuntime !== undefined;
  const reviewerRuntime =
    composerDefaults?.reviewerRuntime ?? draft?.reviewReviewerRuntime ?? DEFAULT_REVIEWER_RUNTIME;
  const setReviewerProvider = useCallback(
    (next: RuntimeId) => {
      if (reviewerOverridden) setComposerDefault('reviewerRuntime', next);
      else updateDraft({ reviewReviewerRuntime: next });
    },
    [reviewerOverridden, setComposerDefault, updateDraft]
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
  const composerAgent = useMemo<Agent | null>(() => {
    if (runMode === 'team') {
      const leader =
        activeTeam?.members.find((member) => member.role === 'leader') ?? activeTeam?.members[0];
      if (!leader?.agentRef) return null;
      return (
        userAgents.find(
          (agent) => agent.id === leader.agentRef || agent.slug === leader.agentRef
        ) ?? null
      );
    }
    const slotKey =
      runMode === 'brainstorm'
        ? SPEC_PROMPT_KEY
        : runMode === 'review'
          ? REVIEW_IMPLEMENTER_PROMPT_KEY
          : NORMAL_PROMPT_KEY;
    const agentId = slotAgentId(slotKey);
    return agentId ? (userAgents.find((agent) => agent.id === agentId) ?? null) : null;
  }, [activeTeam, runMode, slotAgentId, userAgents]);
  const composerSkillSelection = useMemo(() => agentSkillSelection(composerAgent), [composerAgent]);
  const permissionModes = useRuntimePermissionModes();
  const runModeSummary = useMemo(() => {
    const runtimeName = (id: RuntimeId | null) => (id ? (getRuntime(id)?.name ?? id) : null);
    const modelLabel = (model: string | null) =>
      model ? formatModelLabel(model) : t('home.modelDefault');

    if (runMode === 'team') {
      return activeTeam ? teamDisplayName(activeTeam, t) : null;
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
  }, [runMode, runtimeId, activeTeam, slotAgentId, userAgents, t]);
  // Variants reuse the base agent (NORMAL_PROMPT_KEY) with only a runtime
  // override, so their model label mirrors the base config's model.
  const compareModelLabel = useMemo(() => {
    const model =
      userAgents.find((agent) => agent.id === slotAgentId(NORMAL_PROMPT_KEY))?.model ?? null;
    return model ? formatModelLabel(model) : t('home.modelDefault');
  }, [userAgents, slotAgentId, t]);
  // Mount every variant's project so its branch picker can list branches and its
  // host kind resolves (variants default to the already-mounted base project).
  useEffect(() => {
    for (const variant of compareVariants) {
      if (variant.projectId) void projectManager.mountProject(variant.projectId).catch(() => {});
    }
  }, [compareVariants, projectManager]);
  // Local project root, so the skill picker can surface project-local skills
  // alongside the global ones. SSH projects have no local path to scan.
  const skillProjectPath = projectData?.type === 'local' ? projectData.path : undefined;
  const persistedPrompt = draft?.prompt ?? '';
  const [prompt, setPrompt] = useState(persistedPrompt);
  const [promptTokens, setPromptTokens] = useState<PromptToken[]>([]);
  const clearPromptTokens = useCallback(() => {
    setPromptTokens((prev) => {
      for (const token of prev) {
        if (token.previewUrl) URL.revokeObjectURL(token.previewUrl);
      }
      return [];
    });
  }, []);
  const persistPromptTokens = useCallback(
    (next: PromptToken[]) => {
      setPromptTokens(next);
      updateDraft({
        promptTokens: next.map((token) => ({
          kind: token.kind,
          label: token.label,
          path: token.path,
        })),
      });
    },
    [updateDraft]
  );
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
  // the selected branch decides between running in place and checking out an
  // existing local/remote source in a worktree.
  const standardSubmitKind: TaskSubmitStrategyKind =
    effectiveStandardStrategyKind === 'new-branch' ? 'new-branch' : selectedBranchSubmitKind;
  const reviewSubmitKind: TaskSubmitStrategyKind =
    effectiveReviewStrategyKind === 'new-branch' ? 'new-branch' : selectedBranchSubmitKind;
  // Every comparison config is a duplicate of the current base composer config.
  // Entering compare mode (from zero) migrates the base into the list as the
  // first config and adds a second, so all rows are equal and the special base
  // row disappears; later clicks append one more.
  const makeVariantFromBase = useCallback(
    (): CompareVariant => ({
      id: crypto.randomUUID(),
      projectId: selectedProjectId ?? null,
      runtimeId,
      strategyKind: effectiveStandardStrategyKind,
      baseBranch: selectedBranch ?? null,
    }),
    [selectedProjectId, runtimeId, effectiveStandardStrategyKind, selectedBranch]
  );
  const addVariant = useCallback(() => {
    setCompareVariants((prev) => {
      if (prev.length >= MAX_COMPARE_VARIANTS) return prev;
      if (prev.length === 0) return [makeVariantFromBase(), makeVariantFromBase()];
      return [...prev, makeVariantFromBase()];
    });
  }, [makeVariantFromBase]);
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
  // Run-defaults section is collapsed by default — it is rarely changed and its
  // eight rows otherwise dominate the popover.
  const [runDefaultsOpen, setRunDefaultsOpen] = useState(false);
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
  const inputPromptLanguageField = dualField<TaskOutputLanguage>({
    override: composerDefaults?.inputPromptLanguage,
    globalValue: taskSettings?.inputPromptLanguage ?? DEFAULT_INPUT_PROMPT_LANGUAGE,
    setGlobal: (value) => updateTaskSettings({ inputPromptLanguage: value }),
    setOverride: (value) => setComposerDefault('inputPromptLanguage', value),
    hasProject: hasProjectOverrideTarget,
  });
  const namingLanguageField = dualField<TaskOutputLanguage>({
    override: composerDefaults?.namingLanguage,
    globalValue: taskSettings?.namingLanguage ?? DEFAULT_TASK_OUTPUT_LANGUAGE,
    setGlobal: (value) => updateTaskSettings({ namingLanguage: value }),
    setOverride: (value) => setComposerDefault('namingLanguage', value),
    hasProject: hasProjectOverrideTarget,
  });
  const summaryLanguageField = dualField<TaskOutputLanguage>({
    override: composerDefaults?.summaryLanguage,
    globalValue: taskSettings?.summaryLanguage ?? DEFAULT_SUMMARY_OUTPUT_LANGUAGE,
    setGlobal: (value) => updateTaskSettings({ summaryLanguage: value }),
    setOverride: (value) => setComposerDefault('summaryLanguage', value),
    hasProject: hasProjectOverrideTarget,
  });
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
    (runMode === 'team' || (runMode === 'review' && effectiveReviewStrategyKind === 'new-branch'));
  const appPromptLanguage = useMemo(
    () => explicitTaskOutputLanguageFromI18n(i18n.resolvedLanguage ?? i18n.language),
    [i18n.language, i18n.resolvedLanguage]
  );
  const inputPromptLanguage = inputPromptLanguageField.value;
  const rewriteInputRequirement = useCallback(
    async (value: string) => {
      if (!value.trim() || inputPromptLanguage === 'skip' || inputPromptLanguage === 'prompt') {
        return value;
      }
      const result = await rpc.conversations.rewritePrompt({
        prompt: value,
        language: inputPromptLanguage,
        projectId: selectedProjectId ?? null,
        runtimeId: runtimeId ?? null,
        appLanguage: appPromptLanguage,
      });
      return result.prompt;
    },
    [appPromptLanguage, inputPromptLanguage, runtimeId, selectedProjectId]
  );
  const trimmed = prompt.trim();
  // A slot can run only when it has an Agent assigned (the Agent supplies the
  // runtime + prompt). Each mode requires all its slots filled.
  const hasSlotAgent = (slotKey: string) => !!slotAgentId(slotKey);
  const modeHasAgents =
    runMode === 'review'
      ? hasSlotAgent(REVIEW_IMPLEMENTER_PROMPT_KEY) && hasSlotAgent(REVIEW_REVIEWER_PROMPT_KEY)
      : runMode === 'team'
        ? Boolean(activeTeam && activeTeam.members.length > 0)
        : runMode === 'brainstorm'
          ? hasSlotAgent(SPEC_PROMPT_KEY)
          : hasSlotAgent(NORMAL_PROMPT_KEY);
  // Multi-config compare only fires in plain (normal, non-task-scoped) submits;
  // every variant must target a real project before it can spawn a task.
  const compareActive = runMode === 'normal' && !taskScopedTarget && compareVariants.length > 0;
  const compareVariantsReady =
    !compareActive ||
    (Boolean(selectedProjectId) && compareVariants.every((variant) => Boolean(variant.projectId)));
  const featureWorkflowNeedsBrief =
    runMode === 'team' &&
    Boolean(activeTeam && hasFeatureWorkflowContract(activeTeam)) &&
    trimmed.length === 0;
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
    !featureWorkflowNeedsBrief &&
    compareVariantsReady &&
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
      //
      // Serialize the RAW prompt, not `trimmed`: token sentinels are wrapped in
      // en-space (U+2002) delimiters, which `String.trim()` strips — so a
      // boundary token (paste-only, or an image at the very end) would lose its
      // delimiters, fail the sentinel regex, and leak as bare label text with no
      // image attached. Trim the serialized text afterwards, where tokens are
      // already non-whitespace markers/paths and safe to trim around.
      const serialized = serializePromptWithTokens(prompt, promptTokens, {
        imagesAsPaths: attachImagesAsPaths,
      });
      const rawRequirement = serialized.text.trim();
      const deferInitialPrompt =
        rawRequirement.length > 0 &&
        inputPromptLanguage !== 'skip' &&
        inputPromptLanguage !== 'prompt';
      const requirement = rawRequirement;
      const requirementPromise = deferInitialPrompt
        ? rewriteInputRequirement(rawRequirement).catch((error: unknown) => {
            toast({
              title: t('home.promptRewriteFailed'),
              description: promptRewriteFailureDescription(error, t('common.unknownError')),
              variant: 'destructive',
              debugInfo: error,
            });
            return null;
          })
        : Promise.resolve(rawRequirement);
      const imagePaths = serialized.imagePaths.length > 0 ? serialized.imagePaths : undefined;
      const sessionImagePaths = deferInitialPrompt ? undefined : imagePaths;
      const resetComposer = () => {
        setPrompt('');
        updateDraft({ prompt: '', promptTokens: [] });
        clearPromptTokens();
        setCompareVariants([]);
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
      const showDeferredPromptWaitToast = () => {
        let toastId: ReturnType<typeof toast.loading> | undefined;
        const timer = setTimeout(() => {
          toastId = toast.loading(t('home.promptTranslationWaiting'), {
            description: t('home.promptTranslationWaitingDescription'),
          });
        }, 350);
        return () => {
          clearTimeout(timer);
          if (toastId !== undefined) toast.dismiss(toastId);
        };
      };
      const injectDeferredPrompt = async (args: {
        projectId: string;
        taskId: string;
        conversationId: string;
        runtime: RuntimeId;
        buildPrompt: (rewrittenRequirement: string) => string | undefined;
      }): Promise<string | null> => {
        const dismissWaitToast = showDeferredPromptWaitToast();
        try {
          const rewrittenRequirement = await requirementPromise;
          if (rewrittenRequirement === null) return null;
          const sent = await rpc.conversations.injectConversationPrompt({
            projectId: args.projectId,
            taskId: args.taskId,
            conversationId: args.conversationId,
            runtime: args.runtime,
            prompt: args.buildPrompt(rewrittenRequirement),
            imagePaths,
          });
          if (sent) return rewrittenRequirement;
          toast.error(t('home.promptSendFailed'));
          return null;
        } catch {
          toast.error(t('home.promptSendFailed'));
          return null;
        } finally {
          dismissWaitToast();
        }
      };
      const scheduleDeferredPrompt = (args: {
        projectId: string;
        taskId: string;
        conversationId: string;
        runtime: RuntimeId;
        promise: Promise<unknown>;
        buildPrompt: (rewrittenRequirement: string) => string | undefined;
      }) => {
        if (!deferInitialPrompt) return;
        void args.promise
          .then(() => injectDeferredPrompt(args))
          .catch(() => {
            // Creation failures are reported by the caller that owns the launch promise.
          });
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
          model?: string | null;
          skillSelection?: SkillSelectionInput;
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
            deferInitialPrompt,
            imagePaths: sessionImagePaths,
            model: args.model,
            skillSelection: args.skillSelection,
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
            model: slot.agent?.model,
            skillSelection: agentSkillSelection(slot.agent),
          });
          finishTaskConversationSubmit();
          scheduleDeferredPrompt({
            projectId: taskScopedTarget.projectId,
            taskId: taskScopedTarget.taskId,
            conversationId: launch.conversationId,
            runtime: launch.runtime,
            promise: launch.promise,
            buildPrompt: (rewrittenRequirement) =>
              buildSpecPrompt({
                requirement: rewrittenRequirement,
                systemPrompt: slot.systemPrompt,
              }),
          });
          void launch.promise.catch(() => {
            toast.error('Agent conversation failed to start.');
          });
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
            model: implementerSlot.agent?.model,
            skillSelection: agentSkillSelection(implementerSlot.agent),
          });
          finishTaskConversationSubmit();
          const reviewerProvider = reviewerSlot.provider;
          const reviewerSystemPrompt = reviewerSlot.systemPrompt;
          const startReviewOrchestration = (resolvedRequirement: string) =>
            rpc.reviewOrchestration.start({
              projectId: taskScopedTarget.projectId,
              taskId: taskScopedTarget.taskId,
              implementerConversationId: implementation.conversationId,
              requirement: resolvedRequirement,
              reviewerRuntime: reviewerProvider,
              reviewerSystemPrompt,
              reviewerSkillSelection: agentSkillSelection(reviewerSlot.agent),
              reviewerAutoApprove: permissionModes.isDanger(reviewerProvider),
            });
          const reviewPromise = deferInitialPrompt
            ? implementation.promise
                .then(() =>
                  injectDeferredPrompt({
                    projectId: taskScopedTarget.projectId,
                    taskId: taskScopedTarget.taskId,
                    conversationId: implementation.conversationId,
                    runtime: implementation.runtime,
                    buildPrompt: (rewrittenRequirement) =>
                      buildRequirementPrompt({
                        requirement: rewrittenRequirement,
                        systemPrompt: implementerSlot.systemPrompt,
                      }),
                  })
                )
                .then((resolvedRequirement) => {
                  if (resolvedRequirement === null) return undefined;
                  return startReviewOrchestration(resolvedRequirement);
                })
            : implementation.promise.then(() => startReviewOrchestration(requirement));
          void reviewPromise.catch((error: unknown) => {
            toast.error(
              error instanceof Error ? error.message : 'Review mode orchestration failed.'
            );
          });
          return;
        }

        if (runMode === 'team') {
          if (!activeTeam) return;
          const createRoom = (resolvedRequirement: string) =>
            rpc.teamRooms
              .createRoomFromTeam({
                projectId: taskScopedTarget.projectId,
                taskId: taskScopedTarget.taskId,
                teamId: activeTeam.id,
                requirement: resolvedRequirement,
              })
              .then(() =>
                invalidateTeamRoomQueries(
                  queryClient,
                  taskScopedTarget.projectId,
                  taskScopedTarget.taskId
                )
              );
          // Instantiate a chat room from the team template on this task; the
          // conductor drives the iterative @-routing (members appear as the
          // task's conversations).
          try {
            const resolvedRequirement = deferInitialPrompt ? await requirementPromise : requirement;
            if (resolvedRequirement === null) return;
            await createRoom(resolvedRequirement);
            finishTaskConversationSubmit();
          } catch (error) {
            toast.error(
              error instanceof Error ? error.message : 'Agent team orchestration failed.'
            );
          }
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
          model: normalSlot.agent?.model,
          skillSelection: agentSkillSelection(normalSlot.agent),
        });
        finishTaskConversationSubmit();
        scheduleDeferredPrompt({
          projectId: taskScopedTarget.projectId,
          taskId: taskScopedTarget.taskId,
          conversationId: launch.conversationId,
          runtime: launch.runtime,
          promise: launch.promise,
          buildPrompt: (rewrittenRequirement) =>
            normalSystemPrompt
              ? buildRequirementPrompt({
                  requirement: rewrittenRequirement,
                  systemPrompt: normalSystemPrompt,
                })
              : rewrittenRequirement || undefined,
        });
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
        const createPromise = internalProject.taskManager.createTask({
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
            deferInitialPrompt,
            imagePaths: sessionImagePaths,
            model: draftSlot.agent?.model,
            skillSelection: agentSkillSelection(draftSlot.agent),
          },
        });
        scheduleDeferredPrompt({
          projectId: INTERNAL_PROJECT_ID,
          taskId,
          conversationId,
          runtime: draftRuntime,
          promise: createPromise,
          buildPrompt: (rewrittenRequirement) =>
            runMode === 'brainstorm'
              ? buildSpecPrompt({
                  requirement: rewrittenRequirement,
                  systemPrompt: draftSlot.systemPrompt,
                })
              : draftSystemPrompt
                ? buildRequirementPrompt({
                    requirement: rewrittenRequirement,
                    systemPrompt: draftSystemPrompt,
                  })
                : rewrittenRequirement || undefined,
        });
        void createPromise.catch(() => {
          toast.error('Agent task failed to start.');
        });
        goToTask(INTERNAL_PROJECT_ID, taskId);
        resetComposer();
        return;
      }

      // `defaultBranch` is derived from the repository store, which is stale
      // right after the initial-commit modal seeds a brand-new repo (git init +
      // first commit emit a ref change the store hasn't applied yet). Resolve
      // the selected branch from a fresh read so worktree modes get a valid source
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
        model?: string | null;
        skillSelection?: SkillSelectionInput;
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
              ? (selectedBranch ?? baseDefaultBranch)
              : args.strategyKind === 'checkout-existing'
                ? (selectedBranch ?? baseDefaultBranch)
                : parentBranchName
                  ? { type: 'local', branch: parentBranchName }
                  : (selectedBranch ?? baseDefaultBranch),
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
            deferInitialPrompt,
            imagePaths: sessionImagePaths,
            model: args.model,
            skillSelection: args.skillSelection,
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
          model: slot.agent?.model,
          skillSelection: agentSkillSelection(slot.agent),
        });
        goToTask(mounted.data.id, task.taskId);
        scheduleDeferredPrompt({
          projectId: mounted.data.id,
          taskId: task.taskId,
          conversationId: task.conversationId,
          runtime: task.runtime,
          promise: task.promise,
          buildPrompt: (rewrittenRequirement) =>
            buildSpecPrompt({
              requirement: rewrittenRequirement,
              systemPrompt: slot.systemPrompt,
            }),
        });
        void task.promise.catch(() => {
          toast.error('Agent task failed to start.');
        });
        resetComposer();
        return;
      }

      // Multi-config comparison: the base config plus every variant each spawn
      // their own independent task (possibly in different projects), then a
      // detached window tiles them side by side. Each task is a normal task that
      // also lands in its project's sidebar, so closing the window keeps them.
      if (runMode === 'normal' && compareVariants.length > 0 && mounted) {
        type CompareSpec = {
          projectId: string;
          provider: RuntimeId;
          model: string | null | undefined;
          skillSelection?: SkillSelectionInput;
          systemPrompt: string;
          strategyKind: TaskStrategyKind;
          baseBranch: Branch | null;
          nameSeed: string;
        };
        type CompareLaunch = {
          projectId: string;
          taskId: string;
          conversationId: string;
          runtime: RuntimeId;
          systemPrompt: string;
          promise: Promise<unknown>;
        };

        const createForSpec = async (spec: CompareSpec): Promise<CompareLaunch | null> => {
          await projectManager.mountProject(spec.projectId).catch(() => {});
          const target = asMounted(projectManager.projects.get(spec.projectId));
          if (!target) return null;
          // Selected branch: an explicit per-config branch wins; otherwise the
          // routed project reuses the already-resolved branch and other projects
          // start from their own current branch.
          let targetCurrentBranch = spec.projectId === mounted.data.id ? currentBranchName : null;
          const source =
            spec.baseBranch ??
            (spec.projectId === mounted.data.id
              ? (selectedBranch ?? baseDefaultBranch)
              : await rpc.repository.getLocalBranches(spec.projectId).then((local) => {
                  targetCurrentBranch = local.currentBranch;
                  return local.currentBranch
                    ? ({ type: 'local' as const, branch: local.currentBranch } as const)
                    : undefined;
                }));
          if (!source) return null;
          const taskName = ensureUniqueTaskDisplayName(
            spec.nameSeed,
            Array.from(target.taskManager.tasks.values(), (task) => task.data.name)
          );
          const taskId = crypto.randomUUID();
          const conversationId = crypto.randomUUID();
          const strategy =
            spec.strategyKind === 'new-branch'
              ? ({ kind: 'new-branch', taskBranch: taskName, pushBranch: false } as const)
              : branchNeedsCheckout(source, targetCurrentBranch)
                ? ({ kind: 'checkout-existing' } as const)
                : ({ kind: 'no-worktree' } as const);
          const systemPrompt = spec.systemPrompt.trim();
          const promise = target.taskManager.createTask({
            id: taskId,
            projectId: spec.projectId,
            name: taskName,
            sourceBranch: source,
            strategy,
            initialConversation: {
              id: conversationId,
              projectId: spec.projectId,
              taskId,
              runtime: spec.provider,
              title: initialConversationTitle(
                spec.provider,
                trimmed || requirement || undefined,
                []
              ),
              initialPrompt: systemPrompt
                ? buildRequirementPrompt({ requirement, systemPrompt })
                : requirement || undefined,
              deferInitialPrompt,
              imagePaths: sessionImagePaths,
              model: spec.model,
              skillSelection: spec.skillSelection,
            },
          });
          return {
            projectId: spec.projectId,
            taskId,
            conversationId,
            runtime: spec.provider,
            systemPrompt,
            promise,
          };
        };

        // Every config is an equal row in the list (the base was migrated in when
        // compare mode was entered); they all share the composer prompt.
        const specs: CompareSpec[] = compareVariants.flatMap((variant, index): CompareSpec[] => {
          if (!variant.projectId) return [];
          const slot = resolveSlot(NORMAL_PROMPT_KEY, variant.runtimeId);
          if (!slot.provider) return [];
          return [
            {
              projectId: variant.projectId,
              provider: slot.provider,
              model: slot.agent?.model,
              skillSelection: agentSkillSelection(slot.agent),
              systemPrompt: slot.systemPrompt,
              strategyKind: variant.strategyKind,
              baseBranch: variant.baseBranch,
              nameSeed: `${baseName}-${index + 1}`,
            },
          ];
        });

        const results = (await Promise.all(specs.map(createForSpec))).filter(
          (r): r is CompareLaunch => r !== null
        );
        if (results.length === 0) return;

        resetComposer();
        const base = results[0];
        if (base) goToTask(base.projectId, base.taskId);
        for (const result of results) {
          scheduleDeferredPrompt({
            projectId: result.projectId,
            taskId: result.taskId,
            conversationId: result.conversationId,
            runtime: result.runtime,
            promise: result.promise,
            buildPrompt: (rewrittenRequirement) =>
              result.systemPrompt
                ? buildRequirementPrompt({
                    requirement: rewrittenRequirement,
                    systemPrompt: result.systemPrompt,
                  })
                : rewrittenRequirement || undefined,
          });
        }
        void rpc.app.openComparisonWindow({
          panes: results.map((r) => ({ projectId: r.projectId, taskId: r.taskId })),
          layout: { kind: 'columns', count: results.length },
        });
        void Promise.allSettled(results.map((r) => r.promise)).then(reportFailures);
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
          model: implementerSlot.agent?.model,
          skillSelection: agentSkillSelection(implementerSlot.agent),
        });
        goToTask(mounted.data.id, implementation.taskId);
        const reviewerProvider = reviewerSlot.provider;
        const reviewerSystemPrompt = reviewerSlot.systemPrompt;
        const startReviewOrchestration = (resolvedRequirement: string) =>
          rpc.reviewOrchestration.start({
            projectId: mounted.data.id,
            taskId: implementation.taskId,
            implementerConversationId: implementation.conversationId,
            requirement: resolvedRequirement,
            reviewerRuntime: reviewerProvider,
            reviewerSystemPrompt,
            reviewerSkillSelection: agentSkillSelection(reviewerSlot.agent),
            reviewerAutoApprove: permissionModes.isDanger(reviewerProvider),
          });
        const reviewPromise = deferInitialPrompt
          ? implementation.promise
              .then(() =>
                injectDeferredPrompt({
                  projectId: mounted.data.id,
                  taskId: implementation.taskId,
                  conversationId: implementation.conversationId,
                  runtime: implementation.runtime,
                  buildPrompt: (rewrittenRequirement) =>
                    buildRequirementPrompt({
                      requirement: rewrittenRequirement,
                      systemPrompt: implementerSlot.systemPrompt,
                    }),
                })
              )
              .then((resolvedRequirement) => {
                if (resolvedRequirement === null) return undefined;
                return startReviewOrchestration(resolvedRequirement);
              })
          : implementation.promise.then(() => startReviewOrchestration(requirement));
        void reviewPromise.catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : 'Review mode orchestration failed.');
        });
        resetComposer();
        return;
      }

      if (runMode === 'team') {
        if (!activeTeam) return;
        const teamId = activeTeam.id;
        // Bare task (no initial conversation) — the room conductor instantiates
        // the team and populates the task's conversations via iterative @-routing.
        const taskId = crypto.randomUUID();
        const taskName = reserveTaskName(baseName);
        const createPromise = mounted.taskManager.createTask({
          id: taskId,
          projectId: mounted.data.id,
          name: taskName,
          sourceBranch: selectedBranch ?? baseDefaultBranch,
          strategy: { kind: 'new-branch', taskBranch: taskName, pushBranch: false },
          parentTaskId: parentTarget?.taskId,
        });
        goToTask(mounted.data.id, taskId);
        const createRoom = async (resolvedRequirement: string) => {
          const roomId = await rpc.teamRooms.createRoomFromTeam({
            projectId: mounted.data.id,
            taskId,
            teamId,
            requirement: resolvedRequirement,
          });
          await invalidateTeamRoomQueries(queryClient, mounted.data.id, taskId);
          return roomId;
        };
        const assertTaskReady = () => {
          if (!asProvisioned(getTaskStore(mounted.data.id, taskId))) {
            throw new Error(t('home.teamTaskSetupIncomplete'));
          }
        };
        const roomPromise = deferInitialPrompt
          ? createPromise.then(async () => {
              assertTaskReady();
              const resolvedRequirement = await requirementPromise;
              if (resolvedRequirement === null) return undefined;
              return createRoom(resolvedRequirement);
            })
          : createPromise.then(() => {
              assertTaskReady();
              return createRoom(requirement);
            });
        try {
          const roomId = await roomPromise;
          if (roomId !== undefined) resetComposer();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Agent team orchestration failed.');
        }
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
        model: normalSlot.agent?.model,
        skillSelection: agentSkillSelection(normalSlot.agent),
      });
      goToTask(mounted.data.id, task.taskId);
      scheduleDeferredPrompt({
        projectId: mounted.data.id,
        taskId: task.taskId,
        conversationId: task.conversationId,
        runtime: task.runtime,
        promise: task.promise,
        buildPrompt: (rewrittenRequirement) =>
          normalSystemPrompt
            ? buildRequirementPrompt({
                requirement: rewrittenRequirement,
                systemPrompt: normalSystemPrompt,
              })
            : rewrittenRequirement || undefined,
      });
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
    parentTarget,
    parentBranchName,
    targetProvisionedTask,
    runtimeId,
    defaultBranch,
    currentBranchName,
    selectedBranch,
    promptTokens,
    attachImagesAsPaths,
    inputPromptLanguage,
    rewriteInputRequirement,
    clearPromptTokens,
    reviewSubmitKind,
    standardSubmitKind,
    prompt,
    trimmed,
    submitting,
    runMode,
    compareVariants,
    reviewerRuntime,
    activeTeam,
    queryClient,
    userAgents,
    slotAgentId,
    permissionModes,
    t,
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

  const promptInputChrome = getRunModeInputChrome(runMode);
  const renderSystemPromptSection = (activeRuntimeId: RuntimeId): ReactNode => {
    const runtime = getRuntime(activeRuntimeId);
    if (!runtime?.appendSystemPromptFlag && !runtime?.appendSystemPromptConfigKey) return null;
    const hintKey =
      activeRuntimeId === 'codex'
        ? 'home.systemPromptHintCodex'
        : runtime.appendSystemPromptFlag === '--append-system-prompt'
          ? 'home.systemPromptHintClaude'
          : 'home.systemPromptHint';

    return (
      <div className="flex flex-col gap-1">
        <ComposerSettingsHeader
          label={t('home.systemPromptLabel')}
          hint={t(hintKey)}
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
                      content={<span className="whitespace-pre-wrap">{principle.text}</span>}
                    />
                  ) : null}
                </div>
                <Switch
                  size="sm"
                  checked={principle.enabled}
                  onCheckedChange={(checked) => setProjectPrincipleEnabled(principle.id, checked)}
                  aria-label={t('settings.prompts.toggle')}
                />
              </div>
            ))}
          </>
        ) : null}
      </div>
    );
  };

  // The composer-settings gear belongs to a config row (the base row in normal
  // mode, every config row in compare mode), so it is a render helper reused
  // across rows rather than a single global control.
  const renderComposerSettingsButton = (): ReactNode => (
    <Popover>
      <PopoverTrigger
        aria-label={t('home.composerSettingsAria')}
        title={t('home.composerSettingsAria')}
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background-1 px-2.5 text-xs text-foreground transition-colors hover:bg-background-2 hover:text-foreground"
      >
        <Settings2 className="size-3.5 text-foreground-muted" />
        <span className="hidden @lg/composer:inline">{t('home.composerSettingsLabel')}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 gap-0 p-2.5">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="text-xs text-foreground">{t('home.attachImagesAsPathsLabel')}</span>
              <InfoTooltip
                label={t('home.attachImagesAsPathsLabel')}
                content={t('home.attachImagesAsPathsDesc')}
              />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Switch
                size="sm"
                checked={attachImagesAsPaths}
                onCheckedChange={attachImagesField.setValue}
              />
            </div>
          </div>
          <ComposerScopeSelectRow
            label={t('settings.tasks.inputPromptLanguageLabel')}
            value={inputPromptLanguageField.value}
            options={INPUT_PROMPT_ENABLED_LANGUAGE_OPTIONS}
            disabledValues={['skip', 'prompt']}
            onValueChange={inputPromptLanguageField.setValue}
          />
          <ComposerScopeSelectRow
            label={t('settings.tasks.sessionTitleLanguageLabel')}
            value={namingLanguageField.value}
            options={TASK_OUTPUT_ENABLED_LANGUAGE_OPTIONS}
            onValueChange={namingLanguageField.setValue}
          />
          <ComposerScopeSelectRow
            label={t('settings.tasks.summaryLanguageLabel')}
            value={summaryLanguageField.value}
            options={TASK_OUTPUT_ENABLED_LANGUAGE_OPTIONS}
            onValueChange={summaryLanguageField.setValue}
          />
        </div>
        {runtimeId && (
          <div className="mt-2 flex flex-col gap-2 border-t border-border/60 pt-2">
            <ComposerSettingsHeader
              label={`${t('home.agentCliConfigLabel')} · ${getRuntime(runtimeId)?.name ?? runtimeId}`}
              hint={t('home.agentCliConfigHint')}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="text-xs text-foreground">{t('home.permissionModeLabel')}</span>
                <InfoTooltip
                  label={t('home.permissionModeLabel')}
                  content={t('home.permissionModeDesc')}
                />
              </div>
              <PermissionModeSelect
                runtimeId={runtimeId}
                className="shrink-0"
                contentPortaled={false}
                alignContentWithTrigger={false}
              />
            </div>
            {renderSystemPromptSection(runtimeId)}
            <InstructionFilesSection runtimeId={runtimeId} projectPath={skillProjectPath} />
          </div>
        )}
        <Collapsible
          open={runDefaultsOpen}
          onOpenChange={setRunDefaultsOpen}
          className="mt-2 flex flex-col gap-1 border-t border-border/60 pt-2"
        >
          <CollapsibleTrigger
            title={t('home.composerRunDefaultsHint')}
            className="group flex items-center justify-between gap-2 text-left"
          >
            <MicroLabel className="text-[10px]">{t('home.composerRunDefaultsLabel')}</MicroLabel>
            <ChevronDown
              className={cn(
                'size-3.5 shrink-0 text-foreground-passive transition-transform',
                runDefaultsOpen && 'rotate-180'
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-1">
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
                setComposerDefault('runMode', scope === 'project' ? persistedRunMode : undefined)
              }
            />
            <ComposerScopeRow
              label={t('home.composerDefaultBaseBranchLabel')}
              value={selectedBranchLabel}
              source={baseBranchOverridden ? 'project' : 'global'}
              canOverride={hasProjectOverrideTarget}
              onChange={(scope) =>
                setComposerDefault(
                  'baseBranch',
                  scope === 'project' && selectedBranch
                    ? {
                        type: selectedBranch.type,
                        branch: selectedBranch.branch,
                        ...(selectedBranch.type === 'remote'
                          ? { remoteName: selectedBranch.remote.name }
                          : {}),
                      }
                    : undefined
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
            <ComposerScopeRow
              label={t('home.composerDefaultReviewStrategyLabel')}
              source={reviewStrategyOverridden ? 'project' : 'global'}
              canOverride={hasProjectOverrideTarget}
              onChange={(scope) =>
                setComposerDefault(
                  'reviewStrategyKind',
                  scope === 'project' ? reviewStrategyKind : undefined
                )
              }
            />
            <ComposerScopeRow
              label={t('home.composerDefaultReviewerLabel')}
              value={getRuntime(reviewerRuntime)?.name ?? reviewerRuntime}
              source={reviewerOverridden ? 'project' : 'global'}
              canOverride={hasProjectOverrideTarget}
              onChange={(scope) =>
                setComposerDefault(
                  'reviewerRuntime',
                  scope === 'project' ? reviewerRuntime : undefined
                )
              }
            />
          </CollapsibleContent>
        </Collapsible>
      </PopoverContent>
    </Popover>
  );

  // "+ 对比" sits at the end of the first config row (the base row in normal
  // mode, the first config row in compare mode), never on its own line.
  const renderAddCompareButton = (): ReactNode => (
    <button
      type="button"
      aria-label={t('home.addCompareVariant')}
      title={t('home.addCompareVariantTooltip')}
      onClick={addVariant}
      disabled={compareVariants.length >= MAX_COMPARE_VARIANTS}
      className="ml-auto flex h-7 items-center gap-1.5 rounded-md border border-border bg-background-1 px-2.5 text-xs text-foreground transition-colors hover:bg-background-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <GitCompare className="size-3.5 text-foreground-muted" />
      <span className="hidden @lg/composer:inline">{t('home.addCompareVariant')}</span>
    </button>
  );

  return (
    <div className={className}>
      <ComposerPromptInput
        value={prompt}
        onChange={setPrompt}
        tokens={promptTokens}
        onTokensChange={persistPromptTokens}
        runtimeId={runtimeId}
        projectId={projectData?.id ?? null}
        projectPath={skillProjectPath}
        skillSelection={composerSkillSelection}
        runHostKind={runHostKind}
        containerClassName={promptInputChrome.containerClassName}
        canSubmit={canSubmit}
        onSubmit={submit}
        autoFocus
      />

      <div className="@container/composer mt-3 flex flex-col gap-2">
        {/* Toolbar chips wrap to extra rows in narrow hosts — never min-w-max +
            overflow-x-auto: macOS overlay scrollbars make clipped chips invisible.
            Chip text labels collapse to icon-only below the @lg container width. */}
        {/* Compare mode: the base config is migrated into this uniform, reorderable
            list, so every row is an equal config. The plain base chip row below is
            hidden while comparing. */}
        {!taskScopedTarget && runMode === 'normal' && compareVariants.length > 0 && (
          <div className="flex flex-col gap-2">
            {compareVariants.map((variant, index) => {
              const variantRunHostKind: RunHostKind =
                asMounted(
                  variant.projectId ? projectManager.projects.get(variant.projectId) : undefined
                )?.data.type === 'ssh'
                  ? 'ssh'
                  : 'local';
              return (
                <CompareVariantRow
                  key={variant.id}
                  variant={variant}
                  strategyLabels={strategyLabels}
                  runHostKind={variantRunHostKind}
                  modelLabel={compareModelLabel}
                  renderSettings={renderComposerSettingsButton}
                  trailing={index === 0 ? renderAddCompareButton() : undefined}
                  onChange={(patch) => {
                    updateVariant(variant.id, patch);
                    // The first compare row is the migrated base configuration.
                    // Selecting its project must also restore the base selection
                    // so the normal submit path can mount and launch the group.
                    if (index === 0 && patch.projectId !== undefined) {
                      setSelectedProjectId(patch.projectId ?? undefined);
                    }
                  }}
                  onRunHostChange={(nextKind) => {
                    if (nextKind === variantRunHostKind) return;
                    const nextProjectId = findProjectIdByRunHost(nextKind);
                    if (nextProjectId)
                      updateVariant(variant.id, { projectId: nextProjectId, baseBranch: null });
                    else openAddProjectForRunHost(nextKind);
                  }}
                  onRemove={() => removeVariant(variant.id)}
                  onReorder={reorderVariant}
                />
              );
            })}
          </div>
        )}
        {compareVariants.length === 0 && (
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
            <RunHostSelector
              kind={runHostKind}
              onSelectKind={isProjectLocked ? undefined : selectRunHostProject}
            />
            {runMode === 'brainstorm' && <Chip icon={Lightbulb}>{t('home.brainstormPolicy')}</Chip>}
            {!taskScopedTarget && mounted && runMode === 'team' && (
              <Chip icon={GitFork}>{t('home.teamBranchPolicy')}</Chip>
            )}
            {!taskScopedTarget && mounted && runMode === 'normal' && (
              <BranchStrategyChips
                projectId={mounted.data.id}
                strategyKind={effectiveStandardStrategyKind}
                locked={Boolean(parentBranchName)}
                forkDisabled={isUnborn}
                branchValue={selectedBranch}
                branchLabel={selectedBranchLabel}
                branchRunsInPlace={selectedBranchRunsInPlace}
                onBranchChange={setBaseBranch}
                onForkChange={(forked) => setStrategyKind(forked ? 'new-branch' : 'no-worktree')}
                forkLabels={strategyLabels}
                baseBranchAriaLabel={t('home.baseBranchAria')}
                forkAriaLabel={t('home.strategyAria')}
              />
            )}
            {!taskScopedTarget && mounted && runMode === 'review' && (
              <BranchStrategyChips
                projectId={mounted.data.id}
                strategyKind={effectiveReviewStrategyKind}
                locked={Boolean(parentBranchName)}
                forkDisabled={isUnborn}
                branchValue={selectedBranch}
                branchLabel={selectedBranchLabel}
                branchRunsInPlace={selectedBranchRunsInPlace}
                onBranchChange={setBaseBranch}
                onForkChange={(forked) =>
                  setReviewStrategyKind(forked ? 'new-branch' : 'no-worktree')
                }
                forkLabels={reviewStrategyLabels}
                baseBranchAriaLabel={t('home.baseBranchAria')}
                forkAriaLabel={t('home.reviewStrategyAria')}
              />
            )}
            <RunModeSelector
              mode={runMode}
              summary={runModeSummary}
              teams={teams}
              selectedTeamId={selectedTeamId}
              onChange={setRunMode}
              onSelectTeam={setSelectedTeamId}
              renderConfiguration={(configurationMode, configurationTeamId, onRuntimeChange) => (
                <ModeConfigurationPanel
                  mode={configurationMode}
                  runtimeId={runtimeId}
                  onRuntimeChange={(agent) => {
                    setRuntimeOverride(agent);
                    onRuntimeChange();
                  }}
                  reviewerRuntime={reviewerRuntime}
                  onReviewerProviderChange={(provider) => {
                    setReviewerProvider(provider);
                    onRuntimeChange();
                  }}
                  teams={teams}
                  selectedTeamId={configurationTeamId ?? selectedTeamId}
                  agents={userAgents}
                  slotAgentId={slotAgentId}
                  onSlotAgentChange={setSlotAgent}
                  connectionId={connectionId}
                  className="mt-2 border-t-0 pt-0"
                />
              )}
            />
            {renderComposerSettingsButton()}
            {runMode === 'normal' && renderAddCompareButton()}
          </div>
        )}
      </div>
    </div>
  );
});

/** DnD payload type for reordering comparison variant rows by drag handle. */
const VARIANT_DND_TYPE = 'application/x-yoda-compare-variant';

/**
 * One extra comparison environment under the base composer row. Mirrors the base
 * row's config chips (project · host · branch · fork · runtime/model) plus a
 * per-variant prompt override, and a left drag handle to reorder the variants.
 * Empty fields fall back to the base config at submit time.
 */
function CompareVariantRow({
  variant,
  strategyLabels,
  runHostKind,
  modelLabel,
  renderSettings,
  trailing,
  onChange,
  onRunHostChange,
  onRemove,
  onReorder,
}: {
  variant: CompareVariant;
  strategyLabels: StrategyChipLabels;
  runHostKind: RunHostKind;
  modelLabel: string;
  renderSettings: () => ReactNode;
  trailing?: ReactNode;
  onChange: (patch: Partial<CompareVariant>) => void;
  onRunHostChange?: (kind: RunHostKind) => void;
  onRemove: () => void;
  onReorder: (fromId: string, toId: string) => void;
}) {
  const { t } = useTranslation();
  const [dragOver, setDragOver] = useState(false);
  const forking = variant.strategyKind === 'new-branch';
  return (
    <div
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(VARIANT_DND_TYPE)) return;
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        const fromId = event.dataTransfer.getData(VARIANT_DND_TYPE);
        setDragOver(false);
        if (fromId) onReorder(fromId, variant.id);
      }}
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-md',
        dragOver && 'ring-1 ring-primary/40'
      )}
    >
      <button
        type="button"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(VARIANT_DND_TYPE, variant.id);
        }}
        aria-label={t('home.reorderCompareVariant')}
        title={t('home.reorderCompareVariant')}
        className="flex size-7 shrink-0 cursor-grab items-center justify-center rounded-md text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="size-3.5" />
      </button>
      <ProjectSelector
        value={variant.projectId ?? undefined}
        onChange={(id) => onChange({ projectId: id ?? null, baseBranch: null })}
        initializeGitRepositoryOnPick
        trigger={
          <ComboboxTrigger className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background-1 px-2.5 text-xs text-foreground transition-colors hover:bg-background-2">
            <FolderOpen className="size-3.5 text-foreground-muted" />
            <ComboboxValue placeholder={t('home.selectProjectPlaceholder')} />
          </ComboboxTrigger>
        }
      />
      {variant.projectId && <RunHostSelector kind={runHostKind} onSelectKind={onRunHostChange} />}
      {variant.projectId && (
        <BaseBranchChip
          projectId={variant.projectId}
          locked={false}
          value={variant.baseBranch ?? undefined}
          label=""
          inPlace={false}
          onChange={(branch) => onChange({ baseBranch: branch })}
          ariaLabel={t('home.baseBranchAria')}
        />
      )}
      <ForkSwitchChip
        checked={forking}
        disabled={false}
        onChange={(forked) => onChange({ strategyKind: forked ? 'new-branch' : 'no-worktree' })}
        ariaLabel={t('home.strategyAria')}
        labels={strategyLabels}
      />
      <RuntimePickerChip
        value={variant.runtimeId}
        modelLabel={modelLabel}
        onChange={(id) => onChange({ runtimeId: id })}
      />
      {renderSettings()}
      <button
        type="button"
        aria-label={t('home.removeCompareVariant')}
        title={t('home.removeCompareVariant')}
        onClick={onRemove}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
      {trailing}
    </div>
  );
}

/** Compact runtime · model picker for a comparison variant (runtime override). */
function RuntimePickerChip({
  value,
  modelLabel,
  onChange,
}: {
  value: RuntimeId | null;
  modelLabel: string;
  onChange: (id: RuntimeId) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const runtimeName = value ? (getRuntime(value)?.name ?? value) : t('home.agentLabel');
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background-1 px-2.5 text-xs text-foreground transition-colors hover:bg-background-2">
        <Bot className="size-3.5 text-foreground-muted" />
        <span>{`${runtimeName} · ${modelLabel}`}</span>
        <ChevronDown className="size-3 text-foreground-muted" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-1">
        {RUNTIME_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              onChange(id);
              setOpen(false);
            }}
            className={cn(
              'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-background-2',
              value === id && 'bg-background-2'
            )}
          >
            <span>{getRuntime(id)?.name ?? id}</span>
            {value === id && <Check className="size-3.5 text-foreground-muted" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** Optional per-variant prompt override; empty inherits the base prompt. */
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
  if (disabled) return null;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={
        isProject ? t('home.composerScopeOverrideTooltip') : t('home.composerScopeInheritTooltip')
      }
      title={
        isProject ? t('home.composerScopeOverrideTooltip') : t('home.composerScopeInheritTooltip')
      }
      onClick={() => onChange(isProject ? 'global' : 'project')}
      className={cn(
        'flex h-5 shrink-0 items-center rounded-full border text-[10px] font-medium transition-colors',
        isProject
          ? 'border-primary/40 bg-primary/10 px-1.5 text-primary'
          : 'w-5 justify-center border-border bg-background-1 text-foreground-passive hover:bg-background-2 hover:text-foreground',
        disabled && 'pointer-events-none opacity-40'
      )}
    >
      {isProject ? t('home.composerScopeProject') : <Folder className="size-3" />}
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

function taskOutputLanguageLabel(t: ReturnType<typeof useTranslation>['t'], value: string): string {
  switch (value) {
    case 'skip':
      return t('settings.tasks.namingLanguageSkip');
    case 'app':
      return t('settings.tasks.namingLanguageApp');
    case 'prompt':
      return t('settings.tasks.namingLanguagePrompt');
    case 'zh-CN':
      return t('settings.tasks.namingLanguageZh');
    case 'en':
      return t('settings.tasks.namingLanguageEn');
    default:
      return value;
  }
}

function explicitTaskOutputLanguageFromI18n(language?: string | null): ExplicitTaskOutputLanguage {
  return language?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

function ComposerScopeSelectRow({
  label,
  value,
  options,
  disabledValues = ['skip'],
  onValueChange,
}: {
  label: string;
  value: TaskOutputLanguage;
  options: TaskOutputLanguage[];
  disabledValues?: TaskOutputLanguage[];
  onValueChange: (value: TaskOutputLanguage) => void;
}) {
  const { t } = useTranslation();
  const enabled = !disabledValues.includes(value);
  return (
    <div
      className={cn(
        'flex min-h-8 items-center justify-between gap-3 rounded-md py-1 transition-colors',
        enabled ? 'bg-background-1/50' : 'bg-transparent'
      )}
    >
      <span
        className={cn(
          'min-w-0 truncate text-xs transition-colors',
          enabled ? 'text-foreground' : 'text-foreground-passive'
        )}
      >
        {label}
      </span>
      <div className="flex shrink-0 items-center justify-end gap-1.5">
        {enabled ? (
          <Select value={value} onValueChange={(next) => onValueChange(next as TaskOutputLanguage)}>
            <SelectTrigger size="sm" className="h-6 w-28 text-[11px]">
              <SelectValue>{taskOutputLanguageLabel(t, value)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option} value={option}>
                  {taskOutputLanguageLabel(t, option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Switch
          size="sm"
          checked={enabled}
          aria-label={t(
            enabled ? 'home.composerLanguageCallDisable' : 'home.composerLanguageCallEnable',
            {
              label,
            }
          )}
          title={t(
            enabled ? 'home.composerLanguageCallDisable' : 'home.composerLanguageCallEnable',
            {
              label,
            }
          )}
          onCheckedChange={(next) => onValueChange(next ? 'app' : 'skip')}
        />
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
 * Composer-settings view onto the human-authored instruction files that the
 * selected runtime CLI reads before the next session starts. The data source is
 * runtime-aware: Claude-compatible CLIs expose CLAUDE.md files, while Codex
 * exposes AGENTS.md files.
 */
function InstructionFilesSection({
  runtimeId,
  projectPath,
}: {
  runtimeId: RuntimeId;
  projectPath?: string;
}) {
  const { t } = useTranslation();
  const runtimeCli = getRuntime(runtimeId)?.cli;
  const supportsInstructionFiles = runtimeCli === 'claude' || runtimeCli === 'codex';
  const hintKey =
    runtimeCli === 'codex'
      ? 'home.instructionFilesHintCodex'
      : runtimeCli === 'claude'
        ? 'home.instructionFilesHintClaude'
        : 'home.instructionFilesHint';
  const { data: files = [] } = useQuery<RuntimeInstructionFile[]>({
    queryKey: ['instructionFiles', runtimeId, projectPath ?? null],
    queryFn: () => rpc.conversations.getRuntimeInstructionFiles({ runtimeId, cwd: projectPath }),
    enabled: supportsInstructionFiles,
    refetchOnWindowFocus: false,
  });

  if (!supportsInstructionFiles) return null;

  return (
    <div className="flex flex-col gap-1">
      <ComposerSettingsHeader label={t('home.instructionFilesLabel')} hint={t(hintKey)} />
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
  onSelectKind?: (kind: RunHostKind) => void;
}

interface RunModeOption {
  // Stable per-entry id — what we key and select on. A single mode can surface as
  // several entries (every Agent Team is its own `team` entry), so identity lives
  // on the entry, not the mode; `mode` (+ `teamId`) still drive the run behavior.
  id: string;
  mode: HomeRunMode;
  /** Set on `team` entries — the Agent Team this entry launches. */
  teamId?: string;
  /** Lucide icon for static entries. Mutually exclusive with `emoji`. */
  icon?: ComponentType<{ className?: string }>;
  /** Emoji glyph for team entries (matches AgentTeam.icon). */
  emoji?: string;
  /** i18n key for static entries. Mutually exclusive with `label`. */
  labelKey?: string;
  /** Literal label for team entries (the team name). */
  label?: string;
  descKey: string;
  alpha?: boolean;
}

// Static entries. "Workflow" runs a single converged session; "compare" stands
// alone because it fans the same task out across isolated branches. The
// "Multi-agent" group sits between them and is built dynamically from the Agent
// Teams (see buildRunModeGroups) — every team is its own independent entry.
const WORKFLOW_RUN_MODE_OPTIONS: RunModeOption[] = [
  {
    id: 'normal',
    mode: 'normal',
    icon: Bot,
    labelKey: 'home.modeNormal',
    descKey: 'home.modeNormalDesc',
  },
  {
    id: 'review-workflow',
    mode: 'review',
    icon: Repeat2,
    labelKey: 'home.modeReview',
    descKey: 'home.modeReviewDesc',
  },
  {
    id: 'brainstorm',
    mode: 'brainstorm',
    icon: Lightbulb,
    labelKey: 'home.modeBrainstorm',
    descKey: 'home.modeBrainstormDesc',
    alpha: true,
  },
];

// Localized copy for the built-in teams so the zh/en picker reads naturally
// rather than echoing the raw template name. User teams fall back to their name.
const BUILTIN_TEAM_COPY: Record<string, { labelKey: string; descKey: string }> = {
  [BUILTIN_FEATURE_TEAM_ID]: {
    labelKey: 'home.modeTeamFeature',
    descKey: 'home.modeTeamFeatureDesc',
  },
  [BUILTIN_REVIEW_TEAM_ID]: {
    labelKey: 'home.modeTeamReview',
    descKey: 'home.modeTeamReviewDesc',
  },
  [BUILTIN_STARTUP_TEAM_ID]: {
    labelKey: 'home.modeTeamStartup',
    descKey: 'home.modeTeamStartupDesc',
  },
};

function teamToRunModeOption(team: AgentTeam): RunModeOption {
  const copy = BUILTIN_TEAM_COPY[team.id];
  return {
    id: `team:${team.id}`,
    mode: 'team',
    teamId: team.id,
    emoji: team.icon,
    ...(copy ? { labelKey: copy.labelKey } : { label: team.name }),
    descKey: copy?.descKey ?? 'home.modeTeamDesc',
    // Honors the original "startup is alpha" call; the review team is GA.
    alpha: team.id === BUILTIN_STARTUP_TEAM_ID,
  };
}

// Display name for a team across the composer (picker + summary chip): localized
// for built-ins, the user-given name otherwise.
function teamDisplayName(team: AgentTeam, t: (key: string) => string): string {
  const copy = BUILTIN_TEAM_COPY[team.id];
  return copy ? t(copy.labelKey) : team.name;
}

// Multi-agent teams in a stable order: the review-loop team leads, the startup
// company team follows, then any user-defined teams in list order. Feature is a
// team under the hood but is intentionally surfaced in the Workflow group.
function orderMultiAgentTeams(teams: AgentTeam[]): AgentTeam[] {
  const pinned = [BUILTIN_REVIEW_TEAM_ID, BUILTIN_STARTUP_TEAM_ID];
  const lead = pinned
    .map((id) => teams.find((tm) => tm.id === id))
    .filter((tm): tm is AgentTeam => Boolean(tm));
  const rest = teams.filter((tm) => !pinned.includes(tm.id));
  return [...lead, ...rest];
}

function buildRunModeGroups(
  teams: AgentTeam[]
): Array<{ labelKey: string; options: RunModeOption[] }> {
  const feature = teams.find((team) => team.id === BUILTIN_FEATURE_TEAM_ID);
  const workflowOptions = feature
    ? [
        WORKFLOW_RUN_MODE_OPTIONS[0],
        teamToRunModeOption(feature),
        ...WORKFLOW_RUN_MODE_OPTIONS.slice(1),
      ]
    : WORKFLOW_RUN_MODE_OPTIONS;
  return [
    { labelKey: 'home.modeGroupWorkflow', options: workflowOptions },
    {
      labelKey: 'home.modeGroupMultiAgent',
      options: orderMultiAgentTeams(
        teams.filter((team) => team.id !== BUILTIN_FEATURE_TEAM_ID)
      ).map(teamToRunModeOption),
    },
  ];
}

// The entry that represents the committed (mode, selectedTeamId) pair. For `team`
// the team id disambiguates which of the many team entries is active.
function entryIdForState(
  options: RunModeOption[],
  mode: HomeRunMode,
  selectedTeamId: string
): string {
  const match =
    mode === 'team'
      ? (options.find((o) => o.teamId === selectedTeamId) ?? options.find((o) => o.mode === 'team'))
      : options.find((o) => o.mode === mode);
  return (match ?? options[0]).id;
}

interface RunModeSelectorProps {
  mode: HomeRunMode;
  summary?: string | null;
  teams: AgentTeam[];
  selectedTeamId: string;
  onChange: (mode: HomeRunMode) => void;
  onSelectTeam: (teamId: string) => void;
  renderConfiguration: (
    mode: HomeRunMode,
    teamId: string | undefined,
    onRuntimeChange: () => void
  ) => ReactNode;
}

function RunModeSelector({
  mode,
  summary,
  teams,
  selectedTeamId,
  onChange,
  onSelectTeam,
  renderConfiguration,
}: RunModeSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => buildRunModeGroups(teams), [teams]);
  const options = useMemo(() => groups.flatMap((group) => group.options), [groups]);
  // The mode change reshapes the whole development paradigm, so we stage it locally
  // and only commit on explicit confirmation rather than applying on each click.
  // We stage by entry id since a mode (notably `team`) spans many entries.
  const [pendingId, setPendingId] = useState<string>(() =>
    entryIdForState(options, mode, selectedTeamId)
  );
  const [runtimeDirty, setRuntimeDirty] = useState(false);
  const labelOf = (option: RunModeOption) =>
    option.label ?? (option.labelKey ? t(option.labelKey) : '');
  const current =
    options.find((option) => option.id === entryIdForState(options, mode, selectedTeamId)) ??
    options[0];
  const pending = options.find((option) => option.id === pendingId) ?? options[0];
  const CurrentIcon = current.icon;
  const PendingIcon = pending.icon;
  const dirty =
    runtimeDirty ||
    pending.mode !== mode ||
    (pending.mode === 'team' && pending.teamId !== selectedTeamId);
  const isNonStandardMode = mode !== 'normal';

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setPendingId(entryIdForState(options, mode, selectedTeamId));
      setRuntimeDirty(false);
    }
    setOpen(next);
  };

  const handleConfirm = () => {
    if (pending.teamId) onSelectTeam(pending.teamId);
    if (pending.mode !== mode) onChange(pending.mode);
    setRuntimeDirty(false);
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
            {current.emoji ? (
              <span className="shrink-0 text-sm leading-none">{current.emoji}</span>
            ) : (
              CurrentIcon && <CurrentIcon className="size-3.5 shrink-0" />
            )}
            <span className="shrink-0">{labelOf(current)}</span>
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
            {groups.map((group, groupIndex) => (
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
                  const active = option.id === pendingId;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      title={t(option.descKey)}
                      onClick={() => setPendingId(option.id)}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                        active
                          ? 'bg-primary/10 font-medium text-primary'
                          : 'text-foreground-muted hover:bg-background-2 hover:text-foreground'
                      )}
                    >
                      {option.emoji ? (
                        <span className="size-4 shrink-0 text-center text-sm leading-4">
                          {option.emoji}
                        </span>
                      ) : (
                        Icon && (
                          <Icon
                            className={cn(
                              'size-4 shrink-0',
                              active ? 'text-primary' : 'text-foreground-muted'
                            )}
                          />
                        )
                      )}
                      <span className="min-w-0 flex-1 truncate">{labelOf(option)}</span>
                      {option.alpha && (
                        <Badge variant="secondary" className="shrink-0 px-1 py-0 text-[9px]">
                          {t('home.modeAlphaBadge')}
                        </Badge>
                      )}
                      {active && <Check className="size-3.5 shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
            <div className="flex items-center gap-2">
              {pending.emoji ? (
                <span className="size-4 shrink-0 text-center text-sm leading-4">
                  {pending.emoji}
                </span>
              ) : (
                PendingIcon && <PendingIcon className="size-4 shrink-0 text-primary" />
              )}
              <span className="text-sm font-semibold text-foreground">{labelOf(pending)}</span>
              {pending.alpha && (
                <Badge variant="secondary" className="px-1 py-0 text-[9px]">
                  {t('home.modeAlphaBadge')}
                </Badge>
              )}
            </div>
            <p className="text-xs text-foreground-muted">{t(pending.descKey)}</p>
            {renderConfiguration(pending.mode, pending.teamId, () => setRuntimeDirty(true))}
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
  reviewerRuntime: RuntimeId;
  onReviewerProviderChange: (provider: RuntimeId) => void;
  teams: AgentTeam[];
  selectedTeamId: string;
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
  reviewerRuntime,
  onReviewerProviderChange,
  teams,
  selectedTeamId,
  agents,
  slotAgentId,
  onSlotAgentChange,
  connectionId,
  className,
}: ModeConfigurationPanelProps) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();

  // A slot card needs its Agent selection. `key` is the slot's stable key (the
  // mode's prompt key, reused purely to key the per-slot selection).
  const slotProps = (key: string) => ({
    agents,
    selectedAgentId: slotAgentId(key),
    onSelectAgent: (agentId: string) => onSlotAgentChange(key, agentId),
  });

  return (
    // Slots stack as Agent cards (identity + client + model + skills) so every
    // run mode — including the multi-agent team — shows the same rich card.
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
          // The team is chosen in the sidebar now; the panel just shows its roster.
          const team = teams.find((tm) => tm.id === selectedTeamId) ?? teams[0];
          const isFeatureWorkflow = Boolean(team && hasFeatureWorkflowContract(team));
          return (
            <div className="flex flex-col gap-2">
              {team && (
                <>
                  {isFeatureWorkflow && <FeatureWorkflowPreview />}
                  <div className="flex flex-col gap-0.5 border border-border/60 bg-background-1/40 p-2">
                    {team.members.map((m) => {
                      const featureStage = isFeatureWorkflow
                        ? FEATURE_WORKFLOW_STAGES.find((stage) => stage.handle === m.handle)
                        : undefined;
                      return (
                        <div key={m.handle} className="flex items-center gap-2 px-1 py-1 text-xs">
                          <span className="min-w-0 flex-1 truncate text-foreground">
                            {featureStage
                              ? t(`featureWorkflow.stages.${featureStage.id}.title`)
                              : m.displayName}
                          </span>
                          {m.role === 'leader' && (
                            <span className="shrink-0 bg-primary/15 px-1.5 py-px text-[10px] text-primary">
                              {t('home.teamLeader')}
                            </span>
                          )}
                          <span className="shrink-0 font-mono text-[10px] text-foreground-muted">
                            {getRuntime(m.runtime)?.name ?? m.runtime}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              <button
                type="button"
                onClick={() => navigate('library', { section: 'agentTeams' })}
                className="flex items-center gap-1.5 self-start rounded-md px-1 py-0.5 text-xs text-foreground-muted transition-colors hover:text-foreground"
              >
                <Settings2 className="size-3.5 shrink-0" />
                <span>{t('home.teamManageHint')}</span>
              </button>
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
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const showAgentModal = useShowModal('agentEditModal');
  const { installedSkills } = useSkills();

  const selectedAgent = selectedAgentId
    ? (agents.find((a) => a.id === selectedAgentId) ?? null)
    : null;
  // Runtime shown on the card: the per-slot override wins, else the Agent's
  // preferred runtime. Editing it here sets the per-slot override (loose
  // coupling — it does not mutate the Agent).
  const runtime = value ?? selectedAgent?.preferredRuntime ?? null;
  const resolveSkillName = (identifier: string) =>
    installedSkills.find((skill) => skill.key === identifier || skill.id === identifier)
      ?.displayName ?? identifier;
  const skillNames = selectedAgent
    ? [
        ...selectedAgent.enabledSkillIds.map((identifier) => resolveSkillName(identifier)),
        ...selectedAgent.manualSkillIds.map(
          (identifier) => `${resolveSkillName(identifier)} · ${t('agentManager.skillModeManual')}`
        ),
      ]
    : [];
  const editAgent = () =>
    selectedAgent && showAgentModal({ agent: selectedAgent, onSuccess: () => undefined });

  return (
    <div className="group flex min-w-0 flex-col gap-1.5 rounded-xl border border-border/60 bg-background-1 p-2 transition-colors hover:border-border focus-within:border-border-1">
      {/* Subject row: avatar + (role eyebrow over agent name) + edit. Folding the
          role label into the picker keeps the whole assignment on one row. */}
      <div className="flex min-w-0 items-center gap-1">
        <AgentSlotSelector
          selectedAgent={selectedAgent}
          agents={agents}
          onSelectAgent={onSelectAgent}
          onCreateAgent={() =>
            showAgentModal({ onSuccess: (created) => onSelectAgent(created.id) })
          }
          onManageAgents={() => navigate('agentManager')}
          eyebrow={
            <span
              title={label}
              className="flex items-center gap-1 truncate text-[9.5px] font-semibold uppercase tracking-[0.12em] text-foreground-passive"
            >
              <Icon className="size-3 shrink-0" />
              {label}
            </span>
          }
          className="h-auto min-w-0 flex-1 rounded-lg border-transparent bg-transparent py-1 pl-1 pr-1.5 hover:bg-background-2/60"
        />
        {selectedAgent && (
          <button
            type="button"
            onClick={editAgent}
            aria-label={t('agentManager.editAgent')}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground"
          >
            <Settings2 className="size-3.5" />
          </button>
        )}
        {action}
      </div>

      {selectedAgent && (
        <>
          {selectedAgent.description && (
            <p className="line-clamp-2 px-1 text-xs leading-snug text-foreground-muted">
              {selectedAgent.description}
            </p>
          )}

          {/* Hairline drops the runtime/model overrides to a quieter tier than
              the agent itself — they are loosely-coupled tweaks, not the choice. */}
          <div aria-hidden className="mx-1 h-px bg-border/50" />

          <div className="flex min-w-0 items-center gap-1">
            <AgentSelector
              value={runtime}
              model={selectedAgent.model}
              onChange={onChange}
              connectionId={connectionId}
              className="h-7 min-w-0 flex-1 rounded-md border-transparent bg-transparent text-sm transition-colors hover:bg-background-2"
            />
            <SlotModelInput key={selectedAgent.id} agent={selectedAgent} />
          </div>

          {skillNames.length > 0 && (
            <div className="flex flex-wrap gap-1 px-1">
              {skillNames.map((name, index) => (
                <span
                  key={`${name}-${index}`}
                  className="max-w-40 truncate rounded-full bg-background-2/70 px-2 py-0.5 text-[10px] font-medium text-foreground-muted"
                >
                  {name}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Inline model field for a slot's Agent. Edits the Agent's `model` (the same
 * field the Agent editor writes), persisted on blur/Enter. Empty = runtime
 * default.
 */
function SlotModelInput({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const { update } = useAgents();
  // Seeded once; the parent remounts this via key={agent.id} when the slot's
  // Agent changes, so local edits never get clobbered mid-typing.
  const [value, setValue] = useState(agent.model ?? '');

  const commit = () => {
    const next = value.trim() || null;
    if (next === (agent.model ?? null)) return;
    void update({ id: agent.id, draft: { ...agentToDraft(agent), model: next } });
  };

  return (
    <input
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
      placeholder={t('agentManager.modelPlaceholder')}
      title={t('agentManager.model')}
      className="h-7 w-28 shrink-0 rounded-md border border-transparent bg-transparent px-2 text-xs text-foreground outline-none transition-colors placeholder:text-foreground-passive hover:bg-background-2 focus-visible:bg-background-2 focus-visible:ring-1 focus-visible:ring-ring"
    />
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

function RunHostSelector({ kind, onSelectKind }: RunHostSelectorProps) {
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
      <DropdownMenuContent align="start" className="w-48 p-1.5">
        {options.map((option) => {
          const Icon = option.icon;
          const active = option.kind === kind;
          return (
            <DropdownMenuItem
              key={option.kind}
              disabled={!onSelectKind || active}
              onClick={() => onSelectKind?.(option.kind)}
              className="gap-2 rounded-md px-2.5 py-2"
            >
              <Icon className="size-4 shrink-0 text-foreground-muted" />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {option.label}
              </span>
              {active && <Check className="size-3.5 shrink-0 text-foreground-muted" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface BranchStrategyChipsProps {
  projectId: string;
  /** Effective strategy: `new-branch` forks, anything else runs on the picked branch. */
  strategyKind: TaskStrategyKind;
  /** Parent-task subtasks lock the base to the parent branch. */
  locked: boolean;
  /** Unborn repos can't fork — disable the switch. */
  forkDisabled: boolean;
  /** User-selected starting branch; the fork switch does not rewrite it. */
  branchValue: Branch | undefined;
  branchLabel: string;
  /** True when not-forking can run directly in the current checkout. */
  branchRunsInPlace: boolean;
  onBranchChange: (next: Branch) => void;
  onForkChange: (forked: boolean) => void;
  forkLabels: StrategyChipLabels;
  baseBranchAriaLabel: string;
  forkAriaLabel: string;
}

/**
 * The branch picker and fork switch are orthogonal axes of one decision: start
 * from this branch, then either work on it directly or create a new branch.
 */
function BranchStrategyChips({
  projectId,
  strategyKind,
  locked,
  forkDisabled,
  branchValue,
  branchLabel,
  branchRunsInPlace,
  onBranchChange,
  onForkChange,
  forkLabels,
  baseBranchAriaLabel,
  forkAriaLabel,
}: BranchStrategyChipsProps) {
  const forking = strategyKind === 'new-branch';
  return (
    <>
      <BaseBranchChip
        projectId={projectId}
        locked={locked}
        value={branchValue}
        label={branchLabel}
        inPlace={!forking && branchRunsInPlace}
        onChange={onBranchChange}
        ariaLabel={baseBranchAriaLabel}
      />
      <ForkSwitchChip
        checked={forking}
        disabled={forkDisabled}
        onChange={onForkChange}
        ariaLabel={forkAriaLabel}
        labels={forkLabels}
      />
    </>
  );
}

interface BaseBranchChipProps {
  projectId: string;
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
