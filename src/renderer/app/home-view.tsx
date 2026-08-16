import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Anchor,
  AppWindow,
  Bot,
  Check,
  ChevronDown,
  ClipboardCheck,
  Code2,
  Folder,
  FolderOpen,
  GitBranch,
  GitCompare,
  GitFork,
  GripVertical,
  Loader2,
  LocateFixed,
  Monitor,
  Puzzle,
  Server,
  Settings2,
  Wrench,
  X,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import yodaLogoWhite from '@/assets/images/yoda/yoda_logo_white.svg';
import yodaLogo from '@/assets/images/yoda/yoda_logo.svg';
import { enabledTeamMembers, type AgentTeam } from '@shared/agent-team';
import type { Agent } from '@shared/agents';
import type { Branch } from '@shared/git';
import type {
  ParadigmAccent,
  ParadigmKindDescriptor,
  ParadigmKindId,
} from '@shared/paradigms/contract';
import {
  paradigmKind,
  paradigmKindForRunMode,
  paradigmSlot,
  runModeForParadigmKind,
  type LegacyRunMode,
} from '@shared/paradigms/kinds';
import { paradigmToTeam } from '@shared/paradigms/team-adapter';
import type { ComposerDefaults, TaskOutputLanguage } from '@shared/project-settings';
import { INTERNAL_PROJECT_ID } from '@shared/projects';
import { getRuntime, RUNTIME_IDS, type RuntimeId } from '@shared/runtime-registry';
import { taskNameFromPrompt } from '@shared/task-name';
import { resolveHomeProjectId } from '@renderer/app/home-project-selection';
import { useAgents } from '@renderer/features/agents-config/use-agents';
import { agentSkillSelection } from '@renderer/features/paradigms/agent-launch-settings';
import { createParadigmLaunchContext } from '@renderer/features/paradigms/create-launch-context';
import { selectByKind } from '@renderer/features/paradigms/entries';
import type {
  CompareVariant,
  ParadigmLaunchParams,
  TaskStrategyKind,
} from '@renderer/features/paradigms/launch-context';
import { paradigmsQueryKey } from '@renderer/features/paradigms/paradigm-queries';
import { paradigmLauncher, paradigmLaunchStamp } from '@renderer/features/paradigms/registry';
import { paradigmSeatAgentId } from '@renderer/features/paradigms/seats';
import { ParadigmSelector } from '@renderer/features/paradigms/selector';
import {
  asMounted,
  getProjectManagerStore,
  getProjectSettingsStore,
  getRepositoryStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useEffectiveRuntime } from '@renderer/features/tasks/conversations/use-effective-runtime';
import { ProjectSelector } from '@renderer/features/tasks/create-task-modal/project-selector';
import { useRuntimePermissionModes } from '@renderer/features/tasks/hooks/useRuntimePermissionModes';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { accountGreetingName } from '@renderer/lib/account-display';
import { ProjectBranchMenuItems } from '@renderer/lib/components/project-branch-selector';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { toast } from '@renderer/lib/hooks/use-toast';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { rpc } from '@renderer/lib/ipc';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@renderer/lib/ui/collapsible';
import { ComboboxTrigger, ComboboxValue } from '@renderer/lib/ui/combobox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { MicroLabel } from '@renderer/lib/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Switch } from '@renderer/lib/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { formatModelLabel } from '@renderer/utils/format-model-label';
import { cn } from '@renderer/utils/utils';
import { resolveAgentSlot } from './agent-slot-resolution';
import {
  dualField,
  withComposerDefault,
  type ComposerOverrideScope,
} from './composer-project-overrides';
import { ComposerPromptInput, type ComposerPromptInputProps } from './composer-prompt-input';
import {
  ComposerSettingsContent,
  DEFAULT_INPUT_PROMPT_LANGUAGE,
  DEFAULT_SUMMARY_OUTPUT_LANGUAGE,
  DEFAULT_TASK_OUTPUT_LANGUAGE,
} from './composer-settings-content';
import {
  branchNeedsCheckout,
  resolveProjectSubmitSourceBranch,
  type HomeProjectSubmitStrategy,
} from './home-project-submit';
import { serializePromptWithTokens, type PromptToken } from './prompt-attachment-tokens';
import { promptRewriteFailureDescription } from './submit-prompt-rewrite';

/**
 * The composer's persisted run-mode values. Kept as the storage vocabulary; the
 * behavior behind each one lives in its paradigm kind descriptor
 * (`src/shared/paradigms/kinds.ts`), reached through the selected paradigm
 * instance — `paradigmKindForRunMode` only seeds the selection.
 */
type HomeRunMode = LegacyRunMode;
type RunHostKind = 'local' | 'ssh';

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

type HomeComposerPromptHandle = {
  getValue: () => string;
  setValue: (value: string) => void;
};

type HomeComposerPromptProps = Omit<ComposerPromptInputProps, 'value' | 'onChange'> & {
  draftLoaded: boolean;
  persistedPrompt: string;
  onPersistPrompt: (value: string) => void;
  onValueChange: (value: string) => void;
};

/**
 * Keep prompt keystrokes inside the input subtree. The home composer owns many
 * project and agent selectors; lifting the full text into it makes every
 * character re-run all of those selectors and render paths.
 */
