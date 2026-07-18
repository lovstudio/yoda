import {
  AppWindow,
  ArrowLeft,
  FlaskConical,
  Loader2,
  Pin,
  PinOff,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiLabUserApp } from '@shared/ai-lab';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import { AI_LAB_APPS, type AiLabAppDefinition } from '../app-registry';
import { applySandboxPolicy } from '../sandbox-policy';
import {
  useAiLabApps,
  useCreateAiLabApp,
  useDeleteAiLabApp,
  useUpdateAiLabApp,
} from '../use-ai-lab';

type AiLabViewProps = {
  embedded?: boolean;
  activeAppId?: string | null;
  onActiveAppChange?: (appId: string | null) => void;
};

/** AI Lab is a natural-language app workshop hosted as a Library section. */
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

  if (embedded) return <div className="@container h-full min-h-0">{content}</div>;
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
  const { toast } = useToast();
  const [prompt, setPrompt] = useState('');
  const createApp = useCreateAiLabApp();

  const handleCreate = () => {
    const value = prompt.trim();
    if (!value || createApp.isPending) return;
    createApp.mutate(
      { prompt: value },
      {
        onSuccess: (app) => {
          setPrompt('');
          onOpen(app.id);
        },
        onError: (error) =>
          toast({
            title: t('aiLab.builder.failed'),
            description: error instanceof Error ? error.message : String(error),
            variant: 'destructive',
          }),
      }
    );
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-7 px-6 py-8 @max-md:px-4 @max-md:py-5">
        {showHeader && (
          <header className="flex items-center gap-2">
            <FlaskConical className="size-4 text-foreground-muted" />
            <h1 className="text-sm font-semibold">{t('aiLab.title')}</h1>
          </header>
        )}

        <section className="relative overflow-hidden rounded-2xl border border-border/80 bg-background-secondary px-5 py-5 shadow-sm @max-md:px-4">
          <div className="pointer-events-none absolute inset-y-0 right-0 w-52 bg-[radial-gradient(circle_at_center,var(--color-accent)_0,transparent_68%)] opacity-[0.06]" />
          <div className="relative max-w-3xl">
            <div className="mb-4 flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
                <Sparkles className="size-4" />
              </span>
              <div>
                <h2 className="text-base font-semibold tracking-tight">
                  {t('aiLab.builder.title')}
                </h2>
                <p className="mt-0.5 text-xs leading-relaxed text-foreground-muted">
                  {t('aiLab.builder.description')}
                </p>
              </div>
            </div>
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') handleCreate();
              }}
              disabled={createApp.isPending}
              maxLength={4_000}
              placeholder={t('aiLab.builder.placeholder')}
              className="min-h-24 resize-none bg-background/80 px-3 py-3 text-[13px] leading-relaxed shadow-inner"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-1.5">
                {(['react', 'shadcn', 'api', 'sandbox'] as const).map((item) => (
                  <Badge key={item} variant="outline" className="font-normal text-[10px]">
                    {item === 'sandbox' && <ShieldCheck className="mr-1 size-3" />}
                    {t(`aiLab.builder.capabilities.${item}`)}
                  </Badge>
                ))}
              </div>
              <Button onClick={handleCreate} disabled={!prompt.trim() || createApp.isPending}>
                {createApp.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {createApp.isPending ? t('aiLab.builder.creating') : t('aiLab.builder.create')}
              </Button>
            </div>
            {createApp.isPending && (
              <p className="mt-3 text-xs text-foreground-muted">
                {t('aiLab.builder.creatingHint')}
              </p>
            )}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">{t('aiLab.myApps')}</h2>
              <p className="mt-0.5 text-xs text-foreground-muted">{t('aiLab.myAppsDescription')}</p>
            </div>
            <span className="text-xs tabular-nums text-foreground-passive">{apps.length}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
            {apps.map((app) => (
              <AppTile key={app.id} app={app} onOpen={() => onOpen(app.id)} />
            ))}
            {apps.length === 0 && (
              <div className="col-span-full flex min-h-28 items-center gap-4 rounded-xl border border-dashed border-border px-5 py-4 text-foreground-muted">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background-2">
                  <Plus className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground-muted">
                    {t('aiLab.builder.emptyTitle')}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed">
                    {t('aiLab.builder.emptyDescription')}
                  </p>
                </div>
              </div>
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
  const { toast } = useToast();
  const updateApp = useUpdateAiLabApp();
  const deleteApp = useDeleteAiLabApp();
  const source = useMemo(() => applySandboxPolicy(app.html), [app.html]);

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
        <Badge variant="outline" className="hidden font-normal text-[10px] @lg:flex">
          <ShieldCheck className="mr-1 size-3" />
          {t('aiLab.builder.capabilities.sandbox')}
        </Badge>
        <Button
          size="sm"
          variant={app.pinned ? 'secondary' : 'outline'}
          disabled={updateApp.isPending}
          onClick={() => updateApp.mutate({ id: app.id, pinned: !app.pinned })}
        >
          {app.pinned ? <PinOff /> : <Pin />}
          {app.pinned ? t('aiLab.unpin') : t('aiLab.pin')}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={deleteApp.isPending}
          aria-label={t('aiLab.delete')}
          title={t('aiLab.delete')}
          onClick={handleDelete}
        >
          <Trash2 />
        </Button>
      </header>
      <div className="min-h-0 flex-1 bg-background-secondary p-3 @max-md:p-0">
        <iframe
          key={app.updatedAt}
          title={app.name}
          srcDoc={source}
          sandbox="allow-scripts allow-forms allow-modals"
          referrerPolicy="no-referrer"
          className="h-full min-h-[420px] w-full rounded-xl border border-border bg-white shadow-sm @max-md:rounded-none @max-md:border-0"
        />
      </div>
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-label={t('aiLab.back')}
      title={t('aiLab.back')}
      onClick={onBack}
      className="shrink-0"
    >
      <ArrowLeft />
    </Button>
  );
}
