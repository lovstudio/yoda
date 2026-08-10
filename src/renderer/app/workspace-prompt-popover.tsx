import {
  ArrowUpRight,
  Building2,
  FolderCog,
  LockKeyhole,
  Sparkles,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectPromptPrinciples } from '@shared/project-settings';
import type { Prompt } from '@shared/prompt-library';
import { getRuntime, type RuntimeId } from '@shared/runtime-registry';
import {
  effectiveGlobalEnabled,
  setGlobalOverride,
} from '@renderer/features/projects/project-prompt-principles';
import {
  asMounted,
  getProjectSettingsStore,
  getProjectStore,
} from '@renderer/features/projects/stores/project-selectors';
import { PromptInjectionControls } from '@renderer/features/prompt-library/prompt-injection-controls';
import { usePrompts, useUpdatePrompt } from '@renderer/features/prompt-library/use-prompts';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@renderer/lib/ui/tabs';
import { cn } from '@renderer/utils/utils';

type PromptScope = 'user' | 'project' | 'enterprise';

const PROMPT_SCOPES: PromptScope[] = ['user', 'project', 'enterprise'];

function runtimeSupportsPromptInjection(runtimeId: RuntimeId): boolean {
  const runtime = getRuntime(runtimeId);
  return Boolean(runtime?.appendSystemPromptFlag || runtime?.appendSystemPromptConfigKey);
}

export const WorkspacePromptPopover = observer(function WorkspacePromptPopover({
  runtimeId,
  projectId,
  onOpenLibrary,
  triggerClassName,
  triggerLabelClassName,
}: {
  runtimeId: RuntimeId;
  projectId?: string;
  onOpenLibrary: () => void;
  triggerClassName?: string;
  triggerLabelClassName?: string;
}) {
  const { t } = useTranslation();
  const runtime = getRuntime(runtimeId);
  const runtimeName = runtime?.name ?? runtimeId;
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<PromptScope>('user');

  const handleOpenLibrary = useCallback(() => {
    setOpen(false);
    onOpenLibrary();
  }, [onOpenLibrary]);

  const triggerLabel = t('workspaceRuntime.prompt.triggerLabel', { name: runtimeName });

  return (
    <>
      <span aria-hidden className="@max-[1120px]:hidden">
        ·
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={triggerLabel}
          title={triggerLabel}
          className={cn(
            'flex h-5 shrink-0 items-center gap-1 rounded-sm px-1 text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border',
            triggerClassName,
            open && 'bg-background-2 text-foreground'
          )}
        >
          <Sparkles className="size-3.5" />
          <span className={triggerLabelClassName}>{t('workspaceRuntime.prompt.label')}</span>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="top"
          sideOffset={8}
          className="flex h-[min(68vh,34rem)] max-h-[calc(100vh-1rem)] min-h-0 w-[min(28rem,calc(100vw-1rem))] flex-col gap-0 overflow-hidden border border-border bg-background p-0 text-foreground shadow-lg"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border p-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <div className="text-sm font-medium">{t('workspaceRuntime.prompt.title')}</div>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {runtimeName}
                  </Badge>
                </div>
                <div className="mt-0.5 truncate text-xs text-foreground-passive">
                  {t('workspaceRuntime.prompt.description', { name: runtimeName })}
                </div>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="shrink-0"
              onClick={handleOpenLibrary}
            >
              <ArrowUpRight className="size-3.5" />
              {t('workspaceRuntime.prompt.manageLibrary')}
            </Button>
          </div>

          <Tabs
            value={scope}
            onValueChange={(value) => {
              if (PROMPT_SCOPES.includes(value as PromptScope)) setScope(value as PromptScope);
            }}
            className="min-h-0 flex-1 gap-0"
          >
            <TabsList
              aria-label={t('workspaceRuntime.prompt.tabsLabel')}
              className="mx-3 mt-3 w-auto shrink-0"
            >
              <TabsIndicator />
              <TabsTab value="user">{t('workspaceRuntime.prompt.userTab')}</TabsTab>
              <TabsTab value="project">{t('workspaceRuntime.prompt.projectTab')}</TabsTab>
              <TabsTab value="enterprise">{t('workspaceRuntime.prompt.enterpriseTab')}</TabsTab>
            </TabsList>

            <TabsPanel
              value="user"
              className="h-full min-h-0 overflow-y-auto overscroll-contain px-3 pb-3 pt-3"
            >
              <PromptScopeSummary
                icon={UserRound}
                title={t('workspaceRuntime.prompt.userTab')}
                description={t('workspaceRuntime.prompt.userScopeDescription')}
              />
              <PromptInjectionScopeSection runtimeId={runtimeId} scope="user" />
            </TabsPanel>

            <TabsPanel
              value="project"
              className="h-full min-h-0 overflow-y-auto overscroll-contain px-3 pb-3 pt-3"
            >
              <PromptScopeSummary
                icon={FolderCog}
                title={t('workspaceRuntime.prompt.projectTab')}
                description={t('workspaceRuntime.prompt.projectScopeDescription')}
                meta={
                  projectId
                    ? t('workspaceRuntime.prompt.currentProject')
                    : t('workspaceRuntime.prompt.projectNotSelected')
                }
              />
              <PromptInjectionScopeSection
                runtimeId={runtimeId}
                scope="project"
                projectId={projectId}
              />
            </TabsPanel>

            <TabsPanel
              value="enterprise"
              className="h-full min-h-0 overflow-y-auto overscroll-contain px-3 pb-3 pt-3"
            >
              <PromptScopeSummary
                icon={Building2}
                title={t('workspaceRuntime.prompt.enterpriseTitle')}
                description={t('workspaceRuntime.prompt.enterpriseDescription')}
                meta={t('workspaceRuntime.prompt.enterpriseManaged')}
              />
              <EnterprisePromptSection runtimeId={runtimeId} />
            </TabsPanel>
          </Tabs>
        </PopoverContent>
      </Popover>
    </>
  );
});

