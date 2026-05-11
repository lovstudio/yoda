import {
  ArrowUp,
  ChevronDown,
  FolderOpen,
  GitBranch,
  Mic,
  Monitor,
  Pin,
  Plus,
  Server,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import yodaLogoWhite from '@/assets/images/yoda/yoda_logo_white.svg';
import yodaLogo from '@/assets/images/yoda/yoda_logo.svg';
import { ensureUniqueTaskSlug } from '@shared/task-name';
import {
  asMounted,
  getProjectManagerStore,
  getRepositoryStore,
} from '@renderer/features/projects/stores/project-selectors';
import { useEffectiveProvider } from '@renderer/features/tasks/conversations/use-effective-provider';
import { ProjectSelector } from '@renderer/features/tasks/create-task-modal/project-selector';
import { useAgentAutoApproveDefaults } from '@renderer/features/tasks/hooks/useAgentAutoApproveDefaults';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { ComboboxTrigger, ComboboxValue } from '@renderer/lib/ui/combobox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';

type TaskStrategyKind = 'new-branch' | 'no-worktree';

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

  const projectManager = getProjectManagerStore();
  const mountedProjects = useMemo(
    () =>
      Array.from(projectManager.projects.values()).flatMap((s) => {
        const m = asMounted(s);
        return m ? [m] : [];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectManager.projects.size]
  );

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

  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(
    () =>
      homeProjectId ??
      navProjectId ??
      Array.from(projectManager.projects.values())
        .reverse()
        .find((p) => p.state === 'mounted')?.data?.id
  );

  useEffect(() => {
    if (!homeProjectId) return;
    setSelectedProjectId(homeProjectId);
    setHomeParams({ projectId: undefined });
  }, [homeProjectId, setHomeParams]);

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

  const { providerId, setProviderOverride } = useEffectiveProvider(connectionId);
  const autoApproveDefaults = useAgentAutoApproveDefaults();

  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [strategyKind, setStrategyKind] = useState<TaskStrategyKind>('new-branch');
  const effectiveStrategyKind: TaskStrategyKind = isUnborn ? 'no-worktree' : strategyKind;
  const trimmed = prompt.trim();
  const canSubmit =
    !!mounted && !!providerId && !!defaultBranch && trimmed.length > 0 && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!mounted || !providerId || !defaultBranch || trimmed.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const taskId = crypto.randomUUID();
      const baseName = await rpc.tasks.generateTaskName({ title: trimmed });
      const existingNames = Array.from(mounted.taskManager.tasks.values(), (t) => t.data.name);
      const taskName = ensureUniqueTaskSlug(baseName, existingNames);

      const strategy =
        effectiveStrategyKind === 'no-worktree'
          ? ({ kind: 'no-worktree' } as const)
          : ({ kind: 'new-branch', taskBranch: taskName, pushBranch: false } as const);

      void mounted.taskManager.createTask({
        id: taskId,
        projectId: mounted.data.id,
        name: taskName,
        sourceBranch: defaultBranch,
        strategy,
        initialConversation: {
          id: crypto.randomUUID(),
          projectId: mounted.data.id,
          taskId,
          provider: providerId,
          title: taskName,
          initialPrompt: trimmed,
          autoApprove: autoApproveDefaults.getDefault(providerId),
        },
      });
      navigate('task', { projectId: mounted.data.id, taskId });
      setPrompt('');
    } finally {
      setSubmitting(false);
    }
  }, [
    mounted,
    providerId,
    defaultBranch,
    effectiveStrategyKind,
    trimmed,
    submitting,
    autoApproveDefaults,
    navigate,
  ]);

  const recentTasks = useMemo(() => {
    type RecentEntry = {
      id: string;
      projectId: string;
      projectName: string;
      projectType: 'local' | 'ssh';
      name: string;
      createdAt: string;
    };
    const entries: RecentEntry[] = [];
    for (const p of mountedProjects) {
      for (const t of p.taskManager.tasks.values()) {
        entries.push({
          id: t.data.id,
          projectId: p.data.id,
          projectName: p.data.name,
          projectType: p.data.type,
          name: t.data.name,
          createdAt: t.data.createdAt,
        });
      }
    }
    entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return entries.slice(0, 5);
  }, [mountedProjects]);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background text-foreground">
      <div className="container mx-auto flex min-h-full max-w-3xl flex-1 flex-col px-8 pb-12 pt-24">
        <div className="mb-8 text-center">
          <div className="mb-4 flex items-center justify-center">
            <img
              key={effectiveTheme}
              src={effectiveTheme === 'ydark' ? yodaLogoWhite : yodaLogo}
              alt="Yoda"
              className="h-9"
            />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('home.headline')}</h1>
        </div>

        <div className="rounded-2xl border border-border bg-background-1 shadow-sm">
          <div className="flex flex-col">
            <Textarea
              autoFocus
              placeholder={t('home.promptPlaceholder')}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  e.keyCode !== 229
                ) {
                  e.preventDefault();
                  if (canSubmit) void handleSubmit();
                }
              }}
              className="min-h-28 resize-none border-0 bg-transparent px-5 py-4 text-base placeholder:text-foreground-muted focus-visible:ring-0"
            />
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
                <AgentSelector
                  value={providerId}
                  onChange={setProviderOverride}
                  connectionId={connectionId}
                  className="h-8 gap-1.5 rounded-full border-0 bg-background-2/60 px-3 text-xs font-medium text-foreground transition-colors hover:bg-background-2"
                />
                <button
                  type="button"
                  aria-label={t('home.voiceAria')}
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground"
                >
                  <Mic className="size-4" />
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

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ProjectSelector
            value={selectedProjectId}
            onChange={setSelectedProjectId}
            trigger={
              <ComboboxTrigger className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background-1 px-2.5 text-xs text-foreground transition-colors hover:bg-background-2">
                <FolderOpen className="size-3.5 text-foreground-muted" />
                <ComboboxValue placeholder={t('home.selectProjectPlaceholder')} />
              </ComboboxTrigger>
            }
          />
          <Chip icon={projectData?.type === 'ssh' ? Server : Monitor}>
            {projectData?.type === 'ssh' ? t('home.remoteMode') : t('home.localMode')}
          </Chip>
          <StrategyChip
            strategyKind={effectiveStrategyKind}
            disabled={isUnborn || !mounted}
            onChange={setStrategyKind}
            ariaLabel={t('home.strategyAria')}
            labels={{
              newBranch: t('home.strategyNewBranch'),
              noWorktree: t('home.strategyNoWorktree', { branch: branchLabel }),
              base: t('home.baseBranchLabel', { branch: branchLabel }),
            }}
          />
          {!mounted && (
            <span className="text-xs text-foreground-muted">{t('home.needProjectHint')}</span>
          )}
        </div>

        {recentTasks.length > 0 && (
          <div className="mt-10 flex flex-col">
            {recentTasks.map((t) => {
              const ProjectIcon = t.projectType === 'ssh' ? Server : Monitor;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => navigate('task', { projectId: t.projectId, taskId: t.id })}
                  className="flex items-center gap-3 border-b border-border/60 py-3 text-left text-sm text-foreground-muted transition-colors hover:text-foreground"
                >
                  <GitBranch className="size-4 shrink-0 text-foreground-passive" />
                  <span className="truncate">{t.name}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-foreground-passive">
                    <ProjectIcon className="size-3.5" />
                    <span className="max-w-[12rem] truncate">{t.projectName}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

interface ChipProps {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}

function Chip({ icon: Icon, children }: ChipProps) {
  return (
    <span className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background-1 px-2.5 text-xs text-foreground">
      <Icon className="size-3.5 text-foreground-muted" />
      {children}
    </span>
  );
}

interface StrategyChipProps {
  strategyKind: TaskStrategyKind;
  disabled: boolean;
  onChange: (next: TaskStrategyKind) => void;
  ariaLabel: string;
  labels: { newBranch: string; noWorktree: string; base: string };
}

function StrategyChip({
  strategyKind,
  disabled,
  onChange,
  ariaLabel,
  labels,
}: StrategyChipProps) {
  const isNewBranch = strategyKind === 'new-branch';
  const Icon = isNewBranch ? GitBranch : Pin;
  const label = isNewBranch ? labels.base : labels.noWorktree;

  if (disabled) {
    return (
      <span className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background-1 px-2.5 text-xs text-foreground">
        <Icon className="size-3.5 text-foreground-muted" />
        {label}
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
            <span>{label}</span>
            <ChevronDown className="size-3 text-foreground-muted" />
          </button>
        }
      />
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuItem onClick={() => onChange('new-branch')}>
          <GitBranch className="size-4 text-foreground-muted" />
          <div className="flex flex-col">
            <span>{labels.newBranch}</span>
            <span className="text-xs text-foreground-muted">{labels.base}</span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onChange('no-worktree')}>
          <Pin className="size-4 text-foreground-muted" />
          <span>{labels.noWorktree}</span>
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
