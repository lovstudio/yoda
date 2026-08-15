import { useQuery } from '@tanstack/react-query';
import { ClipboardCopy, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HookInspectionResult } from '@shared/agent-hooks';
import { getRuntime } from '@shared/runtime-registry';
import { groupHooks, HookGroupSection } from '@renderer/features/agent-hooks/hook-list';
import { RuntimeLogo } from '@renderer/features/agents/components/RuntimeLogo';
import { FilePathActionsDropdown } from '@renderer/lib/components/file-path-actions';
import { copyTextToClipboard, useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { InfoTooltip } from '@renderer/lib/ui/info-tooltip';
import { Spinner } from '@renderer/lib/ui/spinner';
import { cn } from '@renderer/utils/utils';

export const globalHooksQueryKey = ['globalHooks'] as const;

function useGlobalHooks() {
  return useQuery({
    queryKey: globalHooksQueryKey,
    queryFn: () => rpc.agentHooks.inspectGlobal(),
  });
}

/**
 * Machine-wide hook inventory for the Library. Read-only by design: enabling or
 * disabling a hook globally means editing the client's own settings file, which
 * stays the client's job — per-task overrides live in the task Hooks panel.
 */
export function GlobalHooksMainPanel() {
  const { t } = useTranslation();
  const { data, isLoading, isFetching, error, refetch } = useGlobalHooks();

  return (
    <div className="@container flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col px-6 py-8 @3xl:px-10 @3xl:py-10">
        <header className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <h1 className="text-2xl font-semibold tracking-tight">{t('hooksLibrary.title')}</h1>
            <p className="mt-1.5 text-sm leading-6 text-foreground-muted">
              {t('hooksLibrary.subtitle')}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn('size-4', isFetching && 'animate-spin')} />
            {t('hooksLibrary.refresh')}
          </Button>
        </header>

        {error ? <InspectError error={error} /> : null}

        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner className="size-5 text-foreground-passive" />
          </div>
        ) : (
          <div className="mt-6 flex min-w-0 flex-col gap-4">
            {(data ?? []).map((result) => (
              <RuntimeHooksCard key={result.runtimeId} result={result} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RuntimeHooksCard({ result }: { result: HookInspectionResult }) {
  const { t } = useTranslation();
  const runtime = getRuntime(result.runtimeId);
  const groups = groupHooks(result.hooks);
  const surface = {
    renderFileActions: (sourcePath: string) => (
      <FilePathActionsDropdown
        target={{ absolutePath: sourcePath, relativePath: null, sshConnectionId: null }}
      />
    ),
  };

  return (
    <section className="min-w-0 rounded-lg border border-border bg-background-1/40">
      <header className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2">
        <RuntimeLogo runtimeId={result.runtimeId} className="size-4" />
        <span className="min-w-0 truncate text-sm font-medium">
          {runtime?.name ?? result.runtimeId}
        </span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-foreground-passive">
          {result.hooks.length}
        </span>
        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          {result.sources.map((sourcePath) => (
            <div key={sourcePath} className="flex min-w-0 items-center gap-1">
              <span
                className="min-w-0 truncate font-mono text-[10px] text-foreground-passive"
                title={sourcePath}
              >
                {sourcePath}
              </span>
              <FilePathActionsDropdown
                target={{ absolutePath: sourcePath, relativePath: null, sshConnectionId: null }}
              />
            </div>
          ))}
        </div>
      </header>

      <div className="min-w-0 px-2.5 py-2">
        {groups.length === 0 ? (
          <EmptyState
            label={t('hooksLibrary.none')}
            description={
              result.sources.length > 0
                ? t('hooksLibrary.noneDescription')
                : t('hooksLibrary.noConfigDescription')
            }
          />
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            {groups.map((group) => (
              <HookGroupSection key={group.key} group={group} surface={surface} />
            ))}
          </div>
        )}
      </div>

      <footer className="flex items-center gap-1.5 border-t border-border/70 px-3 py-1.5 text-[11px] text-foreground-passive">
        {t('hooksLibrary.readOnly')}
        <InfoTooltip
          label={t('hooksLibrary.readOnly')}
          content={t('hooksLibrary.readOnlyDescription')}
        />
      </footer>
    </section>
  );
}

function InspectError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);

  return (
    <div className="mt-5 flex min-w-0 flex-col gap-2 rounded-md border border-border-destructive bg-background-destructive px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-foreground-destructive">
          {t('hooksLibrary.loadFailed')}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            void copyTextToClipboard(detail);
            toast({ title: t('common.copied') });
          }}
        >
          <ClipboardCopy className="size-3.5" />
          {t('hooksLibrary.copyError')}
        </Button>
      </div>
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-foreground-muted">
        {detail}
      </pre>
    </div>
  );
}
