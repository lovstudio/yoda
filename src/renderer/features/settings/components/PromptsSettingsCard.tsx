import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronRight,
  CircleAlert,
  FilePlus2,
  FileText,
  GripVertical,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PROMPT_PRINCIPLE_SOURCE_DEFAULT_REFRESH_MINUTES,
  PROMPT_PRINCIPLE_SOURCE_DEFAULT_TIMEOUT_SECONDS,
  PROMPT_PRINCIPLE_SOURCE_MAX_REFRESH_MINUTES,
  PROMPT_PRINCIPLE_SOURCE_MAX_TIMEOUT_SECONDS,
  PROMPT_PRINCIPLE_SOURCE_MIN_REFRESH_MINUTES,
  PROMPT_PRINCIPLE_SOURCE_MIN_TIMEOUT_SECONDS,
  type PromptPrinciple,
  type PromptPrincipleSource,
  type PromptPrincipleSourceError,
} from '@shared/project-settings';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';

type UrlDraft = {
  refreshIntervalMinutes: string;
  timeoutSeconds: string;
  url: string;
};

function newUrlDraft(): UrlDraft {
  return {
    refreshIntervalMinutes: String(PROMPT_PRINCIPLE_SOURCE_DEFAULT_REFRESH_MINUTES),
    timeoutSeconds: String(PROMPT_PRINCIPLE_SOURCE_DEFAULT_TIMEOUT_SECONDS),
    url: '',
  };
}

