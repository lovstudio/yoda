import { Bot, Copy, Loader2, MoreHorizontal, Play, ScanSearch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RuntimeId } from '@shared/runtime-registry';
import { useIssueWorker } from '@renderer/features/integrations/use-issue-worker';
import { toast } from '@renderer/lib/hooks/use-toast';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';

const CONCURRENCY_OPTIONS = [1, 2, 3, 4] as const;
const POLL_INTERVAL_OPTIONS = [30, 60, 300] as const;

export function IssueWorkerMenu({
  projectId,
  defaultRuntime,
  taskableCount,
  isCreatingTasks,
  onCreateTasks,
}: {
  projectId: string;
  defaultRuntime: RuntimeId;
  taskableCount: number;
  isCreatingTasks: boolean;
  onCreateTasks: () => void;
}) {
  const { t } = useTranslation();
  const { status, configure, runNow } = useIssueWorker(projectId);
  const snapshot = status.data;
  const config = snapshot?.config;
  const isEnabled = config?.enabled ?? false;
  const isPending = configure.isPending || runNow.isPending || snapshot?.state === 'syncing';

  const showError = (error: unknown) => {
    toast.error(t('issues.worker.actionFailed'), {
      description: error instanceof Error ? error.message : String(error),
    });
  };
  const update = (patch: Parameters<typeof configure.mutate>[0]) => {
    configure.mutate(patch, { onError: showError });
  };

  const copyError = async () => {
    if (!snapshot?.lastError) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            projectId,
            state: snapshot.state,
            lastSyncAt: snapshot.lastSyncAt,
            error: snapshot.lastError,
          },
          null,
          2
        )
      );
      toast.success(t('common.copied'));
    } catch (error) {
      showError(error);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" aria-label={t('issues.worker.menu')}>
            {isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Bot className="size-3.5" />
            )}
            {isEnabled
              ? t('issues.worker.capacity', {
                  active: snapshot?.activeCount ?? 0,
                  concurrency: config?.concurrency ?? 0,
                })
              : t('issues.worker.label')}
            <MoreHorizontal className="size-3.5 text-foreground-muted" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between gap-3">
            <span>{t('issues.worker.menu')}</span>
            {isEnabled ? (
              <span className="font-normal text-foreground-passive">
                {t(`issues.worker.states.${snapshot?.state ?? 'idle'}`)}
              </span>
            ) : null}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuCheckboxItem
          checked={isEnabled}
          disabled={configure.isPending}
          onCheckedChange={(checked) =>
            update({ enabled: checked === true, runtime: config?.runtime ?? defaultRuntime })
          }
        >
          <Bot />
          {t('issues.worker.enabled')}
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem
          disabled={!isEnabled || isPending}
          onClick={() => runNow.mutate(undefined, { onError: showError })}
        >
          <Play />
          {t('issues.worker.runNow')}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!isEnabled}>
            {t('issues.worker.concurrency')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={String(config?.concurrency ?? 2)}
              onValueChange={(value) => value && update({ concurrency: Number(value) })}
            >
              {CONCURRENCY_OPTIONS.map((value) => (
                <DropdownMenuRadioItem key={value} value={String(value)}>
                  {t('issues.worker.agents', { count: value })}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!isEnabled}>
            {t('issues.worker.pollInterval')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={String(config?.pollIntervalSeconds ?? 60)}
              onValueChange={(value) => value && update({ pollIntervalSeconds: Number(value) })}
            >
              {POLL_INTERVAL_OPTIONS.map((value) => (
                <DropdownMenuRadioItem key={value} value={String(value)}>
                  {t('issues.worker.seconds', { count: value })}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={taskableCount === 0 || isCreatingTasks} onClick={onCreateTasks}>
          {isCreatingTasks ? <Loader2 className="animate-spin" /> : <ScanSearch />}
          {taskableCount > 0
            ? t('issues.createTasksCount', { count: taskableCount })
            : t('issues.allIssuesInTasks')}
        </DropdownMenuItem>
        {snapshot?.lastError ? (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1 text-xs leading-relaxed text-foreground-destructive">
              {snapshot.lastError}
            </div>
            <DropdownMenuItem onClick={() => void copyError()}>
              <Copy />
              {t('issues.worker.copyError')}
            </DropdownMenuItem>
          </>
        ) : null}
        <div className="px-2 py-1.5 text-xs leading-relaxed text-foreground-passive">
          {t('issues.worker.description')}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