function PromptScopeSummary({
  icon: Icon,
  title,
  description,
  meta,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  meta?: string;
}) {
  return (
    <div className="flex items-start gap-2.5 border-b border-border/60 pb-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
          {meta ? (
            <span className="rounded bg-background-1 px-1.5 py-0.5 text-[10px] text-foreground-passive">
              {meta}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs leading-5 text-foreground-muted">{description}</p>
      </div>
    </div>
  );
}

const PromptInjectionScopeSection = observer(function PromptInjectionScopeSection({
  runtimeId,
  scope,
  projectId,
}: {
  runtimeId: RuntimeId;
  scope: 'user' | 'project';
  projectId?: string;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: prompts = [], isLoading } = usePrompts();
  const updatePrompt = useUpdatePrompt();
  const mountedProject =
    scope === 'project' && projectId ? asMounted(getProjectStore(projectId)) : undefined;
  const projectSettingsStore =
    scope === 'project' && projectId ? getProjectSettingsStore(projectId) : undefined;
  const projectSettings = projectSettingsStore?.settings;
  const saveQueue = useRef(Promise.resolve());

  useEffect(() => {
    if (scope !== 'project' || !projectId || !projectSettingsStore) return;
    if (!mountedProject) return;
    if (projectSettings === null) void projectSettingsStore.pageData.load();
  }, [mountedProject, projectId, projectSettings, projectSettingsStore, scope]);

  const orderedPrompts = useMemo(
    () => prompts.slice().sort((left, right) => left.injectionOrder - right.injectionOrder),
    [prompts]
  );

  const enabledCount = orderedPrompts.filter((prompt) =>
    scope === 'project'
      ? effectiveGlobalEnabled(projectSettings?.promptPrinciples, prompt)
      : prompt.injectionEnabled
  ).length;

  const saveProjectPromptPrinciples = (next: ProjectPromptPrinciples | undefined) => {
    if (!projectSettingsStore) return;
    saveQueue.current = saveQueue.current.then(async () => {
      const currentSettings = projectSettingsStore.settings;
      if (!currentSettings) return;
      const result = await projectSettingsStore.save({
        ...currentSettings,
        promptPrinciples: next,
      });
      if (!result.success) {
        toast({
          title: t('promptLibrary.project.saveFailed'),
          variant: 'destructive',
        });
        await projectSettingsStore.pageData.load();
      }
    });
  };

  const handlePromptEnabledChange = (prompt: Prompt, enabled: boolean) => {
    if (scope === 'project') {
      if (!projectSettingsStore?.settings) return;
      saveProjectPromptPrinciples(
        setGlobalOverride(projectSettingsStore.settings.promptPrinciples, prompt, enabled)
      );
      return;
    }
    updatePrompt.mutate({ id: prompt.id, patch: { injectionEnabled: enabled } });
  };

  const title =
    scope === 'project'
      ? t('workspaceRuntime.prompt.projectInjectionTitle')
      : t('workspaceRuntime.prompt.userInjectionTitle');
  const description =
    scope === 'project'
      ? t('workspaceRuntime.prompt.projectInjectionDescription')
      : t('workspaceRuntime.prompt.userInjectionDescription');
  const supportsInjection = runtimeSupportsPromptInjection(runtimeId);
  const projectReady = scope !== 'project' || Boolean(projectId && projectSettings);

  return (
    <section
      data-slot={`workspace-prompt-${scope}-injection`}
      className="mt-3 overflow-hidden rounded-lg border border-border bg-background-secondary"
    >
      <div className="flex items-start justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <h3 className="text-xs font-medium text-foreground">{title}</h3>
          <p className="mt-0.5 text-[11px] leading-4 text-foreground-muted">{description}</p>
        </div>
        {supportsInjection && projectReady ? (
          <span className="shrink-0 rounded bg-background-1 px-1.5 py-0.5 text-[10px] tabular-nums text-foreground-passive">
            {t('workspaceRuntime.prompt.enabledCount', {
              enabled: enabledCount,
              count: orderedPrompts.length,
            })}
          </span>
        ) : null}
      </div>

      {!supportsInjection ? (
        <p className="border-t border-border/60 px-3 py-3 text-xs leading-5 text-foreground-muted">
          {t('workspaceRuntime.prompt.injectionUnsupported', {
            name: getRuntime(runtimeId)?.name ?? runtimeId,
          })}
        </p>
      ) : scope === 'project' && !projectId ? (
        <p className="border-t border-border/60 px-3 py-3 text-xs leading-5 text-foreground-muted">
          {t('workspaceRuntime.prompt.projectRequired')}
        </p>
      ) : scope === 'project' && !projectReady ? (
        <p className="border-t border-border/60 px-3 py-3 text-xs leading-5 text-foreground-muted">
          {t('workspaceRuntime.prompt.projectLoading')}
        </p>
      ) : isLoading ? (
        <p className="border-t border-border/60 px-3 py-3 text-xs leading-5 text-foreground-muted">
          {t('common.loading')}
        </p>
      ) : (
        <PromptInjectionControls
          variant="compact"
          prompts={orderedPrompts}
          isPromptEnabled={(prompt) =>
            scope === 'project'
              ? effectiveGlobalEnabled(projectSettings?.promptPrinciples, prompt)
              : prompt.injectionEnabled
          }
          onPromptEnabledChange={handlePromptEnabledChange}
          disabled={updatePrompt.isPending}
          empty={
            <p className="border-t border-border/60 px-3 py-3 text-xs text-foreground-muted">
              {t('promptLibrary.injection.empty')}
            </p>
          }
        />
      )}
    </section>
  );
});

function EnterprisePromptSection({ runtimeId }: { runtimeId: RuntimeId }) {
  const { t } = useTranslation();
  const runtime = getRuntime(runtimeId);
  const isClaude = runtime?.cli === 'claude';

  return (
    <div data-slot="workspace-prompt-enterprise" className="mt-3 grid gap-3">
      <div className="flex items-start gap-2.5 rounded-lg border border-border bg-background-secondary p-3">
        <LockKeyhole className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
        <div className="min-w-0 text-xs leading-5">
          <p className="font-medium text-foreground">
            {t('workspaceRuntime.prompt.enterpriseManaged')}
          </p>
          <p className="mt-0.5 text-foreground-muted">
            {isClaude
              ? t('workspaceRuntime.prompt.enterpriseClaudeDescription')
              : t('workspaceRuntime.prompt.enterpriseGenericDescription', {
                  name: runtime?.name ?? runtimeId,
                })}
          </p>
        </div>
      </div>
      {isClaude ? (
        <div className="rounded-lg bg-background-1 px-3 py-2.5">
          <div className="text-[10px] font-medium text-foreground-passive">
            {t('workspaceRuntime.prompt.enterpriseManagedPaths')}
          </div>
          <div className="mt-1 grid gap-0.5 font-mono text-[10px] leading-4 text-foreground-muted">
            <code className="break-all">/Library/Application Support/ClaudeCode/CLAUDE.md</code>
            <code className="break-all">/etc/claude-code/CLAUDE.md</code>
          </div>
        </div>
      ) : null}
      <p className="flex items-start gap-1.5 px-1 text-[11px] leading-4 text-foreground-passive">
        <LockKeyhole className="mt-0.5 size-3.5 shrink-0" />
        <span>{t('workspaceRuntime.prompt.enterpriseReadOnly')}</span>
      </p>
    </div>
  );
}