const HomeComposerPrompt = memo(
  forwardRef<HomeComposerPromptHandle, HomeComposerPromptProps>(function HomeComposerPrompt(
    { draftLoaded, persistedPrompt, onPersistPrompt, onValueChange, ...inputProps },
    ref
  ) {
    const [value, setValue] = useState(persistedPrompt);
    const valueRef = useRef(value);
    const promptWriteRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const setLocalValue = useCallback(
      (next: string) => {
        valueRef.current = next;
        setValue(next);
        onValueChange(next);
      },
      [onValueChange]
    );

    useImperativeHandle(
      ref,
      () => ({
        getValue: () => valueRef.current,
        setValue: setLocalValue,
      }),
      [setLocalValue]
    );

    useEffect(() => {
      if (!draftLoaded || value === persistedPrompt) return;
      if (promptWriteRef.current) clearTimeout(promptWriteRef.current);
      promptWriteRef.current = setTimeout(() => {
        onPersistPrompt(value);
      }, 300);
      return () => {
        if (promptWriteRef.current) clearTimeout(promptWriteRef.current);
      };
    }, [draftLoaded, onPersistPrompt, persistedPrompt, value]);

    return <ComposerPromptInput {...inputProps} value={value} onChange={setLocalValue} />;
  })
);

interface RunModeInputChrome {
  containerClassName: string;
}

const MAX_COMPARE_VARIANTS = 5;
type ExplicitTaskOutputLanguage = Extract<TaskOutputLanguage, 'en' | 'zh-CN'>;

/**
 * Storage key of the slot whose Agent stands in for the whole paradigm in the
 * composer (its implementer seat). null for kinds with no fixed slots — `team`
 * carries its roster in params instead.
 */
function primarySlotKey(kind: ParadigmKindDescriptor): string | null {
  return kind.slots[0]?.storageKey ?? null;
}

/**
 * The base single-Agent seat. The composer reads it directly for the comparison
 * variants, which all reuse that seat's Agent; every other seat is reached
 * through its kind's descriptor.
 */
const NORMAL_PROMPT_KEY = paradigmSlot('single', 'agent').storageKey;

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

const PARADIGM_ACCENT_CONTAINER_CLASS: Record<ParadigmAccent, string> = {
  default: 'border-border bg-background-1',
  advanced: ADVANCED_INPUT_CONTAINER_CLASS,
  experimental:
    'border-amber-500/30 bg-amber-500/[0.035] ring-1 ring-amber-500/15 focus-within:border-amber-500/45 focus-within:ring-amber-500/25',
};

