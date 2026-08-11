import { History, Loader2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Prompt } from '@shared/prompt-library';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { cn } from '@renderer/utils/utils';
import { usePromptVersions, useRestorePromptVersion } from './use-prompts';

export function PromptVersionHistory({ prompt }: { prompt: Prompt }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const showConfirm = useShowModal('confirmActionModal');
  const { data: versions = [], isLoading } = usePromptVersions(prompt.id);
  const restoreVersion = useRestorePromptVersion();
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const historicalVersions = versions.filter((version) => version.version !== prompt.version);
  const selected =
    historicalVersions.find((version) => version.version === selectedVersion) ??
    historicalVersions[0] ??
    null;

  const handleRestore = () => {
    if (!selected || selected.version === prompt.version) return;
    showConfirm({
      title: t('promptLibrary.versions.restoreTitle', { version: selected.version }),
      description: t('promptLibrary.versions.restoreDescription', {
        version: selected.version,
      }),
      confirmLabel: t('promptLibrary.versions.restoreAction'),
      onSuccess: () => {
        restoreVersion.mutate(
          { id: prompt.id, version: selected.version, bump: 'patch' },
          {
            onSuccess: (restored) =>
              toast({
                title: t('promptLibrary.versions.restored', {
                  version: restored?.version ?? prompt.version,
                }),
              }),
            onError: (error) =>
              toast({
                title: t('promptLibrary.versions.restoreFailed'),
                description: error instanceof Error ? error.message : String(error),
                variant: 'destructive',
              }),
          }
        );
      },
    });
  };

  return (
    <div data-slot="prompt-version-history" className="grid gap-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <History className="size-3.5 text-foreground-muted" />
          {t('promptLibrary.versions.title')}
        </div>
        <span className="text-xs text-foreground-muted">
          {t('promptLibrary.versions.current', { version: prompt.version })}
        </span>
      </div>

      {isLoading ? (
        <Loader2 className="size-4 animate-spin text-foreground-muted" />
      ) : (
        <>
          {historicalVersions.length > 0 ? (
            <div className="flex flex-wrap gap-1.5" aria-label={t('promptLibrary.versions.title')}>
              {historicalVersions.map((version) => (
                <button
                  key={version.id}
                  type="button"
                  aria-pressed={selected?.version === version.version}
                  onClick={() => setSelectedVersion(version.version)}
                  className={cn(
                    'rounded-md border px-2 py-1 text-xs outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring',
                    selected?.version === version.version
                      ? 'border-foreground-muted bg-background-1 text-foreground'
                      : 'border-border bg-background text-foreground-muted hover:text-foreground'
                  )}
                >
                  v{version.version}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-foreground-passive">{t('promptLibrary.versions.empty')}</p>
          )}

          {selected && (
            <div className="grid gap-2 rounded-md border border-border bg-background p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-foreground">
                    v{selected.version} · {selected.title}
                  </p>
                  <p className="mt-0.5 text-[11px] text-foreground-passive">
                    {new Intl.DateTimeFormat(i18n.language, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(selected.createdAt))}
                  </p>
                </div>
                {selected.version !== prompt.version && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={restoreVersion.isPending}
                    onClick={handleRestore}
                  >
                    {restoreVersion.isPending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="size-3.5" />
                    )}
                    {t('promptLibrary.versions.restore')}
                  </Button>
                )}
              </div>
              {selected.description && (
                <p className="text-xs text-foreground-muted">{selected.description}</p>
              )}
              <pre className="max-h-48 min-w-0 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs text-foreground-passive">
                {selected.content}
              </pre>
              {selected.extraInfo && (
                <p className="whitespace-pre-wrap text-xs text-foreground-muted">
                  {selected.extraInfo}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