function parseBoundedInteger(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function errorTranslationKey(error: PromptPrincipleSourceError): string {
  return `settings.prompts.sourceErrors.${error.code}`;
}

/**
 * Manages the user's atomic prompt principles. Enabled principles are appended
 * after the runtime's system prompt when a session spawns for runtimes that
 * support prompt extension, and surface in the session panel's Persona section.
 */
const PromptsSettingsCard: React.FC = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { value, update, isLoading } = useAppSettingsKey('promptPrinciples');
  const items = value?.items ?? [];
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [isSelectingFile, setIsSelectingFile] = useState(false);
  const [urlDraft, setUrlDraft] = useState<UrlDraft | null>(null);
  const [urlError, setUrlError] = useState<PromptPrincipleSourceError | null>(null);
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(() => new Set());

  const setItems = (next: PromptPrinciple[]) => update({ items: next });
  const patchItem = (id: string, patch: Partial<PromptPrinciple>) =>
    setItems(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const toggleExpanded = (id: string) =>
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const addPrinciple = () => {
    const id = crypto.randomUUID();
    setItems([...items, { id, name: '', text: '', enabled: true }]);
    setExpandedIds((current) => new Set(current).add(id));
  };
  const appendLoadedPrinciple = (name: string, text: string, source: PromptPrincipleSource) => {
    const id = crypto.randomUUID();
    setItems([...items, { id, name, text, enabled: true, source }]);
    setExpandedIds((current) => new Set(current).add(id));
  };
  const selectFile = async () => {
    setIsSelectingFile(true);
    try {
      const result = await rpc.appSettings.selectPromptPrincipleFile();
      if (result.status === 'cancelled') return;
      if (result.status === 'error') {
        toast({
          title: t('settings.prompts.fileImportFailed'),
          description: t(errorTranslationKey(result.error), { detail: result.error.detail }),
          variant: 'destructive',
        });
        return;
      }
      appendLoadedPrinciple(result.name, result.text, result.source);
    } finally {
      setIsSelectingFile(false);
    }
  };
  const importUrl = async () => {
    if (!urlDraft?.url.trim()) return;
    setIsLoadingUrl(true);
    setUrlError(null);
    try {
      const result = await rpc.appSettings.loadPromptPrincipleUrl({
        url: urlDraft.url,
        refreshIntervalMinutes: parseBoundedInteger(
          urlDraft.refreshIntervalMinutes,
          PROMPT_PRINCIPLE_SOURCE_DEFAULT_REFRESH_MINUTES,
          PROMPT_PRINCIPLE_SOURCE_MIN_REFRESH_MINUTES,
          PROMPT_PRINCIPLE_SOURCE_MAX_REFRESH_MINUTES
        ),
        timeoutSeconds: parseBoundedInteger(
          urlDraft.timeoutSeconds,
          PROMPT_PRINCIPLE_SOURCE_DEFAULT_TIMEOUT_SECONDS,
          PROMPT_PRINCIPLE_SOURCE_MIN_TIMEOUT_SECONDS,
          PROMPT_PRINCIPLE_SOURCE_MAX_TIMEOUT_SECONDS
        ),
      });
      if (result.status !== 'success') {
        if (result.status === 'error') setUrlError(result.error);
        return;
      }
      appendLoadedPrinciple(result.name, result.text, result.source);
      setUrlDraft(null);
    } finally {
      setIsLoadingUrl(false);
    }
  };
  const refreshSource = async (id: string) => {
    setRefreshingIds((current) => new Set(current).add(id));
    try {
      const result = await rpc.appSettings.refreshPromptPrincipleSource(id);
      if (result.status === 'error') {
        toast({
          title: t('settings.prompts.refreshFailed'),
          description: t(errorTranslationKey(result.error), { detail: result.error.detail }),
          variant: 'destructive',
        });
        return;
      }
      toast.success(t('settings.prompts.refreshSucceeded'));
    } finally {
      setRefreshingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((item) => item.id === active.id);
    const newIdx = items.findIndex((item) => item.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    setItems(arrayMove(items, oldIdx, newIdx));
  };

  return (
    <div className="@container flex flex-col gap-3">
      <p className="text-xs text-foreground-passive">{t('settings.prompts.description')}</p>
      <div className="flex flex-col gap-2">
        <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
          <SortableContext
            items={items.map((item) => item.id)}
            strategy={verticalListSortingStrategy}
          >
            {items.map((item) => (
              <SortablePrincipleRow
                key={item.id}
                item={item}
                isOpen={expandedIds.has(item.id)}
                onToggle={() => toggleExpanded(item.id)}
                patchItem={patchItem}
                isRefreshing={refreshingIds.has(item.id)}
                onRefresh={() => void refreshSource(item.id)}
                onRemove={() => setItems(items.filter((entry) => entry.id !== item.id))}
              />
            ))}
          </SortableContext>
        </DndContext>
        {!isLoading && items.length === 0 ? (
          <p className="text-xs text-foreground-passive">{t('settings.prompts.empty')}</p>
        ) : null}
      </div>
      {urlDraft ? (
        <form
          className="rounded-xl border border-border/70 bg-muted/10 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void importUrl();
          }}
        >
          <div className="mb-3 flex items-center gap-2">
            <Link2 className="size-4 text-foreground-muted" />
            <span className="text-xs font-medium">{t('settings.prompts.urlFormTitle')}</span>
          </div>
          <label className="flex flex-col gap-1.5 text-xs text-foreground-muted">
            <span>{t('settings.prompts.urlLabel')}</span>
            <Input
              autoFocus
              type="url"
              className="h-8 text-xs"
              value={urlDraft.url}
              placeholder={t('settings.prompts.urlPlaceholder')}
              disabled={isLoadingUrl}
              onChange={(event) => {
                setUrlDraft({ ...urlDraft, url: event.target.value });
                setUrlError(null);
              }}
            />
          </label>
          <div className="mt-3 grid gap-3 @2xl:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-xs text-foreground-muted">
              <span>{t('settings.prompts.refreshInterval')}</span>
              <Input
                type="number"
                min={PROMPT_PRINCIPLE_SOURCE_MIN_REFRESH_MINUTES}
                max={PROMPT_PRINCIPLE_SOURCE_MAX_REFRESH_MINUTES}
                className="h-8 text-xs"
                value={urlDraft.refreshIntervalMinutes}
                disabled={isLoadingUrl}
                onChange={(event) =>
                  setUrlDraft({ ...urlDraft, refreshIntervalMinutes: event.target.value })
                }
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-foreground-muted">
              <span>{t('settings.prompts.requestTimeout')}</span>
              <Input
                type="number"
                min={PROMPT_PRINCIPLE_SOURCE_MIN_TIMEOUT_SECONDS}
                max={PROMPT_PRINCIPLE_SOURCE_MAX_TIMEOUT_SECONDS}
                className="h-8 text-xs"
                value={urlDraft.timeoutSeconds}
                disabled={isLoadingUrl}
                onChange={(event) =>
                  setUrlDraft({ ...urlDraft, timeoutSeconds: event.target.value })
                }
              />
            </label>
          </div>
          {urlError ? (
            <div className="mt-3 flex items-start gap-1.5 text-xs text-destructive" role="alert">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>{t(errorTranslationKey(urlError), { detail: urlError.detail })}</span>
            </div>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isLoadingUrl}
              onClick={() => {
                setUrlDraft(null);
                setUrlError(null);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={isLoadingUrl || !urlDraft.url.trim()}>
              {isLoadingUrl ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 />}
              {isLoadingUrl ? t('settings.prompts.loadingUrl') : t('settings.prompts.importUrl')}
            </Button>
          </div>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={addPrinciple}>
          <Plus className="size-3.5" />
          {t('settings.prompts.addManual')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={isSelectingFile}
          onClick={() => void selectFile()}
        >
          {isSelectingFile ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <FilePlus2 className="size-3.5" />
          )}
          {t('settings.prompts.addFromFile')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          aria-expanded={urlDraft !== null}
          onClick={() => {
            setUrlDraft((current) => (current ? null : newUrlDraft()));
            setUrlError(null);
          }}
        >
          <Link2 className="size-3.5" />
          {t('settings.prompts.addFromUrl')}
        </Button>
      </div>
    </div>
  );
};

type SortablePrincipleRowProps = {
  item: PromptPrinciple;
  isOpen: boolean;
  isRefreshing: boolean;
  onToggle: () => void;
  patchItem: (id: string, patch: Partial<PromptPrinciple>) => void;
  onRefresh: () => void;
  onRemove: () => void;
};

/**
 * One principle slat. Collapsed by default — only the grip, toggle, switch and
 * name show; the principle text reveals on expand. Drag listeners live on the
 * grip handle only — spreading them on the row would swallow pointer events on
 * the switch, inputs, and textarea inside it.
 */
const SortablePrincipleRow: React.FC<SortablePrincipleRowProps> = ({
  item,
  isOpen,
  isRefreshing,
  onToggle,
  patchItem,
  onRefresh,
  onRemove,
}) => {
  const { t } = useTranslation();
  const { setNodeRef, transform, transition, isDragging, listeners, attributes } = useSortable({
    id: item.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 1 : 'auto',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group overflow-hidden rounded-xl border border-border/60 bg-muted/10"
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center text-foreground-passive hover:text-foreground active:cursor-grabbing"
          aria-label={t('settings.prompts.reorder')}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-label={t('settings.prompts.toggleExpand')}
          className="shrink-0 text-foreground-passive hover:text-foreground"
        >
          <ChevronRight className={cn('size-4 transition-transform', isOpen && 'rotate-90')} />
        </button>
        <Switch
          size="sm"
          checked={item.enabled}
          onCheckedChange={(checked) => patchItem(item.id, { enabled: checked })}
          aria-label={t('settings.prompts.toggle')}
        />
        <Input
          className="h-7 min-w-0 flex-1 text-xs"
          defaultValue={item.name}
          placeholder={t('settings.prompts.namePlaceholder')}
          onBlur={(event) => {
            const next = event.target.value.trim();
            if (next !== item.name) patchItem(item.id, { name: next });
          }}
        />
        {item.source ? (
          <Badge variant="secondary" className="hidden shrink-0 @2xl:inline-flex">
            {item.source.type === 'file' ? <FileText /> : <Link2 />}
            {t(
              item.source.type === 'file'
                ? 'settings.prompts.fileSource'
                : 'settings.prompts.urlSource'
            )}
          </Badge>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-foreground-passive opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={t('settings.prompts.remove')}
          onClick={onRemove}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {isOpen && (
        <div className="flex flex-col gap-2 border-t border-border/60 px-2 py-2 @2xl:pl-9">
          {item.source ? (
            <PrincipleSourceEditor
              item={item}
              source={item.source}
              isRefreshing={isRefreshing}
              patchItem={patchItem}
              onRefresh={onRefresh}
            />
          ) : null}
          {item.source ? (
            <>
              <Textarea
                className="max-h-64 min-h-20 overflow-auto text-xs"
                value={item.text}
                readOnly
                aria-label={t('settings.prompts.sourceContent')}
              />
              <p className="text-[11px] text-foreground-passive">
                {t('settings.prompts.sourceContentHint')}
              </p>
            </>
          ) : (
            <Textarea
              className="max-h-64 min-h-16 overflow-auto text-xs"
              defaultValue={item.text}
              placeholder={t('settings.prompts.textPlaceholder')}
              onBlur={(event) => {
                const next = event.target.value;
                if (next !== item.text) patchItem(item.id, { text: next });
              }}
            />
          )}
        </div>
      )}
    </div>
  );
};

function PrincipleSourceEditor({
  item,
  source,
  isRefreshing,
  patchItem,
  onRefresh,
}: {
  item: PromptPrinciple;
  source: PromptPrincipleSource;
  isRefreshing: boolean;
  patchItem: (id: string, patch: Partial<PromptPrinciple>) => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();

  const patchSource = (patch: Partial<PromptPrincipleSource>) => {
    patchItem(item.id, {
      source: { ...source, ...patch } as PromptPrincipleSource,
    });
  };

  return (
    <div className="rounded-lg border border-border/60 bg-background-1/30 p-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-foreground-muted">
            {source.type === 'file' ? (
              <>
                <FileText className="size-3.5" />
                {t('settings.prompts.fileSource')}
              </>
            ) : (
              <>
                <Link2 className="size-3.5" />
                {t('settings.prompts.urlSource')}
              </>
            )}
          </div>
          {source.type === 'file' ? (
            <p
              className="truncate font-mono text-[11px] text-foreground-passive"
              title={source.path}
            >
              {source.path}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1.5 text-xs"
          disabled={isRefreshing}
          onClick={onRefresh}
        >
          <RefreshCw className={cn('size-3.5', isRefreshing && 'animate-spin')} />
          {isRefreshing ? t('settings.prompts.refreshing') : t('settings.prompts.refreshNow')}
        </Button>
      </div>

      {source.type === 'url' ? (
        <>
          <label className="mt-2 flex flex-col gap-1 text-[11px] text-foreground-muted">
            <span>{t('settings.prompts.urlLabel')}</span>
            <Input
              type="url"
              className="h-7 font-mono text-[11px]"
              defaultValue={source.url}
              onBlur={(event) => {
                const url = event.target.value.trim();
                if (url === source.url) return;
                patchSource({
                  url,
                  lastAttemptedAt: undefined,
                  lastSyncedAt: undefined,
                  lastError: undefined,
                });
              }}
            />
          </label>
          <div className="mt-2 grid gap-2 @2xl:grid-cols-2">
            <label className="flex flex-col gap-1 text-[11px] text-foreground-muted">
              <span>{t('settings.prompts.refreshInterval')}</span>
              <Input
                type="number"
                min={PROMPT_PRINCIPLE_SOURCE_MIN_REFRESH_MINUTES}
                max={PROMPT_PRINCIPLE_SOURCE_MAX_REFRESH_MINUTES}
                className="h-7 text-[11px]"
                defaultValue={source.refreshIntervalMinutes}
                onBlur={(event) => {
                  const refreshIntervalMinutes = parseBoundedInteger(
                    event.target.value,
                    source.refreshIntervalMinutes,
                    PROMPT_PRINCIPLE_SOURCE_MIN_REFRESH_MINUTES,
                    PROMPT_PRINCIPLE_SOURCE_MAX_REFRESH_MINUTES
                  );
                  event.target.value = String(refreshIntervalMinutes);
                  if (refreshIntervalMinutes !== source.refreshIntervalMinutes) {
                    patchSource({ refreshIntervalMinutes });
                  }
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-foreground-muted">
              <span>{t('settings.prompts.requestTimeout')}</span>
              <Input
                type="number"
                min={PROMPT_PRINCIPLE_SOURCE_MIN_TIMEOUT_SECONDS}
                max={PROMPT_PRINCIPLE_SOURCE_MAX_TIMEOUT_SECONDS}
                className="h-7 text-[11px]"
                defaultValue={source.timeoutSeconds}
                onBlur={(event) => {
                  const timeoutSeconds = parseBoundedInteger(
                    event.target.value,
                    source.timeoutSeconds,
                    PROMPT_PRINCIPLE_SOURCE_MIN_TIMEOUT_SECONDS,
                    PROMPT_PRINCIPLE_SOURCE_MAX_TIMEOUT_SECONDS
                  );
                  event.target.value = String(timeoutSeconds);
                  if (timeoutSeconds !== source.timeoutSeconds) patchSource({ timeoutSeconds });
                }}
              />
            </label>
          </div>
        </>
      ) : null}

      <SourceSyncStatus source={source} />
    </div>
  );
}

function SourceSyncStatus({ source }: { source: PromptPrincipleSource }) {
  const { t } = useTranslation();
  if (source.lastError) {
    return (
      <div className="mt-2 flex items-start gap-1.5 text-[11px] text-destructive" role="status">
        <CircleAlert className="mt-0.5 size-3 shrink-0" />
        <span>{t(errorTranslationKey(source.lastError), { detail: source.lastError.detail })}</span>
      </div>
    );
  }
  return (
    <p className="mt-2 text-[11px] text-foreground-passive">
      {source.lastSyncedAt
        ? t('settings.prompts.lastSynced', {
            date: new Date(source.lastSyncedAt).toLocaleString(),
          })
        : t('settings.prompts.notSynced')}
    </p>
  );
}

export default PromptsSettingsCard;