function getParadigmInputChrome(kind: ParadigmKindDescriptor): RunModeInputChrome {
  return {
    containerClassName: PARADIGM_ACCENT_CONTAINER_CLASS[kind.capabilities.accent],
  };
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
  runMode?: HomeRunMode;
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
      <div
        data-yoda-surface="home-shell"
        className="mx-auto flex min-h-full w-full max-w-6xl flex-1 flex-col px-5 pb-8 pt-14 @2xl:px-8 @5xl:px-10"
      >
        <div
          data-yoda-surface="home-stage"
          className="flex flex-1 flex-col justify-center gap-8 py-4"
        >
          <div data-yoda-surface="home-hero" className="text-center">
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

          <HomeComposer className="mx-auto w-full max-w-4xl" showDreamActions />
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
  showDreamActions = false,
}: {
  className?: string;
  /** Called after a successful submit. New-task mode navigates before firing it. */
  onSubmitted?: (result: HomeComposerSubmitResult) => void;
  submitTarget?: HomeComposerSubmitTarget;
  showDreamActions?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { navigate } = useNavigate();
  const { setCollapsed } = useWorkspaceLayoutContext();
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
  const revealSelectedProjectInSidebar = useCallback(() => {
    if (!selectedProjectId) return;
    setCollapsed('left', false);
    appState.sidebar.requestSelectionReveal(selectedProjectId);
  }, [selectedProjectId, setCollapsed]);

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
  const { runtimeId } = useEffectiveRuntime(connectionId, {
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
  /**
   * Switch mode, and with it the remembered instance.
   *
   * A mode reached without naming an instance forgets the one remembered before
   * it — the id belonged to whatever was chosen alongside it, and carrying a
   * team's id into single-Agent mode is what made the two disagree. Written in one
   * patch so the mode and the id it applies to can never land separately.
   */
  const setRunMode = useCallback(
    (next: HomeRunMode, paradigmId = '') => {
      hasManualRunModeRef.current = true;
      setRunModeState(next);
      if (runModeOverridden) {
        setComposerDefault('runMode', next);
        updateDraft({ selectedParadigmId: paradigmId });
      } else {
        updateDraft({ runMode: next, selectedParadigmId: paradigmId });
      }
    },
    [runModeOverridden, setComposerDefault, updateDraft]
  );
  // The picker speaks paradigm instances; the composer still persists the legacy
  // run mode string, so the kind is translated back on the way in and the instance
  // is remembered beside it.
  const setParadigm = useCallback(
    (kindId: ParadigmKindId, paradigmId: string) => {
      const runMode = runModeForParadigmKind(kindId);
      if (runMode) setRunMode(runMode, paradigmId);
      else updateDraft({ selectedParadigmId: paradigmId });
    },
    [setRunMode, updateDraft]
  );
  useEffect(() => {
    if (!homeParams.runMode) return;
    setRunMode(homeParams.runMode);
    setHomeParams({ runMode: undefined });
  }, [homeParams.runMode, setHomeParams, setRunMode]);
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
  // Paradigm instances, for the seats the selected one carries. The picker reads
  // the same query, so both resolve seats from one source.
  const { data: paradigms = [] } = useQuery({
    queryKey: paradigmsQueryKey,
    queryFn: () => rpc.paradigms.list(),
  });
  const queryClient = useQueryClient();
  // Which paradigm *instance* is selected. Empty means the current kind's own
  // built-in instance, which is what every kind but `team` has exactly one of.
  const selectedParadigmId = draft?.selectedParadigmId ?? '';
  const { agents: userAgents } = useAgents();
  const selectedAgentIdsByMode = useMemo<Record<string, string[]>>(
    () => draft?.selectedAgentIds ?? {},
    [draft?.selectedAgentIds]
  );
  // The paradigm instance this submit will run. Seats live on it, so resolving it
  // here is what makes a duplicated paradigm launch with its own Agents rather
  // than the ones its original was configured with.
  const activeParadigm = useMemo(() => {
    // The remembered instance is authoritative, not filtered by the run mode:
    // editing a paradigm's roster can change its kind (one Agent becomes three),
    // and resolving by mode would then drop the instance the user is holding and
    // silently substitute another of the old kind. The mode is only the fallback
    // for a selection that was never made or no longer exists — `setRunMode`
    // clears the id whenever the two would otherwise diverge.
    const remembered = selectedParadigmId
      ? paradigms.find((paradigm) => paradigm.id === selectedParadigmId)
      : undefined;
    return remembered ?? selectByKind(paradigms, paradigmKindForRunMode(runMode), undefined);
  }, [paradigms, runMode, selectedParadigmId]);
  /**
   * The kind actually driving this composer.
   *
   * Every capability gate reads this rather than the run mode: the mode is a
   * persisted string that names a kind, while the selected instance *is* one, and
   * after a roster edit the instance is the one that changed.
   */
  const activeKind = useMemo(
    () => paradigmKind(activeParadigm?.kindId ?? paradigmKindForRunMode(runMode)),
    [activeParadigm, runMode]
  );
  // The roster the multi-agent paradigm runs, read off the selected instance
  // itself: a team *is* a `team` instance, and its roster is that instance's
  // params. Derived rather than fetched separately so the row the picker
  // highlights and the roster that launches cannot disagree.
  const activeTeam = useMemo<AgentTeam | undefined>(
    () => (activeParadigm?.kindId === 'team' ? paradigmToTeam(activeParadigm) : undefined),
    [activeParadigm]
  );
  // Per-slot Agent selection, resolved against the selected instance first and
  // the composer draft second — see `paradigmSeatAgentId`.
  const slotAgentId = useCallback(
    (slotKey: string): string | null =>
      paradigmSeatAgentId({
        paradigm: activeParadigm,
        slotStorageKey: slotKey,
        draftAgents: selectedAgentIdsByMode,
        agents: userAgents,
      }),
    [activeParadigm, selectedAgentIdsByMode, userAgents]
  );
  const composerAgent = useMemo<Agent | null>(() => {
    if (activeKind.kindId === 'team') {
      const leader =
        activeTeam?.members.find((member) => member.role === 'leader') ?? activeTeam?.members[0];
      if (!leader?.agentRef) return null;
      return (
        userAgents.find(
          (agent) => agent.id === leader.agentRef || agent.slug === leader.agentRef
        ) ?? null
      );
    }
    const slotKey = primarySlotKey(activeKind);
    const agentId = slotKey ? slotAgentId(slotKey) : null;
    return agentId ? (userAgents.find((agent) => agent.id === agentId) ?? null) : null;
  }, [activeKind, activeTeam, slotAgentId, userAgents]);
  const composerSkillSelection = useMemo(() => agentSkillSelection(composerAgent), [composerAgent]);
  const permissionModes = useRuntimePermissionModes();
  const normalAgentRuntime = useMemo(
    () =>
      resolveAgentSlot({
        selectedAgentId: slotAgentId(NORMAL_PROMPT_KEY),
        agents: userAgents,
        fallbackRuntime: runtimeId,
      }).provider,
    [runtimeId, slotAgentId, userAgents]
  );
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
  const promptInputRef = useRef<HomeComposerPromptHandle>(null);
  const promptValueRef = useRef(persistedPrompt);
  const [promptHasText, setPromptHasText] = useState(() => persistedPrompt.trim().length > 0);
  const handlePromptValueChange = useCallback((value: string) => {
    promptValueRef.current = value;
    const nextHasText = value.trim().length > 0;
    setPromptHasText((current) => (current === nextHasText ? current : nextHasText));
  }, []);
  const persistPrompt = useCallback(
    (value: string) => updateDraft({ prompt: value }),
    [updateDraft]
  );
  const [promptTokens, setPromptTokens] = useState<PromptToken[]>([]);
  const [quickActionMode, setQuickActionMode] = useState(false);
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
  const hydratedPromptTokensRef = useRef(false);
  useEffect(() => {
    if (hydratedPromptTokensRef.current) return;
    if (draft === undefined) return;
    hydratedPromptTokensRef.current = true;
    // Re-link the attachment-token registry persisted with the draft — the
    // composer remounts on every navigation and the sentinels in the restored
    // prompt would otherwise be orphaned plain text. Image hover previews
    // (object URLs) don't survive the remount; paths and chips do.
    setPromptTokens(
      (draft.promptTokens ?? []).map((token) => ({ ...token, id: crypto.randomUUID() }))
    );
  }, [draft]);

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
  const effectiveStandardStrategyKind: TaskStrategyKind = isUnborn ? 'no-worktree' : strategyKind;
  // What actually gets submitted: the fork switch picks new-branch, otherwise
  // the selected branch decides between running in place and checking out an
  // existing local/remote source in a worktree.
  const standardSubmitKind: HomeProjectSubmitStrategy =
    effectiveStandardStrategyKind === 'new-branch' ? 'new-branch' : selectedBranchSubmitKind;
  const paradigmCapabilities = activeKind.capabilities;
  // Which branch strategy reaches createTask: fixed for paradigms that declare
  // their worktree need, otherwise whichever strategy field the paradigm reads.
  const projectSubmitStrategyKind: HomeProjectSubmitStrategy =
    paradigmCapabilities.worktree === 'required'
      ? 'new-branch'
      : paradigmCapabilities.worktree === 'never'
        ? 'no-worktree'
        : standardSubmitKind;
  const projectSubmitSourceBranch =
    mounted &&
    resolveProjectSubmitSourceBranch({
      defaultBranch,
      currentBranch: currentBranchName,
      isUnborn,
      strategyKind: projectSubmitStrategyKind,
      baseRef: mounted.data.baseRef,
    });
  // Every comparison config is a duplicate of the current base composer config.
  // Entering compare mode (from zero) migrates the base into the list as the
  // first config and adds a second, so all rows are equal and the special base
  // row disappears; later clicks append one more.
  const makeVariantFromBase = useCallback(
    (): CompareVariant => ({
      id: crypto.randomUUID(),
      projectId: selectedProjectId ?? null,
      runtimeId: normalAgentRuntime,
      strategyKind: effectiveStandardStrategyKind,
      baseBranch: selectedBranch ?? null,
    }),
    [selectedProjectId, normalAgentRuntime, effectiveStandardStrategyKind, selectedBranch]
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
  // Run-defaults section is collapsed by default — it is rarely changed and its
  // eight rows otherwise dominate the popover.
  const [runDefaultsOpen, setRunDefaultsOpen] = useState(false);
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
  const modeCanRunWithoutProject = paradigmCapabilities.projectless;
  // Only a paradigm that refuses to degrade on an unborn repo needs a real
  // branch up front; the rest silently fall back to running in place.
  const modeRequiresWorktree =
    !taskScopedTarget &&
    paradigmCapabilities.unbornPolicy === 'seed-commit' &&
    projectSubmitStrategyKind === 'new-branch';
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
  // A slot can run only when it has an Agent assigned (the Agent supplies the
  // runtime + prompt). Every slot the paradigm declares must be filled.
  const hasSlotAgent = (slotKey: string) => !!slotAgentId(slotKey);
  const modeHasAgents =
    activeKind.kindId === 'team'
      ? // A team's roster lives in its params, not in fixed slots — and a member
        // switched off is still on the roster, so only the enabled ones count
        // towards having anyone to run.
        Boolean(activeTeam && enabledTeamMembers(activeTeam).length > 0)
      : activeKind.slots.every((slot) => hasSlotAgent(slot.storageKey));
  // Multi-config compare only fires in plain (normal, non-task-scoped) submits;
  // every variant must target a real project before it can spawn a task.
  const compareActive =
    activeKind.kindId === 'single' && !taskScopedTarget && compareVariants.length > 0;
  const compareVariantsReady =
    !compareActive ||
    (Boolean(selectedProjectId) && compareVariants.every((variant) => Boolean(variant.projectId)));
  const quickActionModeAvailable =
    activeKind.kindId === 'single' &&
    !taskScopedTarget &&
    compareVariants.length === 0 &&
    projectData?.type === 'local' &&
    (runtimeId === 'codex' || runtimeId === 'claude');
  useEffect(() => {
    if (!quickActionModeAvailable) setQuickActionMode(false);
  }, [quickActionModeAvailable]);
  // A worktree-requiring mode on a repo without a base commit can't fork until
  // one exists. This covers both an unborn repo (git init, no commit) and a
  // plain folder that was never `git init`-ed — both surface as `isUnborn` with
  // no resolvable `defaultBranch`. Rather than dead-disabling the button, route
  // submit through a modal that seeds the first commit (creating the repo if
  // needed), then proceeds.
  const needsInitialCommit = !!mounted && modeRequiresWorktree && isUnborn && !!selectedProjectId;
  // A paradigm that scaffolds its own project has no project/branch to validate;
  // it only needs a requirement to build from.
  const scaffoldsOwnProject = paradigmCapabilities.target === 'new-project';
  const canSubmit =
    !submitting &&
    modeHasAgents &&
    compareVariantsReady &&
    (!scaffoldsOwnProject || promptHasText) &&
    (scaffoldsOwnProject
      ? true
      : taskScopedTarget
        ? !!targetProvisionedTask
        : modeCanRunWithoutProject
          ? !mounted || !!projectSubmitSourceBranch
          : !!mounted && (needsInitialCommit || !!projectSubmitSourceBranch));

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || submitting) return;
    const prompt = promptValueRef.current;
    const trimmed = prompt.trim();
    setSubmitting(true);
    try {
      // Attachment transport: inline sentinel tokens are replaced in place —
      // File tokens become @path mentions. When the user prefers image paths,
      // image tokens become backtick-wrapped @path text so Agent clients do not
      // promote them back into image inputs. Remaining image tokens become
      // {{yoda-image:N}} markers the main process expands per runtime (native
      // clipboard paste for TUIs that support it, @path substitution for the
      // rest). Ordering always follows the text.
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
      const requirement = serialized.text.trim();
      const deferInitialPrompt =
        requirement.length > 0 &&
        inputPromptLanguage !== 'skip' &&
        inputPromptLanguage !== 'prompt';
      const requirementPromise = deferInitialPrompt
        ? rewriteInputRequirement(requirement).catch((error: unknown) => {
            toast({
              title: t('home.promptRewriteFailed'),
              description: promptRewriteFailureDescription(error, t('common.unknownError')),
              variant: 'destructive',
              debugInfo: error,
            });
            return null;
          })
        : Promise.resolve(requirement);
      const imagePaths = serialized.imagePaths.length > 0 ? serialized.imagePaths : undefined;

      // Which paradigm runs. Comparison wraps the single-agent paradigm rather
      // than being a mode of it, so it is selected here and nowhere else.
      const kindId: ParadigmKindId = compareActive && mounted ? 'compare' : activeKind.kindId;
      const params: ParadigmLaunchParams = {
        team: activeTeam,
        variants: compareVariants,
        quickAction: quickActionMode,
      };
      const shared = {
        paradigm: paradigmLaunchStamp(kindId, params),
        requirement,
        titlePrompt: trimmed || undefined,
        deferInitialPrompt,
        requirementPromise,
        imagePaths,
        sessionImagePaths: deferInitialPrompt ? undefined : imagePaths,
        strategyKind: projectSubmitStrategyKind,
        agents: userAgents,
        slotAgentId,
        composerRuntime: runtimeId,
        selectedBranch,
        currentBranchName,
        parentTaskId: parentTarget?.taskId,
        projectManager,
        queryClient,
        isAutoApproving: permissionModes.isDanger,
        t,
        focusTask: (projectId: string, taskId: string) => {
          navigate('task', { projectId, taskId });
          onSubmitted?.({ kind: 'task', projectId, taskId });
        },
        onConversationsStarted: (projectId: string, taskId: string, conversationIds: string[]) => {
          onSubmitted?.({ kind: 'conversation', projectId, taskId, conversationIds });
        },
        resetComposer: () => {
          promptInputRef.current?.setValue('');
          updateDraft({ prompt: '', promptTokens: [] });
          clearPromptTokens();
          setCompareVariants([]);
        },
      };

      // A paradigm that scaffolds its own project has no task to name, no branch
      // to resolve, and nothing to join.
      if (paradigmCapabilities.target === 'new-project') {
        await paradigmLauncher(kindId).launch(
          createParadigmLaunchContext({
            ...shared,
            target: { kind: 'new-project' },
            baseName: '',
            provisionedTask: null,
            project: null,
            baseDefaultBranch: undefined,
            parentBranchName: null,
            parentTaskId: undefined,
          }),
          params
        );
        return;
      }

      if (taskScopedTarget) {
        if (!targetProvisionedTask) return;
        await paradigmLauncher(kindId).launch(
          createParadigmLaunchContext({
            ...shared,
            target: taskScopedTarget,
            baseName: '',
            provisionedTask: targetProvisionedTask,
            project: mounted ?? null,
            baseDefaultBranch: undefined,
            parentBranchName: parentBranchName ?? null,
          }),
          params
        );
        return;
      }

      const promptDisplayName = trimmed ? taskNameFromPrompt(trimmed) : '';
      const baseName =
        promptDisplayName || (await rpc.tasks.generateTaskName(trimmed ? { title: trimmed } : {}));

      // No project selected: the task lands in the internal drafts project, which
      // is an ordinary in-place task there — so it is a `new-task` launch with a
      // fixed project rather than a target of its own.
      if (!mounted) {
        await projectManager.mountProject(INTERNAL_PROJECT_ID).catch(() => {});
        const internalProject = asMounted(projectManager.projects.get(INTERNAL_PROJECT_ID));
        if (!internalProject) {
          toast.error('Could not open the internal drafts project.');
          return;
        }
        await paradigmLauncher(kindId).launch(
          createParadigmLaunchContext({
            ...shared,
            target: { kind: 'new-task', projectId: INTERNAL_PROJECT_ID },
            baseName,
            provisionedTask: null,
            project: internalProject,
            strategyKind: 'no-worktree',
            selectedBranch: undefined,
            baseDefaultBranch: { type: 'local', branch: 'main' },
            currentBranchName: null,
            parentBranchName: null,
            parentTaskId: undefined,
          }),
          params
        );
        return;
      }

      // `defaultBranch` is derived from the repository store, which is stale
      // right after the initial-commit modal seeds a brand-new repo (git init +
      // first commit emit a ref change the store hasn't applied yet). Resolve
      // the selected branch from a fresh read so worktree modes get a valid source
      // branch instead of silently bailing here.
      let baseDefaultBranch = projectSubmitSourceBranch || undefined;
      if (!baseDefaultBranch) {
        const local = await rpc.repository.getLocalBranches(mounted.data.id);
        baseDefaultBranch = resolveProjectSubmitSourceBranch({
          defaultBranch,
          currentBranch: local.currentBranch,
          isUnborn: local.isUnborn,
          strategyKind: projectSubmitStrategyKind,
          baseRef: mounted.data.baseRef,
        });
      }
      if (!baseDefaultBranch) return;

      await paradigmLauncher(kindId).launch(
        createParadigmLaunchContext({
          ...shared,
          target: { kind: 'new-task', projectId: mounted.data.id },
          baseName,
          provisionedTask: null,
          project: mounted,
          baseDefaultBranch,
          parentBranchName: parentBranchName ?? null,
        }),
        params
      );
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
    projectSubmitSourceBranch,
    projectSubmitStrategyKind,
    paradigmCapabilities,
    submitting,
    activeKind,
    compareActive,
    compareVariants,
    quickActionMode,
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

  const promptInputChrome = getParadigmInputChrome(activeKind);
  // The composer-settings gear belongs to a config row (the base row in normal
  // mode, every config row in compare mode), so it is a render helper reused
  // across rows rather than a single global control.
  const renderComposerSettingsButton = (): ReactNode => (
    <Popover>
      <PopoverTrigger
        data-yoda-surface="home-composer-session-settings"
        aria-label={t('home.composerSettingsAria')}
        title={t('home.composerSettingsAria')}
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background-1 px-2.5 text-xs text-foreground transition-colors hover:bg-background-2 hover:text-foreground"
      >
        <Settings2 className="size-3.5 text-foreground-muted" />
        <span className="hidden @lg/composer:inline">{t('home.composerSettingsLabel')}</span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[min(32rem,calc(100vh-3rem))] w-96 gap-0 overflow-y-auto p-2.5"
      >
        <ComposerSettingsContent
          attachImagesAsPaths={attachImagesAsPaths}
          inputPromptLanguage={inputPromptLanguageField.value}
          namingLanguage={namingLanguageField.value}
          summaryLanguage={summaryLanguageField.value}
          onAttachImagesAsPathsChange={attachImagesField.setValue}
          onInputPromptLanguageChange={inputPromptLanguageField.setValue}
          onNamingLanguageChange={namingLanguageField.setValue}
          onSummaryLanguageChange={summaryLanguageField.setValue}
          footer={
            <Collapsible
              open={runDefaultsOpen}
              onOpenChange={setRunDefaultsOpen}
              className="mt-2 flex flex-col gap-1 border-t border-border/60 pt-2"
            >
              <CollapsibleTrigger
                title={t('home.composerRunDefaultsHint')}
                className="group flex items-center justify-between gap-2 text-left"
              >
                <MicroLabel className="text-[10px]">
                  {t('home.composerRunDefaultsLabel')}
                </MicroLabel>
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
                    setComposerDefault(
                      'runMode',
                      scope === 'project' ? persistedRunMode : undefined
                    )
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
              </CollapsibleContent>
            </Collapsible>
          }
        />
      </PopoverContent>
    </Popover>
  );

  // "+ 对比" sits at the end of the first config row (the base row in normal
  // mode, the first config row in compare mode), never on its own line.
  const renderAddCompareButton = (): ReactNode => (
    <button
      data-yoda-surface="home-composer-compare-action"
      type="button"
      aria-label={t('home.addCompareVariant')}
      title={t('home.addCompareVariantTooltip')}
      onClick={addVariant}
      disabled={compareVariants.length >= MAX_COMPARE_VARIANTS}
      className="ml-auto flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background-1 px-2.5 text-xs text-foreground transition-colors hover:bg-background-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <GitCompare className="size-3.5 text-foreground-muted" />
      <span className="hidden @lg/composer:inline">{t('home.addCompareVariant')}</span>
    </button>
  );

  // The fork/branch row is shown for paradigms that read a persisted strategy
  // field. Paradigms with a fixed worktree need (team) have nothing to configure
  // here.
  const strategyFieldConfig =
    paradigmCapabilities.strategyField === 'standard'
      ? {
          strategyKind: effectiveStandardStrategyKind,
          setStrategyKind,
          forkLabels: strategyLabels,
          forkAriaLabel: t('home.strategyAria'),
        }
      : null;

  const environmentBranchConfiguration: EnvironmentBranchConfiguration | undefined =
    !taskScopedTarget && mounted && strategyFieldConfig
      ? {
          projectId: mounted.data.id,
          strategyKind: strategyFieldConfig.strategyKind,
          locked: Boolean(parentBranchName),
          forkDisabled: isUnborn,
          branchValue: selectedBranch,
          branchLabel: selectedBranchLabel,
          branchRunsInPlace: selectedBranchRunsInPlace,
          onBranchChange: setBaseBranch,
          onForkChange: (forked) =>
            strategyFieldConfig.setStrategyKind(forked ? 'new-branch' : 'no-worktree'),
          forkLabels: strategyFieldConfig.forkLabels,
          baseBranchAriaLabel: t('home.baseBranchAria'),
          forkAriaLabel: strategyFieldConfig.forkAriaLabel,
        }
      : undefined;

  return (
    <div data-yoda-surface="home-composer" className={className}>
      {showDreamActions ? (
        <div data-yoda-surface="dream-actions" aria-label={t('home.dreamActionsLabel')}>
          {[
            {
              Icon: Code2,
              title: t('home.dreamActionExplore'),
              prompt: t('home.dreamActionExplorePrompt'),
            },
            {
              Icon: Puzzle,
              title: t('home.dreamActionBuild'),
              prompt: t('home.dreamActionBuildPrompt'),
            },
            {
              Icon: ClipboardCheck,
              title: t('home.dreamActionReview'),
              prompt: t('home.dreamActionReviewPrompt'),
            },
            {
              Icon: Wrench,
              title: t('home.dreamActionFix'),
              prompt: t('home.dreamActionFixPrompt'),
            },
          ].map(({ Icon, title, prompt }) => (
            <button
              key={title}
              type="button"
              onClick={() => promptInputRef.current?.setValue(prompt)}
            >
              <span className="dream-skin-action-icon">
                <Icon />
              </span>
              <strong>{title}</strong>
              <span className="dream-skin-action-mark" aria-hidden="true">
                ♥
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div data-yoda-surface="home-composer-input">
        <HomeComposerPrompt
          ref={promptInputRef}
          key={draft !== undefined ? 'draft-loaded' : 'draft-loading'}
          draftLoaded={draft !== undefined}
          persistedPrompt={persistedPrompt}
          onPersistPrompt={persistPrompt}
          onValueChange={handlePromptValueChange}
          tokens={promptTokens}
          onTokensChange={persistPromptTokens}
          runtimeId={runtimeId}
          projectId={projectData?.id ?? null}
          projectPath={skillProjectPath}
          imagesAsPaths={attachImagesAsPaths}
          skillSelection={composerSkillSelection}
          placeholder={scaffoldsOwnProject ? t('home.buildPromptPlaceholder') : undefined}
          disabled={scaffoldsOwnProject && submitting}
          runHostKind={runHostKind}
          containerClassName={promptInputChrome.containerClassName}
          canSubmit={canSubmit}
          quickActionMode={quickActionMode}
          quickActionModeDisabled={!quickActionModeAvailable}
          onQuickActionModeChange={setQuickActionMode}
          onSubmit={submit}
          autoFocus
        />
      </div>

      <div
        data-yoda-surface="home-composer-toolbar"
        className="@container/composer mt-3 flex flex-col gap-2"
      >
        {/* Toolbar chips wrap to extra rows in narrow hosts — never min-w-max +
            overflow-x-auto: macOS overlay scrollbars make clipped chips invisible.
            Chip text labels collapse to icon-only below the @lg container width. */}
        {/* Compare mode: the base config is migrated into this uniform, reorderable
            list, so every row is an equal config. The plain base chip row below is
            hidden while comparing. */}
        {!taskScopedTarget && activeKind.kindId === 'single' && compareVariants.length > 0 && (
          <div className="flex flex-col gap-2">
            {compareVariants.map((variant, index) => {
              const variantProject = asMounted(
                variant.projectId ? projectManager.projects.get(variant.projectId) : undefined
              );
              const variantRunHostKind: RunHostKind =
                variantProject?.data.type === 'ssh' ? 'ssh' : 'local';
              const variantRepository = variant.projectId
                ? getRepositoryStore(variant.projectId)
                : undefined;
              const variantBranch = variant.baseBranch ?? variantRepository?.defaultBranch;
              const variantBranchLabel = branchLabel(variantBranch);
              const variantBranchNeedsCheckout = branchNeedsCheckout(
                variantBranch,
                variantRepository?.currentBranch ?? null
              );
              const variantStrategyLabels: StrategyChipLabels = {
                newBranchTitle: t('home.strategyNewBranchTitle', {
                  branch: variantBranchLabel,
                }),
                newBranchDesc: t('home.strategyNewBranchDesc', {
                  branch: variantBranchLabel,
                }),
                noWorktreeTitle: variantBranchNeedsCheckout
                  ? t('home.strategyCheckoutExistingTitle', { branch: variantBranchLabel })
                  : t('home.strategyNoWorktreeTitle', { branch: variantBranchLabel }),
                noWorktreeDesc: variantBranchNeedsCheckout
                  ? t('home.strategyCheckoutExistingDesc', { branch: variantBranchLabel })
                  : t('home.strategyNoWorktreeDesc'),
              };
              const variantBranchConfiguration: EnvironmentBranchConfiguration | undefined =
                variant.projectId
                  ? {
                      projectId: variant.projectId,
                      strategyKind: variant.strategyKind,
                      locked: false,
                      forkDisabled: variantRepository?.isUnborn ?? false,
                      branchValue: variantBranch,
                      branchLabel: variantBranchLabel,
                      branchRunsInPlace: !variantBranchNeedsCheckout,
                      onBranchChange: (branch) => updateVariant(variant.id, { baseBranch: branch }),
                      onForkChange: (forked) =>
                        updateVariant(variant.id, {
                          strategyKind: forked ? 'new-branch' : 'no-worktree',
                        }),
                      forkLabels: variantStrategyLabels,
                      baseBranchAriaLabel: t('home.baseBranchAria'),
                      forkAriaLabel: t('home.strategyAria'),
                    }
                  : undefined;
              return (
                <CompareVariantRow
                  key={variant.id}
                  variant={variant}
                  runHostKind={variantRunHostKind}
                  branchConfiguration={variantBranchConfiguration}
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
            {scaffoldsOwnProject ? null : isProjectLocked ? (
              <TaskScopedProjectButton
                label={lockedProjectName ?? selectedProjectId ?? ''}
                tooltip={
                  taskScopedTarget
                    ? t('home.taskConversationScopeTooltip')
                    : t('home.subtaskScopeTooltip')
                }
              />
            ) : (
              <div className="flex h-7 items-stretch overflow-hidden rounded-md border border-border bg-background-1 transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
                <ProjectSelector
                  value={selectedProjectId}
                  onChange={setSelectedProjectId}
                  allowProjectless
                  initializeGitRepositoryOnPick
                  trigger={
                    <ComboboxTrigger className="flex h-full items-center gap-1.5 rounded-none border-0 bg-transparent px-2.5 text-xs text-foreground outline-none transition-colors hover:bg-background-2">
                      <FolderOpen className="size-3.5 text-foreground-muted" />
                      <ComboboxValue placeholder={t('home.selectProjectPlaceholder')} />
                    </ComboboxTrigger>
                  }
                />
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="h-full w-7 rounded-none border-l border-border bg-transparent focus-visible:border-l-border focus-visible:bg-background-2 focus-visible:ring-0"
                        disabled={!selectedProjectId}
                        aria-label={t('home.revealProjectInSidebar')}
                        onClick={revealSelectedProjectInSidebar}
                      />
                    }
                  >
                    <LocateFixed className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>{t('home.revealProjectInSidebar')}</TooltipContent>
                </Tooltip>
              </div>
            )}
            {!scaffoldsOwnProject && (
              <EnvironmentSelector
                kind={runHostKind}
                onSelectKind={isProjectLocked ? undefined : selectRunHostProject}
                branchConfiguration={environmentBranchConfiguration}
              />
            )}
            {scaffoldsOwnProject && <Chip icon={AppWindow}>{t('home.buildDestination')}</Chip>}
            {scaffoldsOwnProject && submitting && (
              <span className="flex h-7 items-center gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 text-xs font-medium text-amber-700 ydark:text-amber-300">
                <Loader2 className="size-3.5 animate-spin" />
                {t('home.buildGenerating')}
              </span>
            )}
            {!taskScopedTarget && mounted && activeKind.kindId === 'team' && (
              <Chip icon={GitFork}>{t('home.teamBranchPolicy')}</Chip>
            )}
            <ParadigmSelector
              kindId={activeKind.kindId}
              paradigmId={selectedParadigmId}
              agents={userAgents}
              draftAgents={selectedAgentIdsByMode}
              onChange={setParadigm}
            />
            {renderComposerSettingsButton()}
            {!taskScopedTarget && activeKind.kindId === 'single' && renderAddCompareButton()}
          </div>
        )}
      </div>
    </div>
  );
});

/** DnD payload type for reordering comparison variant rows by drag handle. */
const VARIANT_DND_TYPE = 'application/x-yoda-compare-variant';

/**
 * One comparison environment under the composer. Mirrors the base row's project,
 * consolidated environment, runtime/model, and settings controls, with a left
 * drag handle to reorder the variants.
 * Empty fields fall back to the base config at submit time.
 */
function CompareVariantRow({
  variant,
  runHostKind,
  branchConfiguration,
  modelLabel,
  renderSettings,
  trailing,
  onChange,
  onRunHostChange,
  onRemove,
  onReorder,
}: {
  variant: CompareVariant;
  runHostKind: RunHostKind;
  branchConfiguration?: EnvironmentBranchConfiguration;
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
      {variant.projectId && (
        <EnvironmentSelector
          kind={runHostKind}
          onSelectKind={onRunHostChange}
          branchConfiguration={branchConfiguration}
        />
      )}
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

function explicitTaskOutputLanguageFromI18n(language?: string | null): ExplicitTaskOutputLanguage {
  return language?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
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

interface EnvironmentBranchConfiguration {
  projectId: string;
  strategyKind: TaskStrategyKind;
  locked: boolean;
  forkDisabled: boolean;
  branchValue: Branch | undefined;
  branchLabel: string;
  branchRunsInPlace: boolean;
  onBranchChange: (next: Branch) => void;
  onForkChange: (forked: boolean) => void;
  forkLabels: StrategyChipLabels;
  baseBranchAriaLabel: string;
  forkAriaLabel: string;
}

interface EnvironmentSelectorProps extends RunHostSelectorProps {
  branchConfiguration?: EnvironmentBranchConfiguration;
}

interface StrategyChipLabels {
  newBranchTitle: string;
  newBranchDesc: string;
  noWorktreeTitle: string;
  noWorktreeDesc: string;
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

/**
 * The host, starting branch, and branch-creation policy form one execution
 * environment. Keep their current values visible in one compact label group;
 * the dropdown retains the detailed controls without spending three toolbar slots.
 */
function EnvironmentSelector({
  kind,
  onSelectKind,
  branchConfiguration,
}: EnvironmentSelectorProps) {
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
  const forking = branchConfiguration?.strategyKind === 'new-branch';
  const branchStrategyLabel = forking
    ? t('home.environmentNewBranch')
    : t('home.environmentExistingBranch');
  const summary = [
    current.label,
    branchConfiguration?.branchLabel,
    branchConfiguration ? branchStrategyLabel : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' · ');
  const BranchIcon =
    branchConfiguration && !forking && branchConfiguration.branchRunsInPlace ? Anchor : GitBranch;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            data-yoda-surface="home-composer-environment"
            type="button"
            aria-label={`${t('home.environmentAria')}：${summary}`}
            title={summary}
            className="flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border bg-background-1 px-2.5 text-xs text-foreground transition-colors hover:bg-background-2"
          >
            <CurrentIcon className="size-3.5 shrink-0 text-foreground-muted" />
            {branchConfiguration ? (
              <>
                <span aria-hidden="true" className="text-foreground-passive">
                  ·
                </span>
                <span className="min-w-0 max-w-32 truncate">{branchConfiguration.branchLabel}</span>
                {forking ? (
                  <>
                    <span aria-hidden="true" className="text-foreground-passive">
                      ·
                    </span>
                    <span className="shrink-0">{t('home.environmentNewBranchCompact')}</span>
                  </>
                ) : null}
              </>
            ) : null}
            <ChevronDown className="size-3 shrink-0 text-foreground-muted" />
          </button>
        }
      />
      <DropdownMenuContent align="start" className="w-72 p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('home.environmentHostLabel')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={kind}
            onValueChange={(nextKind) => {
              if (nextKind === 'local' || nextKind === 'ssh') onSelectKind?.(nextKind);
            }}
          >
            {options.map((option) => {
              const Icon = option.icon;
              return (
                <DropdownMenuRadioItem
                  key={option.kind}
                  value={option.kind}
                  disabled={!onSelectKind}
                  className="gap-2 rounded-md px-2.5 py-2"
                >
                  <Icon className="size-4 shrink-0 text-foreground-muted" />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {option.label}
                  </span>
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {branchConfiguration ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('home.environmentBranchLabel')}</DropdownMenuLabel>
              {branchConfiguration.locked ? (
                <DropdownMenuItem disabled className="gap-2 rounded-md px-2.5 py-2">
                  <BranchIcon className="size-4 shrink-0 text-foreground-muted" />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {branchConfiguration.branchLabel}
                  </span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger
                    aria-label={branchConfiguration.baseBranchAriaLabel}
                    className="gap-2 rounded-md px-2.5 py-2"
                  >
                    <BranchIcon className="size-4 shrink-0 text-foreground-muted" />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {branchConfiguration.branchLabel}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-64 p-1.5">
                    <ProjectBranchMenuItems
                      projectId={branchConfiguration.projectId}
                      value={branchConfiguration.branchValue}
                      onValueChange={branchConfiguration.onBranchChange}
                    />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('home.environmentBranchStrategyLabel')}</DropdownMenuLabel>
              <DropdownMenuItem
                closeOnClick={false}
                disabled={branchConfiguration.forkDisabled}
                onClick={() => branchConfiguration.onForkChange(!forking)}
                className="items-start gap-2 rounded-md px-2.5 py-2"
              >
                <GitFork className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-foreground">
                    {t('home.environmentNewBranch')}
                  </span>
                  <span className="mt-0.5 block whitespace-normal text-[11px] leading-snug text-foreground-passive">
                    {forking
                      ? branchConfiguration.forkLabels.newBranchDesc
                      : branchConfiguration.forkLabels.noWorktreeDesc}
                  </span>
                </span>
                <Switch
                  size="sm"
                  checked={forking}
                  disabled={branchConfiguration.forkDisabled}
                  aria-label={branchConfiguration.forkAriaLabel}
                  onCheckedChange={branchConfiguration.onForkChange}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                  className="mt-0.5"
                />
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const homeView = {
  WrapView: HomeViewWrapper,
  TitlebarSlot: HomeTitlebar,
  MainPanel: HomeMainPanel,
};
