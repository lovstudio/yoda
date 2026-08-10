import { ArrowUpRight, ChevronRight, LockKeyhole, Plus, TextQuote, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectPromptPrinciples, PromptPrinciple } from '@shared/project-settings';
import { isPromptBoundToScope, type Prompt } from '@shared/prompt-library';
import { getRuntime, type RuntimeId } from '@shared/runtime-registry';
import {
  effectiveGlobalEnabled,
  setGlobalOverride,
  setProjectItems,
} from '@renderer/features/projects/project-prompt-principles';
import {
  asMounted,
  getProjectSettingsStore,
  getProjectStore,
} from '@renderer/features/projects/stores/project-selectors';
import { PromptInjectionControls } from '@renderer/features/prompt-library/prompt-injection-controls';
import { PromptInstructionFilesEditor } from '@renderer/features/prompt-library/prompt-system-section';
import {
  useCreatePrompt,
  usePrompts,
  useUpdatePrompt,
} from '@renderer/features/prompt-library/use-prompts';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Switch } from '@renderer/lib/ui/switch';
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@renderer/lib/ui/tabs';
import { Textarea } from '@renderer/lib/ui/textarea';
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
  const projectWorkspaceId = projectId ? getProjectStore(projectId)?.data?.workspaceId : undefined;

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
          <TextQuote className="size-3.5" />
          <span className={triggerLabelClassName}>{t('workspaceRuntime.prompt.label')}</span>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="top"
          sideOffset={8}
          className="flex h-[min(80vh,35rem)] max-h-[calc(100vh-1rem)] min-h-0 w-[min(26rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden border border-border bg-background p-0 text-foreground shadow-lg"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <TextQuote className="size-4 shrink-0 text-foreground-muted" />
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div className="text-sm font-medium">{t('workspaceRuntime.prompt.title')}</div>
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {runtimeName}
                </Badge>
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
              className="h-full min-h-0 overflow-y-auto overscroll-contain px-3 pb-3 pt-2"
            >
              <PromptInstructionScopeSection runtimeId={runtimeId} scope="user" />
              <PromptInjectionScopeSection runtimeId={runtimeId} scope="user" />
            </TabsPanel>

            <TabsPanel
              value="project"
              className="h-full min-h-0 overflow-y-auto overscroll-contain px-3 pb-3 pt-2"
            >
              <PromptInstructionScopeSection
                runtimeId={runtimeId}
                scope="project"
                projectId={projectId}
              />
              <PromptInjectionScopeSection
                runtimeId={runtimeId}
                scope="project"
                projectId={projectId}
                workspaceId={projectWorkspaceId}
              />
            </TabsPanel>

            <TabsPanel
              value="enterprise"
              className="h-full min-h-0 overflow-y-auto overscroll-contain px-3 pb-3 pt-2"
            >
              <EnterprisePromptSection runtimeId={runtimeId} />
            </TabsPanel>
          </Tabs>
        </PopoverContent>
      </Popover>
    </>
  );
});

function PromptInstructionScopeSection({
  runtimeId,
  scope,
  projectId,
}: {
  runtimeId: RuntimeId;
  scope: 'user' | 'project';
  projectId?: string;
}) {
  const { t } = useTranslation();

  return (
    <section data-slot={`workspace-prompt-${scope}-files`} className="mt-1">
      <h3 className="mb-1 px-1 text-xs font-medium text-foreground">
        {t('workspaceRuntime.prompt.fixedTitle')}
      </h3>
      {scope === 'project' && !projectId ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-foreground-muted">
          {t('workspaceRuntime.prompt.projectRequired')}
        </p>
      ) : (
        <PromptInstructionFilesEditor
          runtimeId={runtimeId}
          projectId={scope === 'project' ? projectId : null}
          scope={scope}
          compact
          initiallyExpanded
        />
      )}
    </section>
  );
}

