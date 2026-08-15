import {
  AppWindow,
  ArrowLeft,
  ClipboardList,
  Code2,
  ExternalLink,
  FolderOpen,
  Link2,
  Loader2,
  Pin,
  PinOff,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiLabUserApp } from '@shared/ai-lab';
import { buildAiLabAppDeepLink } from '@shared/deep-links';
import { getRuntime } from '@shared/runtime-registry';
import { ensureUniqueTaskDisplayName, taskNameFromPrompt } from '@shared/task-name';
import type { MountedProject } from '@renderer/features/projects/stores/project';
import {
  asMounted,
  getProjectManagerStore,
} from '@renderer/features/projects/stores/project-selectors';
import { useEffectiveRuntime } from '@renderer/features/tasks/conversations/use-effective-runtime';
import { HeaderActionButton, HeaderActionToolbar } from '@renderer/lib/components/header-actions';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import { buildAiLabAppBasicInfo } from '../ai-lab-app-basic-info';
import { AI_LAB_APPS, type AiLabAppDefinition } from '../app-registry';
import { createAiLabProject } from '../create-ai-lab-project';
import { startAiLabBuildTask } from '../start-ai-lab-build-task';
import {
  useAiLabApps,
  useAssignAiLabAppProject,
  useDeleteAiLabApp,
  useUpdateAiLabApp,
} from '../use-ai-lab';
import { UserAppFrame } from './user-app-frame';

type AiLabViewProps = {
  embedded?: boolean;
  activeAppId?: string | null;
  onActiveAppChange?: (appId: string | null) => void;
};

/** Apps shelf: every generated app is created here and launched from here. */
export const AiLabView: React.FC<AiLabViewProps> = ({
  embedded = false,
  activeAppId: controlledAppId,
  onActiveAppChange,
}) => {
  const [localAppId, setLocalAppId] = useState<string | null>(null);
  const activeAppId = onActiveAppChange ? (controlledAppId ?? null) : localAppId;
  const setActiveAppId = onActiveAppChange ?? setLocalAppId;
  const apps = useAiLabApps();
  const userApp = apps.data?.find((app) => app.id === activeAppId) ?? null;
  const builtInApp = AI_LAB_APPS.find((app) => `builtin:${app.id}` === activeAppId) ?? null;

  const content = userApp ? (
    <UserAppHost app={userApp} onBack={() => setActiveAppId(null)} />
  ) : builtInApp ? (
    <BuiltInAppHost app={builtInApp} onBack={() => setActiveAppId(null)} />
  ) : (
    <Launcher apps={apps.data ?? []} onOpen={setActiveAppId} showHeader={!embedded} />
  );

  if (embedded) {
    return <div className="@container flex h-full min-h-0 flex-col">{content}</div>;
  }
  return (
    <div className="@container flex h-full min-h-0 flex-col bg-background text-foreground">
      {content}
    </div>
  );
};

