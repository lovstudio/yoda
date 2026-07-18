import {
  AppWindow,
  ArrowLeft,
  CornerUpLeft,
  ExternalLink,
  Loader2,
  Pin,
  PinOff,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiLabUserApp } from '@shared/ai-lab';
import { getRuntime } from '@shared/runtime-registry';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { cn } from '@renderer/utils/utils';
import { AI_LAB_APPS, type AiLabAppDefinition } from '../app-registry';
import { useAiLabApps, useDeleteAiLabApp, useUpdateAiLabApp } from '../use-ai-lab';
import { UserAppFrame } from './user-app-frame';

type AiLabViewProps = {
  embedded?: boolean;
  activeAppId?: string | null;
  onActiveAppChange?: (appId: string | null) => void;
};

/** Apps library: generated apps are created by Home's Yoda Build mode and launched here. */
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

  const openYodaBuild = () => {
    navigate('home', { runMode: 'build' });
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-7 px-6 py-8 @max-md:px-4 @max-md:py-5">
        {showHeader && (
          <header className="flex items-center gap-2">
            <AppWindow className="size-4 text-foreground-muted" />
            <h1 className="text-sm font-semibold">{t('library.sections.apps')}</h1>
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
              <Button size="sm" onClick={openYodaBuild}>
                <Plus />
                {t('aiLab.newApp')}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
            {apps.map((app) => (
              <AppTile key={app.id} app={app} onOpen={() => onOpen(app.id)} />
            ))}
            {apps.length === 0 && (
              <button
                type="button"
                onClick={openYodaBuild}
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
  const [isOpeningWindow, setIsOpeningWindow] = useState(false);

  const openBuildTask = () => {
    if (!app.projectId || !app.taskId) return;
    navigate('task', {
      projectId: app.projectId,
      taskId: app.taskId,
      tab: app.conversationId
        ? { kind: 'conversation', conversationId: app.conversationId }
        : undefined,
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
          {t('aiLab.sandbox')}
        </Badge>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={isOpeningWindow}
          aria-label={t('aiLab.openInWindow')}
          title={t('aiLab.openInWindow')}
          onClick={() => void openInWindow()}
        >
          {isOpeningWindow ? <Loader2 className="animate-spin" /> : <ExternalLink />}
        </Button>
        {app.projectId && app.taskId && (
          <Button
            size="sm"
            variant="outline"
            className="@max-xl:w-8 @max-xl:px-0"
            aria-label={t('aiLab.returnToBuildTask')}
            title={t('aiLab.returnToBuildTask')}
            onClick={openBuildTask}
          >
            <CornerUpLeft />
            <span className="@max-xl:hidden">{t('aiLab.returnToBuildTask')}</span>
          </Button>
        )}
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
        <UserAppFrame app={app} className="@max-md:rounded-none @max-md:border-0" />
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
