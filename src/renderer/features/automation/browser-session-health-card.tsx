import {
  Activity,
  CheckCircle2,
  ClipboardCopy,
  Clock3,
  Globe2,
  Loader2,
  LogIn,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  BrowserSessionHealthSnapshot,
  BrowserSessionHealthTargetSnapshot,
} from '@shared/browser-session-health';
import { copyTextToClipboard, useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Input } from '@renderer/lib/ui/input';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Switch } from '@renderer/lib/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import {
  useBrowserSessionHealth,
  useRemoveBrowserSessionHealthTarget,
  useResumeBrowserSessionHealthAfterLogin,
  useRunBrowserSessionHealthTarget,
  useSetBrowserSessionHealthEnabled,
  useUpsertBrowserSessionHealthTarget,
  type BrowserSessionHealthTargetInput,
} from './use-browser-session-health';

type TargetDraft = {
  id?: string;
  name: string;
  url: string;
  intervalMinutes: string;
  loginUrlMarkers: string;
  loginTitleMarkers: string;
  enabled: boolean;
  humanUrlPatterns: string[];
  humanTitlePatterns: string[];
};

type ActionError = {
  action: string;
  message: string;
  targetId?: string;
  at: string;
};

const EMPTY_DRAFT: TargetDraft = {
  name: '',
  url: '',
  intervalMinutes: '15',
  loginUrlMarkers: '',
  loginTitleMarkers: '',
  enabled: false,
  humanUrlPatterns: [],
  humanTitlePatterns: [],
};

function splitMarkers(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
}

function makeDraft(target?: BrowserSessionHealthTargetSnapshot): TargetDraft {
  if (!target) return { ...EMPTY_DRAFT };
  return {
    id: target.id,
    name: target.name,
    url: target.url,
    intervalMinutes: String(target.intervalMinutes),
    loginUrlMarkers: target.loginUrlPatterns.join('\n'),
    loginTitleMarkers: target.loginTitlePatterns.join('\n'),
    enabled: target.enabled,
    humanUrlPatterns: target.humanUrlPatterns,
    humanTitlePatterns: target.humanTitlePatterns,
  };
}

function draftToInput(draft: TargetDraft): BrowserSessionHealthTargetInput {
  return {
    ...(draft.id ? { id: draft.id } : {}),
    name: draft.name.trim(),
    url: draft.url.trim(),
    intervalMinutes: Number(draft.intervalMinutes),
    loginUrlPatterns: splitMarkers(draft.loginUrlMarkers),
    loginTitlePatterns: splitMarkers(draft.loginTitleMarkers),
    humanUrlPatterns: draft.humanUrlPatterns,
    humanTitlePatterns: draft.humanTitlePatterns,
    enabled: draft.id ? draft.enabled : false,
  };
}

function targetToInput(
  target: BrowserSessionHealthTargetSnapshot,
  patch: Partial<BrowserSessionHealthTargetInput> = {}
): BrowserSessionHealthTargetInput {
  return {
    id: target.id,
    name: target.name,
    url: target.url,
    intervalMinutes: target.intervalMinutes,
    loginUrlPatterns: target.loginUrlPatterns,
    loginTitlePatterns: target.loginTitlePatterns,
    humanUrlPatterns: target.humanUrlPatterns,
    humanTitlePatterns: target.humanTitlePatterns,
    enabled: target.enabled,
    ...patch,
  };
}