function Launcher({
  apps,
  onOpen,
  showHeader,
}: {
  apps: AiLabUserApp[];
  onOpen: (appId: string) => void;
  showHeader: boolean;
}) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const { toast } = useToast();
  const { runtimeId } = useEffectiveRuntime();
  const [isComposing, setIsComposing] = useState(false);
  const [requirement, setRequirement] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // An app owns its project, so the requirement has to be in hand before
  // anything is created: it names the project and seeds the first task.
  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const prompt = requirement.trim();
    if (!prompt || isCreating) return;
    if (!runtimeId) {
      toast({
        title: t('aiLab.createFailed'),
        description: t('aiLab.createAgentUnavailable'),
        variant: 'destructive',
      });
      return;
    }
    setIsCreating(true);
    try {
      const project = await createAiLabProject(
        taskNameFromPrompt(prompt) || t('aiLab.defaultAppProjectName')
      );
      await project.taskManager.loadTasks();
      const launch = await startAiLabBuildTask({
        project,
        prompt,
        runtimeId,
        taskName: ensureUniqueTaskDisplayName(
          t('aiLab.buildTaskName'),
          Array.from(project.taskManager.tasks.values(), (task) => task.data.name)
        ),
      });
      setRequirement('');
      setIsComposing(false);
      navigate('task', {
        projectId: project.data.id,
        taskId: launch.taskId,
        tab: { kind: 'conversation', conversationId: launch.conversationId },
      });
      void launch.promise.catch((error: unknown) => {
        toast({
          title: t('aiLab.createFailed'),
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        });
      });
    } catch (error) {
      toast({
        title: t('aiLab.createFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-7 px-6 py-8 @max-md:px-4 @max-md:py-5">
        {showHeader && (
          <header className="flex items-center gap-2">
            <AppWindow className="size-4 text-foreground-muted" />
            <h1 className="text-sm font-semibold">{t('marketplace.sections.apps')}</h1>
          </header>
        )}

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">{t('aiLab.myApps')}</h2>
              <p className="mt-0.5 text-xs text-foreground-muted">{t('aiLab.myAppsDescription')}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs tabular-nums text-foreground-passive">{apps.length}</span>
              <Button
                size="sm"
                variant={isComposing ? 'secondary' : 'default'}
                aria-expanded={isComposing}
                disabled={isCreating}
                onClick={() => setIsComposing((current) => !current)}
              >
                <Plus />
                {t('aiLab.newApp')}
              </Button>
            </div>
          </div>
          {isComposing && (
            <form
              className="mb-3 flex items-end gap-2 rounded-xl border border-border bg-background-secondary p-3 @max-md:flex-col @max-md:items-stretch"
              onSubmit={(event) => void handleCreate(event)}
            >
              <div className="min-w-0 flex-1">
                <label htmlFor="ai-lab-new-app" className="mb-1 block text-xs font-medium">
                  {t('aiLab.createTitle')}
                </label>
                <Textarea
                  id="ai-lab-new-app"
                  rows={2}
                  maxLength={4_000}
                  autoFocus
                  value={requirement}
                  placeholder={t('aiLab.createPlaceholder')}
                  disabled={isCreating}
                  onChange={(event) => setRequirement(event.target.value)}
                />
              </div>
              <Button type="submit" disabled={!requirement.trim() || isCreating}>
                {isCreating ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {isCreating ? t('aiLab.creating') : t('aiLab.createSubmit')}
              </Button>
            </form>
          )}
          <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
            {apps.map((app) => (
              <AppTile key={app.id} app={app} onOpen={() => onOpen(app.id)} />
            ))}
            {apps.length === 0 && (
              <button
                type="button"
                onClick={() => setIsComposing(true)}
                className="col-span-full flex min-h-28 items-center gap-4 rounded-xl border border-dashed border-border px-5 py-4 text-left text-foreground-muted transition-colors hover:border-border-primary hover:bg-background-secondary"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background-2">
                  <Plus className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground-muted">
                    {t('aiLab.emptyTitle')}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed">{t('aiLab.emptyDescription')}</p>
                </div>
              </button>
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold">{t('aiLab.builtInApps')}</h2>
          <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
            {AI_LAB_APPS.map((app) => (
              <button
                key={app.id}
                type="button"
                onClick={() => onOpen(`builtin:${app.id}`)}
                className="group flex items-start gap-3 rounded-xl border border-border bg-background-secondary p-4 text-left transition-[border-color,transform] hover:-translate-y-0.5 hover:border-border-primary"
              >
                <span
                  className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-xl',
                    app.iconClassName
                  )}
                >
                  <app.icon className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {t(`aiLab.apps.${app.id}.name`)}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-foreground-muted">
                    {t(`aiLab.apps.${app.id}.description`)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function AppTile({ app, onOpen }: { app: AiLabUserApp; onOpen: () => void }) {
  const { t } = useTranslation();
  const updateApp = useUpdateAiLabApp();
  return (
    <div className="group relative flex items-start gap-3 rounded-xl border border-border bg-background-secondary p-4 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-border-primary">
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 rounded-xl"
        aria-label={app.name}
      />
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
        <AppWindow className="size-5" />
      </span>
      <span className="min-w-0 flex-1 pr-7">
        <span className="block truncate text-sm font-medium">{app.name}</span>
        <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-foreground-muted">
          {app.description}
        </span>
        {app.runtimeId && (
          <span className="mt-1.5 block truncate font-mono text-[10px] text-foreground-passive">
            {getRuntime(app.runtimeId)?.name ?? app.runtimeId}
            {app.model ? ` · ${app.model}` : ''}
          </span>
        )}
      </span>
      <Button
        size="icon-xs"
        variant="ghost"
        className="relative z-10 shrink-0"
        disabled={updateApp.isPending}
        aria-label={app.pinned ? t('aiLab.unpin') : t('aiLab.pin')}
        title={app.pinned ? t('aiLab.unpin') : t('aiLab.pin')}
        onClick={() => updateApp.mutate({ id: app.id, pinned: !app.pinned })}
      >
        {app.pinned ? <PinOff /> : <Pin />}
      </Button>
    </div>
  );
}

function BuiltInAppHost({ app, onBack }: { app: AiLabAppDefinition; onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-6 px-6 py-8 @max-md:px-4">
        <header className="flex items-start gap-2">
          <BackButton onBack={onBack} />
          <div className="min-w-0">
            <h1 className="text-sm font-semibold">{t(`aiLab.apps.${app.id}.name`)}</h1>
            <p className="mt-0.5 text-xs leading-relaxed text-foreground-muted">
              {t(`aiLab.apps.${app.id}.description`)}
            </p>
          </div>
        </header>
        <app.Component />
      </div>
    </div>
  );
}

function UserAppHost({ app, onBack }: { app: AiLabUserApp; onBack: () => void }) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const { toast } = useToast();
  const updateApp = useUpdateAiLabApp();
  const deleteApp = useDeleteAiLabApp();
  const assignAppProject = useAssignAiLabAppProject();
  const [isOpeningWindow, setIsOpeningWindow] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [isPreparingRefinement, setIsPreparingRefinement] = useState(false);
  const [refinement, setRefinement] = useState('');
  const refinementPending = isPreparingRefinement || assignAppProject.isPending;

  const openAppProject = () => {
    if (!app.projectId || app.projectKind !== 'app') return;
    navigate('project', { projectId: app.projectId });
  };

  const openBuildTask = () => {
    if (!app.projectId || !app.taskId) return;
    navigate('task', {
      projectId: app.projectId,
      taskId: app.taskId,
      ...(app.conversationId
        ? { tab: { kind: 'conversation' as const, conversationId: app.conversationId } }
        : {}),
    });
  };

  const handleDelete = () => {
    if (!window.confirm(t('aiLab.deleteConfirm', { name: app.name }))) return;
    deleteApp.mutate(app.id, {
      onSuccess: onBack,
      onError: (error) =>
        toast({
          title: t('aiLab.deleteFailed'),
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        }),
    });
  };

  const openInWindow = async () => {
    setIsOpeningWindow(true);
    try {
      const result = await rpc.app.openAiLabWindow({ appId: app.id });
      if (!result.success) {
        toast({
          title: t('aiLab.openInWindowFailed'),
          description: result.error,
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: t('aiLab.openInWindowFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsOpeningWindow(false);
    }
  };

  const copyAppText = async (value: string, successMessage: string) => {
    try {
      const result = await rpc.app.clipboardWriteText(value);
      if (!result.success) throw new Error(result.error);
      toast({ title: successMessage });
    } catch (error) {
      toast({
        title: t('aiLab.copyFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const copyYodaLink = () => {
    void copyAppText(buildAiLabAppDeepLink({ appId: app.id }), t('aiLab.yodaLinkCopied'));
  };

  const copyBasicInfo = async () => {
    const project = app.projectId
      ? await rpc.projects.getProject(app.projectId).catch(() => undefined)
      : undefined;
    const value = buildAiLabAppBasicInfo(
      {
        appName: app.name,
        description: app.description,
        appId: app.id,
        yodaLink: buildAiLabAppDeepLink({ appId: app.id }),
        projectId: app.projectId,
        projectPath: project?.path,
        startCommand:
          app.runtimeKind === 'react-vite' && project?.path ? 'pnpm run dev' : undefined,
        runtimeKind: app.runtimeKind,
        runtimeName: app.runtimeId ? (getRuntime(app.runtimeId)?.name ?? app.runtimeId) : undefined,
        model: app.model,
        capabilities: app.capabilities,
      },
      {
        app: t('aiLab.basicInfo.app'),
        description: t('aiLab.basicInfo.description'),
        appId: t('aiLab.basicInfo.appId'),
        yodaLink: t('aiLab.basicInfo.yodaLink'),
        projectId: t('aiLab.basicInfo.projectId'),
        projectPath: t('aiLab.basicInfo.projectPath'),
        startCommand: t('aiLab.basicInfo.startCommand'),
        runtimeKind: t('aiLab.basicInfo.runtimeKind'),
        runtime: t('aiLab.basicInfo.runtime'),
        model: t('aiLab.basicInfo.model'),
        capabilities: t('aiLab.basicInfo.capabilities'),
      }
    );
    if (value) await copyAppText(value, t('aiLab.basicInfoCopied'));
  };

  const handleRefine = async (event: React.FormEvent) => {
    event.preventDefault();
    const prompt = refinement.trim();
    if (!prompt || refinementPending) return;
    setIsPreparingRefinement(true);
    try {
      let project: MountedProject | undefined;
      if (app.projectKind !== 'app' || !app.projectId) {
        project = await createAiLabProject(app.name);
        await assignAppProject.mutateAsync({ id: app.id, projectId: project.data.id });
      } else {
        const projectManager = getProjectManagerStore();
        const loaded = await projectManager.ensureProjectLoaded(app.projectId);
        if (!loaded) throw new Error(t('aiLab.appProjectUnavailable'));
        await projectManager.mountProject(app.projectId);
        project = asMounted(projectManager.projects.get(app.projectId));
      }
      if (!project) throw new Error(t('aiLab.appProjectUnavailable'));
      if (!app.runtimeId) throw new Error(t('aiLab.appAgentUnavailable'));
      await project.taskManager.loadTasks();
      const taskName = ensureUniqueTaskDisplayName(
        t('aiLab.refineTaskName'),
        Array.from(project.taskManager.tasks.values(), (task) => task.data.name)
      );
      const launch = await startAiLabBuildTask({
        project,
        appId: app.id,
        prompt,
        taskName,
        runtimeId: app.runtimeId,
        model: app.model,
      });
      setRefinement('');
      setIsRefining(false);
      navigate('task', {
        projectId: project.data.id,
        taskId: launch.taskId,
        tab: { kind: 'conversation', conversationId: launch.conversationId },
      });
      void launch.promise.catch((error: unknown) => {
        toast({
          title: t('aiLab.refineFailed'),
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        });
      });
    } catch (error) {
      toast({
        title: t('aiLab.refineFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsPreparingRefinement(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <BackButton onBack={onBack} />
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
          <AppWindow className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-medium">{app.name}</h1>
          <p className="truncate text-[11px] text-foreground-muted">{app.description}</p>
        </div>
        <Button
          size="sm"
          variant={isRefining ? 'secondary' : 'default'}
          aria-expanded={isRefining}
          disabled={refinementPending}
          onClick={() => setIsRefining((current) => !current)}
        >
          <Sparkles />
          {t('aiLab.refine')}
        </Button>
        <HeaderActionToolbar label={t('aiLab.appActions')}>
          <HeaderActionButton
            label={t('aiLab.openInWindow')}
            disabled={isOpeningWindow}
            onClick={() => void openInWindow()}
          >
            {isOpeningWindow ? <Loader2 className="animate-spin" /> : <ExternalLink />}
          </HeaderActionButton>
          <HeaderActionButton label={t('aiLab.copyYodaLink')} onClick={copyYodaLink}>
            <Link2 />
          </HeaderActionButton>
          <HeaderActionButton label={t('aiLab.copyBasicInfo')} onClick={() => void copyBasicInfo()}>
            <ClipboardList />
          </HeaderActionButton>
          {app.projectKind === 'app' && app.projectId && (
            <HeaderActionButton label={t('aiLab.openAppProject')} onClick={openAppProject}>
              <FolderOpen />
            </HeaderActionButton>
          )}
          {app.projectId && app.taskId && (
            <HeaderActionButton label={t('aiLab.openLatestBuildTask')} onClick={openBuildTask}>
              <Code2 />
            </HeaderActionButton>
          )}
          <HeaderActionButton
            label={app.pinned ? t('aiLab.unpin') : t('aiLab.pin')}
            variant={app.pinned ? 'secondary' : 'ghost'}
            aria-pressed={app.pinned}
            disabled={updateApp.isPending}
            onClick={() => updateApp.mutate({ id: app.id, pinned: !app.pinned })}
          >
            {app.pinned ? <PinOff /> : <Pin />}
          </HeaderActionButton>
          <HeaderActionButton
            label={t('aiLab.delete')}
            className="hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive"
            disabled={deleteApp.isPending}
            onClick={handleDelete}
          >
            <Trash2 />
          </HeaderActionButton>
        </HeaderActionToolbar>
      </header>
      {isRefining && (
        <form
          className="flex shrink-0 items-end gap-2 border-b border-border bg-background-secondary px-3 py-3 @max-md:flex-col @max-md:items-stretch"
          onSubmit={(event) => void handleRefine(event)}
        >
          <div className="min-w-0 flex-1">
            <label htmlFor={`refine-${app.id}`} className="mb-1 block text-xs font-medium">
              {t('aiLab.refineTitle')}
            </label>
            <Textarea
              id={`refine-${app.id}`}
              rows={2}
              maxLength={4_000}
              autoFocus
              value={refinement}
              placeholder={t('aiLab.refinePlaceholder')}
              disabled={refinementPending}
              onChange={(event) => setRefinement(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={!refinement.trim() || refinementPending}>
            {refinementPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {refinementPending ? t('aiLab.refining') : t('aiLab.applyRefinement')}
          </Button>
        </form>
      )}
      <div className="min-h-0 flex-1 bg-background-secondary p-3 @max-md:p-0">
        <UserAppFrame app={app} className="@max-md:rounded-none @max-md:border-0" />
      </div>
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <HeaderActionButton label={t('aiLab.back')} onClick={onBack} className="shrink-0">
      <ArrowLeft />
    </HeaderActionButton>
  );
}
