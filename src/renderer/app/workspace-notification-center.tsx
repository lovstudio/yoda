import {
  Bell,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  CircleAlert,
  Copy,
  Info,
  LoaderCircle,
  Mail,
  MailOpen,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { copyTextToClipboard, useToast } from '@renderer/lib/hooks/use-toast';
import {
  workspaceNotificationStore,
  type WorkspaceNotification,
  type WorkspaceNotificationKind,
  type WorkspaceNotificationTarget,
} from '@renderer/lib/stores/notification-store';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { cn } from '@renderer/utils/utils';

type WorkspaceNotificationCenterProps = {
  triggerClassName: string;
  triggerLabelClassName: string;
  onOpenTarget: (target: WorkspaceNotificationTarget) => void;
};

export function WorkspaceNotificationCenter({
  triggerClassName,
  triggerLabelClassName,
  onOpenTarget,
}: WorkspaceNotificationCenterProps) {
  const { t } = useTranslation();
  const notifications = useSyncExternalStore(
    workspaceNotificationStore.subscribe,
    workspaceNotificationStore.getSnapshot,
    workspaceNotificationStore.getSnapshot
  );
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = notifications.find((notification) => notification.id === selectedId) ?? null;
  const unreadCount = notifications.filter((notification) => notification.readAt === null).length;

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setSelectedId(null);
      }}
    >
      <PopoverTrigger
        aria-label={t('workspaceRuntime.notifications.triggerLabel', {
          count: unreadCount,
        })}
        className={cn(
          triggerClassName,
          open || unreadCount > 0 ? 'text-foreground' : 'text-foreground-passive'
        )}
        title={t('workspaceRuntime.notifications.triggerLabel', {
          count: unreadCount,
        })}
      >
        <Bell aria-hidden className="size-3.5" />
        <span className={triggerLabelClassName}>{t('workspaceRuntime.notifications.title')}</span>
        {unreadCount > 0 ? (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground/10 px-1 font-mono text-[9px] font-semibold leading-none text-foreground tabular-nums">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className="w-[min(26rem,calc(100vw-1rem))] gap-0 border border-border bg-background p-0 text-foreground shadow-lg"
      >
        {selected ? (
          <NotificationDetails
            notification={selected}
            onBack={() => setSelectedId(null)}
            onDelete={() => {
              workspaceNotificationStore.remove(selected.id);
              setSelectedId(null);
            }}
            onOpenTarget={(target) => {
              setOpen(false);
              onOpenTarget(target);
            }}
          />
        ) : (
          <NotificationList
            notifications={notifications}
            onSelect={(id) => {
              workspaceNotificationStore.markRead(id);
              setSelectedId(id);
            }}
            onDelete={(id) => workspaceNotificationStore.remove(id)}
            onMarkRead={(id) => workspaceNotificationStore.markRead(id)}
            onMarkUnread={(id) => workspaceNotificationStore.markUnread(id)}
            onMarkAllRead={() => workspaceNotificationStore.markAllRead()}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function NotificationList({
  notifications,
  onSelect,
  onDelete,
  onMarkRead,
  onMarkUnread,
  onMarkAllRead,
}: {
  notifications: WorkspaceNotification[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onMarkRead: (id: string) => void;
  onMarkUnread: (id: string) => void;
  onMarkAllRead: () => void;
}) {
  const { t } = useTranslation();
  const unreadCount = notifications.filter((notification) => notification.readAt === null).length;

  return (
    <>
      <div className="flex items-start gap-3 border-b border-border p-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{t('workspaceRuntime.notifications.title')}</div>
          <div className="mt-0.5 text-xs text-foreground-passive">
            {notifications.length > 0
              ? unreadCount > 0
                ? t('workspaceRuntime.notifications.summary', {
                    unread: unreadCount,
                    total: notifications.length,
                  })
                : t('workspaceRuntime.notifications.allReadSummary', {
                    total: notifications.length,
                  })
              : t('workspaceRuntime.notifications.description')}
          </div>
        </div>
        {unreadCount > 0 ? (
          <Button type="button" variant="ghost" size="xs" onClick={onMarkAllRead}>
            <CheckCheck aria-hidden />
            {t('workspaceRuntime.notifications.markAllRead')}
          </Button>
        ) : null}
      </div>
      {notifications.length > 0 ? (
        <div className="max-h-[min(26rem,calc(100vh-6rem))] overflow-y-auto p-1.5">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              className={cn(
                'group relative flex min-w-0 items-center gap-1 rounded-md transition-colors hover:bg-background-2',
                notification.readAt === null && 'bg-background-secondary/60'
              )}
            >
              {notification.readAt === null ? (
                <span
                  aria-hidden
                  className="absolute top-3.5 left-1 size-1.5 rounded-full bg-primary"
                />
              ) : null}
              <button
                type="button"
                className="flex min-w-0 flex-1 items-start gap-2 rounded-md py-2 pr-2 pl-3 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                aria-label={t('workspaceRuntime.notifications.openDetails', {
                  title: notification.title,
                })}
                onClick={() => onSelect(notification.id)}
              >
                <NotificationKindIcon kind={notification.kind} />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block truncate text-sm leading-5',
                      notification.readAt === null
                        ? 'font-medium text-foreground'
                        : 'text-foreground-muted'
                    )}
                  >
                    {notification.title}
                  </span>
                  {notification.description ? (
                    <span className="mt-0.5 block truncate text-[11px] leading-4 text-foreground-passive">
                      {notification.description}
                    </span>
                  ) : null}
                  <span className="mt-0.5 flex items-center gap-1 text-[10px] leading-4 text-foreground-passive">
                    <RelativeTime value={notification.updatedAt} />
                    {notification.occurrenceCount > 1 ? (
                      <>
                        <span aria-hidden>·</span>
                        <span>
                          {t('workspaceRuntime.notifications.occurrences', {
                            count: notification.occurrenceCount,
                          })}
                        </span>
                      </>
                    ) : null}
                    {notification.status === 'resolved' ? (
                      <>
                        <span aria-hidden>·</span>
                        <span className="text-emerald-600 dark:text-emerald-400">
                          {t('workspaceRuntime.notifications.statusValue.resolved')}
                        </span>
                      </>
                    ) : null}
                  </span>
                </span>
              </button>
              <NotificationActionsMenu
                notification={notification}
                className="mr-1 opacity-40 focus-visible:opacity-100 group-hover:opacity-100"
                onDelete={() => onDelete(notification.id)}
                onMarkRead={() => onMarkRead(notification.id)}
                onMarkUnread={() => onMarkUnread(notification.id)}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 py-10 text-center">
          <Bell aria-hidden className="mx-auto size-5 text-foreground-disabled" />
          <div className="mt-2 text-sm text-foreground-muted">
            {t('workspaceRuntime.notifications.empty')}
          </div>
          <div className="mt-1 text-xs text-foreground-passive">
            {t('workspaceRuntime.notifications.emptyDescription')}
          </div>
        </div>
      )}
    </>
  );
}