function isDraftValid(draft: TargetDraft): boolean {
  const interval = Number(draft.intervalMinutes);
  if (!draft.name.trim() || !draft.url.trim()) return false;
  if (!Number.isFinite(interval) || interval < 1 || interval > 1_440) return false;
  if (!draft.loginUrlMarkers.trim() && !draft.loginTitleMarkers.trim()) return false;
  try {
    const url = new URL(draft.url.trim());
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
    );
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function BrowserSessionHealthCard() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const showConfirm = useShowModal('confirmActionModal');
  const health = useBrowserSessionHealth();
  const setEnabled = useSetBrowserSessionHealthEnabled();
  const upsertTarget = useUpsertBrowserSessionHealthTarget();
  const removeTarget = useRemoveBrowserSessionHealthTarget();
  const runNow = useRunBrowserSessionHealthTarget();
  const resumeAfterLogin = useResumeBrowserSessionHealthAfterLogin();
  const [draft, setDraft] = useState<TargetDraft | null>(null);
  const [actionError, setActionError] = useState<ActionError | null>(null);

  const snapshot = health.data;
  const targets = snapshot?.targets ?? [];
  const attentionTargetId = snapshot?.attention?.targetId;

  const reportError = (action: string, error: unknown, targetId?: string) => {
    const next: ActionError = {
      action,
      message: errorMessage(error),
      ...(targetId ? { targetId } : {}),
      at: new Date().toISOString(),
    };
    setActionError(next);
    toast({
      title: t('automation.sessionHealth.errors.actionFailed'),
      description: next.message,
      variant: 'destructive',
    });
  };

  const copyActionError = async (debugError: ActionError) => {
    try {
      await copyTextToClipboard(
        JSON.stringify(
          {
            feature: 'browser-session-health',
            ...debugError,
            egoStatus: snapshot?.egoStatus ?? 'unknown',
            connected: snapshot?.connected ?? false,
            snapshotCheckedAt: snapshot?.checkedAt ?? null,
          },
          null,
          2
        )
      );
      toast({ title: t('automation.sessionHealth.diagnostics.copied') });
    } catch (error) {
      reportError('copy_error', error, debugError.targetId);
    }
  };

  const openLogin = (target: BrowserSessionHealthTargetSnapshot) => {
    void rpc.browserSessionHealth
      .focusHandoff()
      .catch((error) => reportError('open_login', error, target.id));
  };

  const saveTarget = (input: BrowserSessionHealthTargetInput) => {
    upsertTarget.mutate(input, {
      onSuccess: () => {
        setDraft(null);
        toast({
          title: input.id
            ? t('automation.sessionHealth.editor.updated')
            : t('automation.sessionHealth.editor.createdPaused'),
        });
      },
      onError: (error) => reportError('save_target', error, input.id),
    });
  };

  const deleteTarget = (target: BrowserSessionHealthTargetSnapshot) => {
    showConfirm({
      title: t('automation.sessionHealth.delete.title'),
      description: t('automation.sessionHealth.delete.description', { name: target.name }),
      confirmLabel: t('automation.sessionHealth.delete.confirm'),
      onSuccess: () => {
        removeTarget.mutate(target.id, {
          onError: (error) => reportError('remove_target', error, target.id),
        });
        if (draft?.id === target.id) setDraft(null);
      },
    });
  };

  const copyDiagnostics = async (target: BrowserSessionHealthTargetSnapshot) => {
    try {
      await copyTextToClipboard(
        JSON.stringify(
          {
            target: {
              id: target.id,
              name: target.name,
              url: target.url,
              enabled: target.enabled,
              intervalMinutes: target.intervalMinutes,
            },
            status: {
              state: target.status,
              lastCheckedAt: target.lastCheckedAt,
              consecutiveHealthyChecks: target.consecutiveHealthyChecks,
              lastFreshAt: target.lastFreshAt,
              nextCheckAt: target.nextCheckAt,
              lastError: target.lastError,
              finalUrl: target.finalUrl,
              ownership: target.ownership,
              hasHandoff: Boolean(target.handoffUrl),
            },
            ego: {
              status: snapshot?.egoStatus ?? 'unknown',
              connected: snapshot?.connected ?? false,
              taskSpaceName: snapshot?.taskSpaceName ?? null,
              ownership: snapshot?.ownership ?? null,
            },
          },
          null,
          2
        )
      );
      toast({ title: t('automation.sessionHealth.diagnostics.copied') });
    } catch (error) {
      reportError('copy_diagnostics', error, target.id);
    }
  };

  const surfacedError =
    actionError ??
    (health.error
      ? {
          action: 'get_snapshot',
          message: errorMessage(health.error),
          at: new Date().toISOString(),
        }
      : null);

  return (
    <section
      data-browser-session-health
      className="mt-5 overflow-hidden rounded-lg border border-border bg-background"
      aria-labelledby="browser-session-health-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 px-4 py-3.5 @3xl:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background-secondary text-foreground-muted">
            <ShieldCheck className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 id="browser-session-health-title" className="text-sm font-semibold">
              {t('automation.sessionHealth.title')}
            </h2>
            <p className="mt-1 text-xs leading-5 text-foreground-muted">
              {t('automation.sessionHealth.description')}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground-muted">
              <EgoStatus snapshot={snapshot} />
              <span>{t('automation.sessionHealth.targetCount', { count: targets.length })}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(makeDraft())}>
            <Plus className="size-3.5" />
            {t('automation.sessionHealth.addTarget')}
          </Button>
          <label className="flex items-center gap-2 text-xs font-medium">
            <span>{t('automation.sessionHealth.masterSwitch')}</span>
            <Switch
              size="sm"
              checked={snapshot?.config.enabled ?? false}
              disabled={!snapshot || setEnabled.isPending}
              onCheckedChange={(checked) =>
                setEnabled.mutate(checked, {
                  onError: (error) => reportError('set_enabled', error),
                })
              }
              aria-label={t('automation.sessionHealth.masterSwitch')}
            />
          </label>
        </div>
      </div>

      {surfacedError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-red-500/5 px-4 py-2.5 text-xs text-red-700 dark:text-red-300 @3xl:px-5"
        >
          <TriangleAlert className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{surfacedError.message}</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => void copyActionError(surfacedError)}
          >
            <ClipboardCopy className="size-3.5" />
            {t('automation.sessionHealth.errors.copyDebug')}
          </Button>
          {actionError && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t('automation.sessionHealth.errors.dismiss')}
              onClick={() => setActionError(null)}
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      )}

      {draft && (
        <TargetEditor
          draft={draft}
          isSaving={upsertTarget.isPending}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={saveTarget}
        />
      )}

      {health.isLoading ? (
        <div className="flex min-h-28 items-center justify-center text-foreground-muted">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : targets.length === 0 ? (
        <div className="flex min-h-32 flex-col items-center justify-center px-5 py-6 text-center">
          <Globe2 className="size-5 text-foreground-passive" />
          <p className="mt-2 text-sm font-medium">{t('automation.sessionHealth.empty.title')}</p>
          <p className="mt-1 max-w-md text-xs leading-5 text-foreground-muted">
            {t('automation.sessionHealth.empty.description')}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {targets.map((target) => (
            <TargetRow
              key={target.id}
              target={target}
              snapshot={snapshot}
              needsAttention={attentionTargetId === target.id}
              isRunning={runNow.isPending && runNow.variables === target.id}
              isUpdating={upsertTarget.isPending && upsertTarget.variables?.id === target.id}
              isResuming={resumeAfterLogin.isPending && resumeAfterLogin.variables === target.id}
              onToggle={(enabled) =>
                upsertTarget.mutate(targetToInput(target, { enabled }), {
                  onError: (error) => reportError('toggle_target', error, target.id),
                })
              }
              onRun={() =>
                runNow.mutate(target.id, {
                  onError: (error) => reportError('run_now', error, target.id),
                })
              }
              onEdit={() => setDraft(makeDraft(target))}
              onDelete={() => deleteTarget(target)}
              onCopy={() => void copyDiagnostics(target)}
              onOpenLogin={() => openLogin(target)}
              onResume={() =>
                resumeAfterLogin.mutate(target.id, {
                  onError: (error) => reportError('resume_after_login', error, target.id),
                })
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

function EgoStatus({ snapshot }: { snapshot: BrowserSessionHealthSnapshot | undefined }) {
  const { t } = useTranslation();
  const status = snapshot?.egoStatus ?? 'unknown';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          'size-1.5 rounded-full',
          status === 'connected'
            ? 'bg-emerald-500'
            : status === 'waiting_user'
              ? 'bg-amber-500'
              : status === 'error'
                ? 'bg-red-500'
                : 'bg-foreground-passive'
        )}
      />
      {t('automation.sessionHealth.egoStatus', {
        status: t(`automation.sessionHealth.egoStatuses.${status}`),
      })}
    </span>
  );
}

function TargetRow({
  target,
  snapshot,
  needsAttention,
  isRunning,
  isUpdating,
  isResuming,
  onToggle,
  onRun,
  onEdit,
  onDelete,
  onCopy,
  onOpenLogin,
  onResume,
}: {
  target: BrowserSessionHealthTargetSnapshot;
  snapshot: BrowserSessionHealthSnapshot | undefined;
  needsAttention: boolean;
  isRunning: boolean;
  isUpdating: boolean;
  isResuming: boolean;
  onToggle: (enabled: boolean) => void;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onOpenLogin: () => void;
  onResume: () => void;
}) {
  const { t } = useTranslation();
  const paused = !snapshot?.config.enabled || !target.enabled;
  const effectiveStatus = paused ? 'paused' : target.status;
  const loginAction =
    needsAttention || ['auth_required', 'needs_human', 'waiting_user'].includes(target.status);
  const detail =
    target.lastError?.message ?? t(`automation.sessionHealth.statusDetails.${effectiveStatus}`);

  return (
    <article className="min-w-0 px-4 py-3.5 @3xl:px-5">
      <div className="flex min-w-0 flex-wrap items-start gap-3">
        <div className="min-w-52 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="min-w-0 truncate text-sm font-medium">{target.name}</h3>
            <TargetStatusBadge status={effectiveStatus} />
          </div>
          <p className="mt-0.5 truncate text-[11px] text-foreground-passive" title={target.url}>
            {target.url}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Switch
            size="sm"
            checked={target.enabled}
            disabled={isUpdating}
            onCheckedChange={onToggle}
            aria-label={t('automation.sessionHealth.targetSwitch', { name: target.name })}
          />
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    aria-label={t('automation.sessionHealth.actions.more', { name: target.name })}
                    className="flex size-8 items-center justify-center rounded-md text-foreground-muted outline-none transition-colors hover:bg-background-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                  />
                }
              >
                <MoreHorizontal className="size-4" />
              </TooltipTrigger>
              <TooltipContent>
                {t('automation.sessionHealth.actions.more', { name: target.name })}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem disabled={isRunning} onClick={onRun}>
                {isRunning ? <Loader2 className="animate-spin" /> : <Play />}
                {t('automation.sessionHealth.actions.runNow')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit}>
                <Pencil />
                {t('automation.sessionHealth.actions.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onCopy}>
                <ClipboardCopy />
                {t('automation.sessionHealth.actions.copyDiagnostics')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 />
                {t('automation.sessionHealth.actions.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[11px] text-foreground-muted">
        <div className="flex items-center gap-1.5">
          <dt>{t('automation.sessionHealth.facts.lastChecked')}</dt>
          <dd>
            {target.lastCheckedAt ? (
              <RelativeTime value={target.lastCheckedAt} />
            ) : (
              t('automation.sessionHealth.facts.neverChecked')
            )}
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt>{t('automation.sessionHealth.facts.streak')}</dt>
          <dd>
            {t('automation.sessionHealth.facts.times', { count: target.consecutiveHealthyChecks })}
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt>{t('automation.sessionHealth.facts.interval')}</dt>
          <dd>{t('automation.sessionHealth.facts.minutes', { count: target.intervalMinutes })}</dd>
        </div>
      </dl>

      <p className="mt-2 text-xs leading-5 text-foreground-muted">{detail}</p>

      {loginAction && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
          <Button type="button" variant="outline" size="sm" onClick={onOpenLogin}>
            <LogIn className="size-3.5" />
            {t('automation.sessionHealth.actions.loginInEgo')}
          </Button>
          <Button type="button" size="sm" disabled={isResuming} onClick={onResume}>
            {isResuming ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {t('automation.sessionHealth.actions.resumeAfterLogin')}
          </Button>
        </div>
      )}
    </article>
  );
}

function TargetStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const Icon =
    status === 'fresh'
      ? CheckCircle2
      : status === 'checking'
        ? Loader2
        : status === 'network_error' || status === 'error'
          ? TriangleAlert
          : status === 'auth_required' || status === 'needs_human' || status === 'waiting_user'
            ? Activity
            : Clock3;
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1.5 text-[10px] font-medium',
        status === 'fresh' && 'border-emerald-500/20 text-emerald-700 dark:text-emerald-300',
        (status === 'auth_required' || status === 'needs_human' || status === 'waiting_user') &&
          'border-amber-500/20 text-amber-700 dark:text-amber-300',
        (status === 'network_error' || status === 'error') &&
          'border-red-500/20 text-red-700 dark:text-red-300',
        (status === 'paused' || status === 'unknown') && 'text-foreground-muted'
      )}
    >
      <Icon className={cn('size-3', status === 'checking' && 'animate-spin')} />
      {t(`automation.sessionHealth.statuses.${status}`)}
    </Badge>
  );
}

function TargetEditor({
  draft,
  isSaving,
  onChange,
  onCancel,
  onSave,
}: {
  draft: TargetDraft;
  isSaving: boolean;
  onChange: (draft: TargetDraft) => void;
  onCancel: () => void;
  onSave: (input: BrowserSessionHealthTargetInput) => void;
}) {
  const { t } = useTranslation();
  const composing = useRef(false);
  const suppressSubmitUntil = useRef(0);
  const canSave = useMemo(() => isDraftValid(draft), [draft]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (composing.current || Date.now() < suppressSubmitUntil.current) return;
    if (!canSave || isSaving) return;
    onSave(draftToInput(draft));
  };

  const setField = <K extends keyof TargetDraft>(key: K, value: TargetDraft[K]) => {
    onChange({ ...draft, [key]: value });
  };

  return (
    <form
      data-session-health-editor
      className="border-b border-border/70 bg-background-secondary/55 px-4 py-4 @3xl:px-5"
      onSubmit={handleSubmit}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        suppressSubmitUntil.current = Date.now() + 250;
      }}
      onKeyDownCapture={(event) => {
        const nativeEvent = event.nativeEvent;
        if (
          event.key === 'Enter' &&
          (nativeEvent.isComposing || composing.current || nativeEvent.keyCode === 229)
        ) {
          suppressSubmitUntil.current = Date.now() + 250;
          event.stopPropagation();
        }
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">
            {draft.id
              ? t('automation.sessionHealth.editor.editTitle')
              : t('automation.sessionHealth.editor.createTitle')}
          </h3>
          <p className="mt-1 text-[11px] leading-4 text-foreground-muted">
            {draft.id
              ? t('automation.sessionHealth.editor.editDescription')
              : t('automation.sessionHealth.editor.createDescription')}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={isSaving}
          aria-label={t('common.close')}
          onClick={onCancel}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="mt-4 grid gap-3 @2xl:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium">{t('automation.sessionHealth.form.name')}</span>
          <Input
            autoFocus
            value={draft.name}
            onChange={(event) => setField('name', event.target.value)}
            placeholder={t('automation.sessionHealth.form.namePlaceholder')}
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium">{t('automation.sessionHealth.form.url')}</span>
          <Input
            type="url"
            value={draft.url}
            onChange={(event) => setField('url', event.target.value)}
            placeholder={t('automation.sessionHealth.form.urlPlaceholder')}
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium">
            {t('automation.sessionHealth.form.loginUrlMarker')}
          </span>
          <Input
            value={draft.loginUrlMarkers}
            onChange={(event) => setField('loginUrlMarkers', event.target.value)}
            placeholder={t('automation.sessionHealth.form.loginUrlMarkerPlaceholder')}
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium">
            {t('automation.sessionHealth.form.loginTitleMarker')}
          </span>
          <Input
            value={draft.loginTitleMarkers}
            onChange={(event) => setField('loginTitleMarkers', event.target.value)}
            placeholder={t('automation.sessionHealth.form.loginTitleMarkerPlaceholder')}
          />
        </label>
        <label className="grid max-w-48 gap-1.5">
          <span className="text-xs font-medium">{t('automation.sessionHealth.form.interval')}</span>
          <Input
            type="number"
            min={1}
            max={1_440}
            step={1}
            value={draft.intervalMinutes}
            onChange={(event) => setField('intervalMinutes', event.target.value)}
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
        <p className="text-[11px] text-foreground-passive">
          {canSave
            ? t('automation.sessionHealth.editor.ready')
            : t('automation.sessionHealth.editor.requiredHint')}
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={isSaving} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={!canSave || isSaving}>
            {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {isSaving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </div>
    </form>
  );
}
