import { ChevronRight, FolderCog, Loader2, Plus, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectPromptPrinciples, PromptPrinciple } from '@shared/project-settings';
import { INTERNAL_PROJECT_ID } from '@shared/projects';
import type { RuntimeId } from '@shared/runtime-registry';
import { setProjectItems } from '@renderer/features/projects/project-prompt-principles';
import {
  asMounted,
  getProjectManagerStore,
  getProjectSettingsStore,
} from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { ProjectSelector } from '@renderer/features/tasks/create-task-modal/project-selector';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import { PromptInstructionFilesEditor } from './prompt-system-section';

function navigationProjectId(): string | undefined {
  const navigation = appState.navigation;
  if (navigation.currentViewId === 'task') {
    return (navigation.viewParamsStore.task as { projectId?: string } | undefined)?.projectId;
  }
  if (navigation.currentViewId === 'project') {
    return (navigation.viewParamsStore.project as { projectId?: string } | undefined)?.projectId;
  }
  return undefined;
}

export const ProjectPromptSection = observer(function ProjectPromptSection({
  projectId,
  runtimeId,
  onProjectIdChange,
}: {
  projectId: string | null;
  runtimeId: RuntimeId | null;
  onProjectIdChange: (projectId: string | null) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { value: homeDraft } = useAppSettingsKey('homeDraft');
  const projectManager = getProjectManagerStore();
  const selectedStore = projectId ? projectManager.projects.get(projectId) : undefined;
  const mounted = asMounted(selectedStore);
  const settingsStore = projectId ? getProjectSettingsStore(projectId) : undefined;
  const settings = settingsStore?.settings;
  const [draft, setDraft] = useState<ProjectPromptPrinciples | undefined>();
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(() => new Set());
  const saveQueue = useRef(Promise.resolve());

  const defaultProjectId = (() => {
    const candidates = [
      navigationProjectId(),
      homeDraft?.selectedProjectId ?? undefined,
      (appState.navigation.viewParamsStore.task as { projectId?: string } | undefined)?.projectId,
      (appState.navigation.viewParamsStore.project as { projectId?: string } | undefined)
        ?.projectId,
      ...projectManager.projects.keys(),
    ];
    return candidates.find((candidate) => {
      if (!candidate || candidate === INTERNAL_PROJECT_ID) return false;
      const store = projectManager.projects.get(candidate);
      return Boolean(store?.data && !store.data.isInternal);
    });
  })();

  useEffect(() => {
    if (!projectId && defaultProjectId) onProjectIdChange(defaultProjectId);
  }, [defaultProjectId, onProjectIdChange, projectId]);

  useEffect(() => {
    if (!projectId || !selectedStore) return;
    void projectManager
      .mountProject(projectId)
      .then(() => getProjectSettingsStore(projectId)?.pageData.load());
  }, [projectId, projectManager, selectedStore]);

  useEffect(() => {
    if (settingsStore && settings === null) void settingsStore.pageData.load();
  }, [settings, settingsStore]);

  useEffect(() => {
    const next = settings?.promptPrinciples;
    setDraft(next);
  }, [projectId, settings?.promptPrinciples]);

  const savePrinciples = (next: ProjectPromptPrinciples | undefined) => {
    setDraft(next);
    if (!settingsStore) return;
    saveQueue.current = saveQueue.current.then(async () => {
      const currentSettings = settingsStore.settings;
      if (!currentSettings) return;
      const result = await settingsStore.save({
        ...currentSettings,
        promptPrinciples: next,
      });
      if (!result.success) {
        toast({
          title: t('promptLibrary.project.saveFailed'),
          variant: 'destructive',
        });
        await settingsStore.pageData.load();
      }
    });
  };

  const items = draft?.items ?? [];

  const patchItem = (id: string, patch: Partial<PromptPrinciple>) => {
    savePrinciples(
      setProjectItems(
        draft,
        items.map((item) => (item.id === id ? { ...item, ...patch } : item))
      )
    );
  };

  const addItem = () => {
    const id = crypto.randomUUID();
    setExpandedItemIds((current) => new Set(current).add(id));
    savePrinciples(
      setProjectItems(draft, [
        ...items,
        {
          id,
          name: '',
          text: '',
          enabled: true,
        },
      ])
    );
  };

  const toggleItem = (id: string) => {
    setExpandedItemIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section
      data-slot="project-prompt-section"
      className="mt-10 rounded-lg border border-border bg-background-secondary"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <FolderCog className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
          <div>
            <h2 className="text-sm font-medium text-foreground">
              {t('promptLibrary.project.title')}
            </h2>
            <p className="mt-1 text-xs leading-5 text-foreground-muted">
              {t('promptLibrary.project.description')}
            </p>
          </div>
        </div>
        <div className="w-full @2xl:w-72">
          <ProjectSelector
            value={projectId ?? undefined}
            onChange={(next) => onProjectIdChange(next ?? null)}
          />
        </div>
      </div>

      {!projectId ? (
        <p className="px-4 py-5 text-sm text-foreground-muted">
          {t('promptLibrary.project.selectProject')}
        </p>
      ) : !mounted || !settings ? (
        <div className="flex min-h-32 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-foreground-muted" />
        </div>
      ) : (
        <div className="grid gap-5 p-4">
          {runtimeId ? (
            <div>
              <h3 className="text-xs font-medium text-foreground">
                {t('promptLibrary.project.instructionFiles')}
              </h3>
              <p className="mt-1 text-xs leading-5 text-foreground-muted">
                {t('promptLibrary.project.instructionFilesDescription')}
              </p>
              <div className="mt-3">
                <PromptInstructionFilesEditor
                  runtimeId={runtimeId}
                  projectId={projectId}
                  scope="project"
                />
              </div>
            </div>
          ) : null}

          <div>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-xs font-medium text-foreground">
                  {t('promptLibrary.project.localPrompts')}
                </h3>
                <p className="mt-1 text-xs leading-5 text-foreground-muted">
                  {t('promptLibrary.project.localPromptsDescription')}
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addItem}>
                <Plus className="size-4" />
                {t('promptLibrary.project.add')}
              </Button>
            </div>

            {items.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-3 text-xs text-foreground-muted">
                {t('promptLibrary.project.empty')}
              </p>
            ) : (
              <div className="mt-3 overflow-hidden rounded-lg border border-border bg-background">
                {items.map((item) => {
                  const expanded = expandedItemIds.has(item.id);
                  const name = item.name || t('promptLibrary.project.untitled');
                  return (
                    <div
                      key={item.id}
                      data-slot="project-prompt-row"
                      className="border-t border-border first:border-t-0"
                    >
                      <div className="flex min-w-0 items-center">
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left outline-none hover:bg-background-1 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border"
                          aria-expanded={expanded}
                          onClick={() => toggleItem(item.id)}
                        >
                          <ChevronRight
                            className={cn(
                              'size-4 shrink-0 text-foreground-muted transition-transform',
                              expanded && 'rotate-90'
                            )}
                          />
                          <span className="truncate text-sm font-medium text-foreground">
                            {name}
                          </span>
                        </button>
                        <Switch
                          size="sm"
                          checked={item.enabled}
                          onCheckedChange={(enabled) => patchItem(item.id, { enabled })}
                          aria-label={t('promptLibrary.project.toggle', {
                            name,
                          })}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="mx-2"
                          aria-label={t('promptLibrary.project.remove')}
                          onClick={() =>
                            savePrinciples(
                              setProjectItems(
                                draft,
                                items.filter((entry) => entry.id !== item.id)
                              )
                            )
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                      {expanded ? (
                        <div className="grid gap-3 border-t border-border bg-background px-3 py-3">
                          <Input
                            className="h-8 text-sm"
                            defaultValue={item.name}
                            placeholder={t('promptLibrary.project.namePlaceholder')}
                            onBlur={(event) => {
                              const nextName = event.target.value.trim();
                              if (nextName !== item.name) patchItem(item.id, { name: nextName });
                            }}
                          />
                          <Textarea
                            className="min-h-24 resize-y font-mono text-xs leading-relaxed"
                            defaultValue={item.text}
                            placeholder={t('promptLibrary.project.contentPlaceholder')}
                            onBlur={(event) => {
                              const text = event.target.value;
                              if (text !== item.text) patchItem(item.id, { text });
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
        </div>
      )}
    </section>
  );
});