function NotificationDetails({
  notification,
  onBack,
  onDelete,
  onOpenTarget,
}: {
  notification: WorkspaceNotification;
  onBack: () => void;
  onDelete: () => void;
  onOpenTarget: (target: WorkspaceNotificationTarget) => void;
}) {
  const { t } = useTranslation();
  const action = workspaceNotificationStore.getAction(notification.id);
  const details = getNotificationDetails(notification);

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border p-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t('workspaceRuntime.notifications.back')}
          title={t('workspaceRuntime.notifications.back')}
          onClick={onBack}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <div className="min-w-0 flex-1 truncate text-sm font-medium">
          {t('workspaceRuntime.notifications.detailsTitle')}
        </div>
        <NotificationActionsMenu
          notification={notification}
          onDelete={onDelete}
          onMarkRead={() => workspaceNotificationStore.markRead(notification.id)}
          onMarkUnread={() => workspaceNotificationStore.markUnread(notification.id)}
        />
      </div>
      <div className="max-h-[min(28rem,calc(100vh-6rem))] overflow-y-auto p-3">
        <div className="flex items-start gap-2">
          <NotificationKindIcon kind={notification.kind} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">{notification.title}</div>
            {notification.description ? (
              <div className="mt-1 text-xs leading-relaxed text-foreground-muted">
                {notification.description}
              </div>
            ) : null}
          </div>
        </div>
        {notification.status === 'active' && (action || notification.target) ? (
          <Button
            type="button"
            size="sm"
            className="mt-3 w-full"
            onClick={(event) => {
              if (action) {
                workspaceNotificationStore.invokeAction(notification.id, event);
              } else if (notification.target) {
                onOpenTarget(notification.target);
              }
            }}
          >
            {action?.label ?? t('workspaceRuntime.notifications.openTarget')}
          </Button>
        ) : null}
        <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-y border-border py-3 text-[11px]">
          <dt className="text-foreground-passive">{t('workspaceRuntime.notifications.type')}</dt>
          <dd className="text-foreground-muted">
            {t(`workspaceRuntime.notifications.kind.${notification.kind}`)}
          </dd>
          <dt className="text-foreground-passive">{t('workspaceRuntime.notifications.reason')}</dt>
          <dd className="text-foreground-muted">
            {t(`workspaceRuntime.notifications.reasonValue.${notification.reason}`)}
          </dd>
          <dt className="text-foreground-passive">{t('workspaceRuntime.notifications.status')}</dt>
          <dd className="text-foreground-muted">
            {t(
              notification.status === 'active' && notification.reason === 'subscribed-result'
                ? 'workspaceRuntime.notifications.statusValue.newResult'
                : `workspaceRuntime.notifications.statusValue.${notification.status}`
            )}
          </dd>
          <dt className="text-foreground-passive">{t('workspaceRuntime.notifications.source')}</dt>
          <dd className="text-foreground-muted">
            {t(`workspaceRuntime.notifications.sourceValue.${notification.source}`)}
          </dd>
          {notification.occurrenceCount > 1 ? (
            <>
              <dt className="text-foreground-passive">
                {t('workspaceRuntime.notifications.occurrenceCount')}
              </dt>
              <dd className="font-mono text-foreground-muted tabular-nums">
                {notification.occurrenceCount}
              </dd>
            </>
          ) : null}
          <dt className="text-foreground-passive">
            {t('workspaceRuntime.notifications.firstSeen')}
          </dt>
          <dd className="font-mono text-foreground-muted">
            {new Date(notification.createdAt).toLocaleString()}
          </dd>
          <dt className="text-foreground-passive">
            {t('workspaceRuntime.notifications.lastUpdated')}
          </dt>
          <dd className="font-mono text-foreground-muted">
            {new Date(notification.updatedAt).toLocaleString()}
          </dd>
        </dl>
        <div className="mt-3">
          <div className="text-[11px] font-medium text-foreground-muted">
            {t('workspaceRuntime.notifications.details')}
          </div>
          <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background-secondary p-2.5 font-mono text-[11px] leading-relaxed text-foreground-muted">
            {details}
          </pre>
        </div>
      </div>
    </>
  );
}