const PromptInjectionScopeSection = observer(function PromptInjectionScopeSection({
  runtimeId,
  scope,
  projectId,
  workspaceId,
}: {
  runtimeId: RuntimeId;
  scope: 'user' | 'project';
  projectId?: string;
  workspaceId?: string | null;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: prompts = [], isLoading } = usePrompts();
  const createPrompt = useCreatePrompt();
  const updatePrompt = useUpdatePrompt();
  const mountedProject =
    scope === 'project' && projectId ? asMounted(getProjectStore(projectId)) : undefined;
  const projectSettingsStore =
    scope === 'project' && projectId ? getProjectSettingsStore(projectId) : undefined;
  const projectSettings = projectSettingsStore?.settings;
  const [projectPromptPrinciples, setProjectPromptPrinciples] = useState<
    ProjectPromptPrinciples | undefined
  >();
  const projectItems = projectPromptPrinciples?.items ?? [];
  const saveQueue = useRef(Promise.resolve());

  useEffect(() => {
    if (scope !== 'project' || !projectId || !projectSettingsStore) return;
    if (!mountedProject) return;
    if (projectSettings === null) void projectSettingsStore.pageData.load();
  }, [mountedProject, projectId, projectSettings, projectSettingsStore, scope]);

  useEffect(() => {
    setProjectPromptPrinciples(projectSettings?.promptPrinciples);
  }, [projectId, projectSettings?.promptPrinciples]);

  const orderedPrompts = useMemo(
    () =>
      prompts
        .filter((prompt) =>
          isPromptBoundToScope(
            prompt,
            scope,
            scope === 'project' ? { projectId, workspaceId } : undefined
          )
        )
        .slice()
        .sort((left, right) => left.injectionOrder - right.injectionOrder),
    [projectId, prompts, scope, workspaceId]
  );

  const enabledGlobalCount = orderedPrompts.filter((prompt) =>
    scope === 'project'
      ? effectiveGlobalEnabled(projectPromptPrinciples, prompt)
      : prompt.injectionEnabled
  ).length;
  const enabledCount =
    enabledGlobalCount +
    (scope === 'project' ? projectItems.filter((item) => item.enabled).length : 0);
  const promptCount = orderedPrompts.length + (scope === 'project' ? projectItems.length : 0);

  const saveProjectPromptPrinciples = (next: ProjectPromptPrinciples | undefined) => {
    setProjectPromptPrinciples(next);
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

  const saveProjectItems = (items: PromptPrinciple[]) => {
    if (!projectSettingsStore?.settings) return;
    saveProjectPromptPrinciples(setProjectItems(projectPromptPrinciples, items));
  };

  const handlePromptEnabledChange = (prompt: Prompt, enabled: boolean) => {
    if (scope === 'project') {
      if (!projectSettingsStore?.settings) return;
      saveProjectPromptPrinciples(setGlobalOverride(projectPromptPrinciples, prompt, enabled));
      return;
    }
    updatePrompt.mutate({ id: prompt.id, patch: { injectionEnabled: enabled } });
  };

  const handleAddPrompt = (title: string, content: string, onSuccess: () => void) => {
    createPrompt.mutate(
      {
        title,
        description: '',
        content,
        tags: [],
        extraInfo: '',
        injectionEnabled: true,
        bindings:
          scope === 'project'
            ? {
                global: false,
                workspaceIds: workspaceId ? [workspaceId] : [],
                projectIds: projectId ? [projectId] : [],
              }
            : { global: true, workspaceIds: [], projectIds: [] },
      },
      {
        onSuccess,
        onError: (error) =>
          toast({
            title: t('promptLibrary.saveFailed'),
            description: error instanceof Error ? error.message : String(error),
            variant: 'destructive',
          }),
      }
    );
  };

  const handleProjectItemPatch = (id: string, patch: Partial<PromptPrinciple>) => {
    saveProjectItems(projectItems.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const handleProjectItemRemove = (id: string) => {
    saveProjectItems(projectItems.filter((item) => item.id !== id));
  };

  const supportsInjection = runtimeSupportsPromptInjection(runtimeId);
  const projectReady = scope !== 'project' || Boolean(projectId && projectSettings);
  const mutationPending = updatePrompt.isPending || createPrompt.isPending;

  return (
    <section
      data-slot={`workspace-prompt-${scope}-injection`}
      className="mt-3 overflow-hidden rounded-lg border border-border bg-background-secondary"
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <h3 className="text-xs font-medium text-foreground">
          {t('workspaceRuntime.prompt.dynamicTitle')}
        </h3>
        {supportsInjection && projectReady ? (
          <span className="shrink-0 rounded bg-background-1 px-1.5 py-0.5 text-[10px] tabular-nums text-foreground-passive">
            {t('workspaceRuntime.prompt.enabledCount', {
              enabled: enabledCount,
              count: promptCount,
            })}
          </span>
        ) : null}
      </div>

      {!supportsInjection ? (
        <p className="border-t border-border/60 px-3 py-3 text-xs leading-5 text-foreground-muted">
          {t('workspaceRuntime.prompt.injectionUnsupported')}
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
        <>
          <PromptInjectionControls
            variant="compact"
            prompts={orderedPrompts}
            isPromptEnabled={(prompt) =>
              scope === 'project'
                ? effectiveGlobalEnabled(projectPromptPrinciples, prompt)
                : prompt.injectionEnabled
            }
            onPromptEnabledChange={handlePromptEnabledChange}
            disabled={mutationPending}
            empty={
              <p className="border-t border-border/60 px-3 py-3 text-xs text-foreground-muted">
                {t('promptLibrary.injection.empty')}
              </p>
            }
          />
          {scope === 'project' ? (
            <ProjectDynamicPromptList
              items={projectItems}
              onPatchItem={handleProjectItemPatch}
              onRemoveItem={handleProjectItemRemove}
            />
          ) : null}
          <DynamicPromptAddForm
            scope={scope}
            onSubmit={handleAddPrompt}
            pending={mutationPending}
          />
        </>
      )}
    </section>
  );
});

function DynamicPromptAddForm({
  scope,
  onSubmit,
  pending,
}: {
  scope: 'user' | 'project';
  onSubmit: (title: string, content: string, onSuccess: () => void) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const canSubmit = title.trim().length > 0 && content.trim().length > 0;

  const reset = () => {
    setTitle('');
    setContent('');
    setOpen(false);
  };

  return (
    <div className="border-t border-border/60 px-3 py-2">
      {!open ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="text-foreground-muted"
          onClick={() => setOpen(true)}
        >
          <Plus className="size-3.5" />
          {t('promptLibrary.new')}
        </Button>
      ) : (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit || pending) return;
            onSubmit(title.trim(), content.trim(), reset);
          }}
        >
          <Input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={
              scope === 'project'
                ? t('promptLibrary.project.namePlaceholder')
                : t('promptLibrary.form.titlePlaceholder')
            }
            className="h-7 text-xs"
          />
          <Textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={t('workspaceRuntime.prompt.dynamicContentPlaceholder')}
            className="min-h-14 resize-y px-2 py-1.5 text-[11px] leading-4"
          />
          <div className="flex justify-end gap-1.5">
            <Button type="button" variant="ghost" size="xs" onClick={reset}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="xs" disabled={!canSubmit || pending}>
              {pending ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function ProjectDynamicPromptList({
  items,
  onPatchItem,
  onRemoveItem,
}: {
  items: PromptPrinciple[];
  onPatchItem: (id: string, patch: Partial<PromptPrinciple>) => void;
  onRemoveItem: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(() => new Set());

  const toggleItem = (id: string) => {
    setExpandedItemIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="border-t border-border/60 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-medium text-foreground">
          {t('promptLibrary.project.localPrompts')}
        </h4>
        <span className="text-[10px] tabular-nums text-foreground-passive">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="mt-1.5 text-[11px] leading-4 text-foreground-muted">
          {t('promptLibrary.project.empty')}
        </p>
      ) : (
        <div className="mt-1.5 overflow-hidden rounded-md border border-border/60 bg-background">
          {items.map((item) => {
            const expanded = expandedItemIds.has(item.id);
            const name = item.name || t('promptLibrary.project.untitled');
            return (
              <div key={item.id} className="border-t border-border/60 first:border-t-0">
                <div className="flex min-w-0 items-center">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left outline-none hover:bg-background-1 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border"
                    aria-expanded={expanded}
                    onClick={() => toggleItem(item.id)}
                  >
                    <ChevronRight
                      className={cn(
                        'size-3.5 shrink-0 text-foreground-muted transition-transform',
                        expanded && 'rotate-90'
                      )}
                    />
                    <span className="min-w-0 truncate text-[11px] font-medium text-foreground">
                      {name}
                    </span>
                  </button>
                  <Switch
                    size="sm"
                    checked={item.enabled}
                    onCheckedChange={(enabled) => onPatchItem(item.id, { enabled })}
                    aria-label={t('promptLibrary.project.toggle', { name })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="mx-1"
                    aria-label={t('promptLibrary.project.remove')}
                    onClick={() => onRemoveItem(item.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                {expanded ? (
                  <div className="grid gap-2 border-t border-border/60 bg-background-secondary px-2 py-2">
                    <Input
                      className="h-7 text-xs"
                      defaultValue={item.name}
                      placeholder={t('promptLibrary.project.namePlaceholder')}
                      onBlur={(event) => {
                        const nextName = event.target.value.trim();
                        if (nextName !== item.name) onPatchItem(item.id, { name: nextName });
                      }}
                    />
                    <Textarea
                      className="min-h-14 resize-y px-2 py-1.5 font-mono text-[11px] leading-4"
                      defaultValue={item.text}
                      placeholder={t('promptLibrary.project.contentPlaceholder')}
                      onBlur={(event) => {
                        const text = event.target.value;
                        if (text !== item.text) onPatchItem(item.id, { text });
                      }}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EnterprisePromptSection({ runtimeId }: { runtimeId: RuntimeId }) {
  const { t } = useTranslation();
  const runtime = getRuntime(runtimeId);
  const isClaude = runtime?.cli === 'claude';

  return (
    <div data-slot="workspace-prompt-enterprise" className="mt-1 grid gap-2">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background-secondary px-3 py-2">
        <LockKeyhole className="size-4 shrink-0 text-foreground-muted" />
        <Badge variant="outline" className="text-[10px]">
          {t('workspaceRuntime.prompt.enterpriseManaged')}
        </Badge>
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
    </div>
  );
}
