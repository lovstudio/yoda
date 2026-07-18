import { AppWindow, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiLabWindowTarget } from '@shared/ai-lab-window';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Spinner } from '@renderer/lib/ui/spinner';
import { UserAppFrame } from './components/user-app-frame';
import { useAiLabApps } from './use-ai-lab';

/** Detached host for one user-created app. The app itself stays inside the shared sandbox iframe. */
export function AiLabAppWindow({ target }: { target: AiLabWindowTarget }) {
  useTheme();
  const { t } = useTranslation();
  const apps = useAiLabApps();
  const app = apps.data?.find((candidate) => candidate.id === target.appId) ?? null;

  useEffect(() => {
    document.title = app?.name ?? t('aiLab.title');
  }, [app?.name, t]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-background-secondary pl-20 pr-3 [-webkit-app-region:drag]">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400">
          <AppWindow className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {app?.name ?? t('aiLab.title')}
        </span>
        <Badge variant="outline" className="shrink-0 font-normal text-[10px]">
          <ShieldCheck className="mr-1 size-3" />
          {t('aiLab.sandbox')}
        </Badge>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden bg-background-secondary">
        {apps.isPending ? (
          <WindowState>
            <Spinner className="size-5" />
            <span>{t('aiLab.windowLoading')}</span>
          </WindowState>
        ) : apps.isError ? (
          <WindowState>
            <span>{t('aiLab.windowLoadFailed')}</span>
            <Button size="sm" variant="outline" onClick={() => void apps.refetch()}>
              <RefreshCw />
              {t('common.retry')}
            </Button>
          </WindowState>
        ) : app ? (
          <UserAppFrame app={app} className="min-h-0 rounded-none border-0 shadow-none" />
        ) : (
          <WindowState>{t('aiLab.windowNotFound')}</WindowState>
        )}
      </main>
    </div>
  );
}

function WindowState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-foreground-muted">
      {children}
    </div>
  );
}