function getNotificationDetails(notification: WorkspaceNotification): string {
  return (
    notification.details ??
    [notification.title, notification.description].filter(Boolean).join('\n\n')
  );
}

function formatNotificationCopyText(notification: WorkspaceNotification): string {
  const details = getNotificationDetails(notification);
  if (notification.kind !== 'error') return details;

  return [
    `Error: ${notification.title}`,
    notification.description ? `Description: ${notification.description}` : undefined,
    '',
    'Details:',
    details,
    '',
    'Diagnostic context:',
    `Notification ID: ${notification.id}`,
    `Source: ${notification.source}`,
    `Reason: ${notification.reason}`,
    `Status: ${notification.status}`,
    `First seen: ${notification.createdAt}`,
    `Last updated: ${notification.updatedAt}`,
    `Occurrences: ${notification.occurrenceCount}`,
    notification.target ? `Target: ${JSON.stringify(notification.target)}` : undefined,
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n');
}

function NotificationActionsMenu({
  notification,
  className,
  onDelete,
  onMarkRead,
  onMarkUnread,
}: {
  notification: WorkspaceNotification;
  className?: string;
  onDelete: () => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const copyNotification = async () => {
    try {
      await copyTextToClipboard(formatNotificationCopyText(notification));
      toast.success(
        t(
          notification.kind === 'error'
            ? 'common.debugInfoCopied'
            : 'workspaceRuntime.notifications.copy.copied'
        )
      );
    } catch {
      toast.error(t('common.copyFailed'));
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn('shrink-0', className)}
            aria-label={t('workspaceRuntime.notifications.moreActions', {
              title: notification.title,
            })}
            title={t('workspaceRuntime.notifications.moreActions', {
              title: notification.title,
            })}
          >
            <MoreHorizontal aria-hidden />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={() => void copyNotification()}>
          <Copy aria-hidden />
          {t(
            notification.kind === 'error'
              ? 'common.copyDebugInfo'
              : 'workspaceRuntime.notifications.copy.idle'
          )}
        </DropdownMenuItem>
        {notification.readAt === null ? (
          <DropdownMenuItem onClick={onMarkRead}>
            <MailOpen aria-hidden />
            {t('workspaceRuntime.notifications.markRead')}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={onMarkUnread}>
            <Mail aria-hidden />
            {t('workspaceRuntime.notifications.markUnread')}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 aria-hidden />
          {t('workspaceRuntime.notifications.deleteAction')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationKindIcon({
  kind,
  className,
}: {
  kind: WorkspaceNotificationKind;
  className?: string;
}) {
  const iconClassName = cn('mt-0.5 size-4 shrink-0', className);
  if (kind === 'success') {
    return <CheckCircle2 aria-hidden className={cn(iconClassName, 'text-emerald-500')} />;
  }
  if (kind === 'error') {
    return <CircleAlert aria-hidden className={cn(iconClassName, 'text-destructive')} />;
  }
  if (kind === 'loading') {
    return <LoaderCircle aria-hidden className={cn(iconClassName, 'animate-spin text-primary')} />;
  }
  return <Info aria-hidden className={cn(iconClassName, 'text-foreground-muted')} />;
}
