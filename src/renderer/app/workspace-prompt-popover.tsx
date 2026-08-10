import { ArrowUpRight, Building2, LockKeyhole, Sparkles } from 'lucide-react';
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
import { ProjectPromptSection } from '@renderer/features/prompt-library/project-prompt-section';
import { PromptInjectionControls } from '@renderer/features/prompt-library/prompt-injection-controls';
import { PromptLibraryChapter } from '@renderer/features/prompt-library/prompt-library-chapter';
import { UserInstructionSection } from '@renderer/features/prompt-library/prompt-system-section';
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
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projectId ?? null);

  useEffect(() => {
    setSelectedProjectId(projectId ?? null);
  }, [projectId]);

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
          className="flex max-h-[min(80vh,42rem)] w-[min(36rem,calc(100vw-1rem))] flex-col gap-0 overflow-hidden border border-border bg-background p-0 text-foreground shadow-lg"
        >
          <div className="shrink-0 border-b border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">{t('workspaceRuntime.prompt.title')}</div>
                <div className="mt-0.5 truncate text-xs text-foreground-passive">
                  {t('workspaceRuntime.prompt.description', { name: runtimeName })}
                </div>
              </div>
              <Badge variant="outline" className="shrink-0">
                {runtimeName}
              </Badge>
            </div>
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

            <TabsPanel value="user" className="min-h-0 overflow-y-auto px-3 pb-3">
              <UserInstructionSection runtimeId={runtimeId} />
              <PromptInjectionScopeSection
                runtimeId={runtimeId}
                scope="user"
                onOpenLibrary={handleOpenLibrary}
              />
            </TabsPanel>

            <TabsPanel value="project" className="min-h-0 overflow-y-auto px-3 pb-3">
              <ProjectPromptSection
                projectId={selectedProjectId}
                runtimeId={runtimeId}
                onProjectIdChange={setSelectedProjectId}
              />
              <PromptInjectionScopeSection
                runtimeId={runtimeId}
                scope="project"
                projectId={selectedProjectId}
                onOpenLibrary={handleOpenLibrary}
              />
            </TabsPanel>

            <TabsPanel value="enterprise" className="min-h-0 overflow-y-auto px-3 pb-3">
              <EnterprisePromptSection runtimeId={runtimeId} />
            </TabsPanel>
          </Tabs>
        </PopoverContent>
      </Popover>
    </>
  );
});

const PromptInjectionScopeSection = observer(function PromptInjectionScopeSection({
  runtimeId,
  scope,
  projectId,
  onOpenLibrary,
}: {
  runtimeId: RuntimeId;
  scope: 'user' | 'project';
  projectId?: string | null;
  onOpenLibrary: () => void;
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
    <PromptLibraryChapter
      dataSlot={`workspace-prompt-${scope}-injection`}
      className="mt-3"
      icon={Sparkles}
      title={title}
      description={description}
      actions={
        <div className="flex items-center justify-between gap-2">
          {supportsInjection && projectReady ? (
            <span className="text-[10px] tabular-nums text-foreground-passive">
              {t('workspaceRuntime.prompt.enabledCount', {
                enabled: enabledCount,
                count: orderedPrompts.length,
              })}
            </span>
          ) : null}
          <Button type="button" variant="ghost" size="xs" onClick={onOpenLibrary}>
            <ArrowUpRight className="size-3.5" />
            {t('workspaceRuntime.prompt.manageLibrary')}
          </Button>
        </div>
      }
    >
      {!supportsInjection ? (
        <p className="text-xs leading-5 text-foreground-muted">
          {t('workspaceRuntime.prompt.injectionUnsupported', {
            name: getRuntime(runtimeId)?.name ?? runtimeId,
          })}
        </p>
      ) : scope === 'project' && !projectId ? (
        <p className="text-xs leading-5 text-foreground-muted">
          {t('workspaceRuntime.prompt.projectRequired')}
        </p>
      ) : scope === 'project' && !projectReady ? (
        <p className="text-xs leading-5 text-foreground-muted">
          {t('workspaceRuntime.prompt.projectLoading')}
        </p>
      ) : isLoading ? (
        <p className="text-xs leading-5 text-foreground-muted">{t('common.loading')}</p>
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
            <p className="text-xs text-foreground-muted">{t('promptLibrary.injection.empty')}</p>
          }
        />
      )}
    </PromptLibraryChapter>
  );
});

function EnterprisePromptSection({ runtimeId }: { runtimeId: RuntimeId }) {
  const { t } = useTranslation();
  const runtime = getRuntime(runtimeId);
  const isClaude = runtime?.cli === 'claude';

  return (
    <PromptLibraryChapter
      dataSlot="workspace-prompt-enterprise"
      className="mt-3"
      icon={Building2}
      title={t('workspaceRuntime.prompt.enterpriseTitle')}
      description={t('workspaceRuntime.prompt.enterpriseDescription')}
      actions={
        <Badge variant="outline" className="shrink-0">
          <LockKeyhole className="size-3" />
          {t('workspaceRuntime.prompt.enterpriseManaged')}
        </Badge>
      }
    >
      <div className="grid gap-3 text-xs leading-5">
        <p className="text-foreground-muted">
          {isClaude
            ? t('workspaceRuntime.prompt.enterpriseClaudeDescription')
            : t('workspaceRuntime.prompt.enterpriseGenericDescription', {
                name: runtime?.name ?? runtimeId,
              })}
        </p>
        {isClaude ? (
          <div className="rounded-md border border-border bg-background px-3 py-2.5">
            <div className="font-medium text-foreground">
              {t('workspaceRuntime.prompt.enterpriseManagedPaths')}
            </div>
            <code className="mt-1.5 block break-all font-mono text-[10px] text-foreground-passive">
              /Library/Application Support/ClaudeCode/CLAUDE.md
            </code>
            <code className="mt-1 block break-all font-mono text-[10px] text-foreground-passive">
              /etc/claude-code/CLAUDE.md
            </code>
          </div>
        ) : null}
        <div className="flex items-start gap-2 rounded-md bg-background-1 px-3 py-2.5 text-foreground-passive">
          <LockKeyhole className="mt-0.5 size-3.5 shrink-0" />
          <span>{t('workspaceRuntime.prompt.enterpriseReadOnly')}</span>
        </div>
      </div>
    </PromptLibraryChapter>
  );
}
