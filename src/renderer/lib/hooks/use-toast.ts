import { isValidElement, type ReactNode } from 'react';
import { toast as sonnerToast, type ExternalToast } from 'sonner';
import type { NotificationReason } from '@shared/notifications';
import i18n from '@renderer/lib/i18n';
import {
  workspaceNotificationStore,
  type WorkspaceNotificationAction,
  type WorkspaceNotificationKind,
} from '@renderer/lib/stores/notification-store';

type ToastAction = {
  label: string;
  onClick: () => void;
};

type Toast = {
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive';
  action?: ToastAction;
  notification?: Extract<NotificationReason, 'blocking-warning' | 'subscribed-result'>;
  notificationKey?: string;
  persistNotification?: boolean;
  debugInfo?: unknown;
};

type ToastOptions = ExternalToast & {
  persistNotification?: boolean;
};

type ToastDisplayContent = ReactNode | (() => ReactNode);

type ToastCopyPayload = {
  title?: ToastDisplayContent;
  description?: ToastDisplayContent;
  debugInfo?: unknown;
};

const toastNotificationIds = new Map<string, string>();

// The copy action is only attached to error/destructive toasts — that is the
// only place copying the message or debug info is useful. Success, loading and
// neutral info toasts (including ones with their own action like "Undo") stay
// clean.
function toast(input: Toast | ToastDisplayContent, externalOptions?: ToastOptions) {
  const { persistNotification: externalPersistNotification, ...sonnerOptions } =
    externalOptions ?? {};
  const sonnerOptionsForCall = externalOptions ? sonnerOptions : undefined;

  if (!isToastObject(input)) {
    const toastId = sonnerToast(input, sonnerOptionsForCall);
    recordToast(
      'info',
      { title: input, description: sonnerOptions.description },
      toastId,
      sonnerOptions,
      sonnerOptions.action,
      undefined,
      undefined,
      externalPersistNotification
    );
    return toastId;
  }

  const {
    title,
    description,
    variant,
    action,
    debugInfo,
    notificationKey,
    persistNotification: inputPersistNotification,
  } = input;
  const persistNotification = inputPersistNotification ?? externalPersistNotification;
  const options: ExternalToast = {
    ...sonnerOptions,
    description: description ?? sonnerOptions.description,
  };

  if (action) {
    options.action = { label: action.label, onClick: action.onClick };
  }

  if (variant === 'destructive') {
    addCopyAction(options, { title, description, debugInfo });
    const toastId = sonnerToast.error(title, options);
    recordToast(
      'error',
      { title, description: options.description, debugInfo },
      toastId,
      options,
      action ?? externalOptions?.action,
      input.notification,
      notificationKey,
      persistNotification
    );
    return toastId;
  }
  const toastId = sonnerToast(title ?? '', options);
  recordToast(
    'info',
    { title, description: options.description, debugInfo },
    toastId,
    options,
    action ?? externalOptions?.action,
    input.notification,
    notificationKey,
    persistNotification
  );
  return toastId;
}

toast.success = (message: ToastDisplayContent, options?: ToastOptions) => {
  const { persistNotification, ...sonnerOptions } = options ?? {};
  const toastId = sonnerToast.success(message, options ? sonnerOptions : undefined);
  recordToast(
    'success',
    { title: message, description: sonnerOptions.description },
    toastId,
    sonnerOptions,
    sonnerOptions.action,
    undefined,
    undefined,
    persistNotification
  );
  return toastId;
};

toast.error = (message: ToastDisplayContent, options?: ToastOptions) => {
  const { persistNotification, ...sonnerOptions } = options ?? {};
  const nextOptions = withCopyAction(sonnerOptions, {
    title: message,
    description: sonnerOptions.description,
  });
  const toastId = sonnerToast.error(message, nextOptions);
  recordToast(
    'error',
    { title: message, description: sonnerOptions.description },
    toastId,
    nextOptions,
    sonnerOptions.action,
    undefined,
    undefined,
    persistNotification
  );
  return toastId;
};

toast.loading = (message: ToastDisplayContent, options?: ToastOptions) => {
  const { persistNotification, ...sonnerOptions } = options ?? {};
  const toastId = sonnerToast.loading(message, options ? sonnerOptions : undefined);
  recordToast(
    'loading',
    { title: message, description: sonnerOptions.description },
    toastId,
    sonnerOptions,
    sonnerOptions.action,
    undefined,
    undefined,
    persistNotification
  );
  return toastId;
};

toast.dismiss = sonnerToast.dismiss;

function useToast() {
  return { toast };
}

function isToastObject(value: Toast | ToastDisplayContent): value is Toast {
  return (
    typeof value === 'object' &&
    value !== null &&
    !isValidElement(value) &&
    ('title' in value ||
      'description' in value ||
      'variant' in value ||
      'notification' in value ||
      'notificationKey' in value ||
      'persistNotification' in value ||
      'debugInfo' in value)
  );
}

function withCopyAction(options: ExternalToast | undefined, payload: ToastCopyPayload) {
  const nextOptions: ExternalToast = { ...(options ?? {}) };
  addCopyAction(nextOptions, payload);
  return nextOptions;
}

function addCopyAction(options: ExternalToast, payload: ToastCopyPayload): void {
  const hasDebugInfo = payload.debugInfo !== undefined;
  const copyAction = {
    label: i18n.t(hasDebugInfo ? 'common.copyDebugInfo' : 'common.copy'),
    onClick: () => copyToastContent(payload),
  };

  if (!options.action) {
    options.action = copyAction;
    return;
  }

  if (!options.cancel) {
    options.cancel = copyAction;
  }
}

async function copyToastContent(payload: ToastCopyPayload): Promise<void> {
  try {
    await copyTextToClipboard(formatToastCopyText(payload));
    toast.success(
      i18n.t(payload.debugInfo !== undefined ? 'common.debugInfoCopied' : 'common.copied')
    );
  } catch {
    toast.error(i18n.t('common.copyFailed'));
  }
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard API is unavailable');
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.select();

  try {
    const copied = document.execCommand('copy');
    if (!copied) throw new Error('Copy command failed');
  } finally {
    document.body.removeChild(textArea);
  }
}

function recordToast(
  kind: WorkspaceNotificationKind,
  payload: ToastCopyPayload,
  toastId: string | number,
  options?: ExternalToast,
  action?: unknown,
  requestedReason?: Extract<NotificationReason, 'blocking-warning' | 'subscribed-result'>,
  notificationKey?: string,
  persistNotification = true
): void {
  const toastKey = String(options?.id ?? toastId);
  const existingNotificationId =
    toastNotificationIds.get(toastKey) ??
    (notificationKey ? workspaceNotificationStore.getByDedupeKey(notificationKey)?.id : undefined);
  const existingNotification = existingNotificationId
    ? workspaceNotificationStore.get(existingNotificationId)
    : undefined;
  const notificationAction = toNotificationAction(action);
  const reason: NotificationReason | undefined =
    requestedReason ??
    (kind === 'error' ? 'error' : notificationAction ? 'action-required' : undefined);
  const titleText = nodeToText(payload.title);
  const descriptionText = nodeToText(payload.description);
  const title = titleText ?? descriptionText ?? i18n.t('workspaceRuntime.notifications.untitled');
  const description = titleText ? (descriptionText ?? undefined) : undefined;
  const details = formatToastCopyText(payload) || title;

  if (!persistNotification) {
    if (existingNotificationId) {
      workspaceNotificationStore.remove(existingNotificationId);
      toastNotificationIds.delete(toastKey);
    }
    return;
  }

  if (!reason) {
    if (existingNotificationId) {
      if (
        kind === 'success' &&
        (existingNotification?.reason === 'error' ||
          existingNotification?.reason === 'blocking-warning')
      ) {
        workspaceNotificationStore.resolve(existingNotificationId, {
          title,
          description,
          details,
          kind,
        });
      } else {
        workspaceNotificationStore.remove(existingNotificationId);
      }
      toastNotificationIds.delete(toastKey);
    }
    return;
  }

  const notificationId = workspaceNotificationStore.enqueue(
    {
      title,
      description,
      details,
      kind,
      source: 'toast',
      reason,
      dedupeKey: notificationKey,
    },
    existingNotificationId,
    notificationAction
  );
  if (notificationId) {
    toastNotificationIds.set(toastKey, notificationId);
  } else {
    toastNotificationIds.delete(toastKey);
  }
}

function toNotificationAction(action: unknown): WorkspaceNotificationAction | undefined {
  if (!action || typeof action !== 'object' || isValidElement(action)) return undefined;
  const candidate = action as { label?: unknown; onClick?: unknown };
  const label = nodeToText(candidate.label);
  if (!label || typeof candidate.onClick !== 'function') return undefined;
  return {
    label,
    onClick: (event) => {
      (candidate.onClick as (event: unknown) => void)(event);
    },
  };
}

function formatDebugInfo(debugInfo: unknown): string {
  if (typeof debugInfo === 'string') return debugInfo;
  if (Array.isArray(debugInfo) && debugInfo.every((item) => typeof item === 'string')) {
    return debugInfo.join('\n');
  }
  if (debugInfo instanceof Error) return formatError(debugInfo);

  try {
    return JSON.stringify(debugInfo, createDebugInfoReplacer(), 2) ?? String(debugInfo);
  } catch {
    return String(debugInfo);
  }
}

function createDebugInfoReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();

  return (_key: string, value: unknown): unknown => {
    if (value instanceof Error) return formatErrorObject(value);
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  };
}

function formatToastCopyText({ title, description, debugInfo }: ToastCopyPayload): string {
  const parts = [nodeToText(title), nodeToText(description)].filter((part): part is string =>
    Boolean(part)
  );

  if (debugInfo !== undefined) {
    parts.push(formatDebugInfo(debugInfo));
  }

  return parts.join('\n\n');
}

function nodeToText(value: unknown): string | null {
  if (value == null || typeof value === 'boolean') return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) {
    const text = value
      .map((item) => nodeToText(item))
      .filter((item): item is string => Boolean(item))
      .join('');
    return text || null;
  }
  if (typeof value === 'function') {
    try {
      return nodeToText(value());
    } catch {
      return null;
    }
  }
  if (isValidElement(value)) {
    return nodeToText((value.props as { children?: unknown }).children);
  }
  return null;
}

function formatError(error: Error): string {
  return error.stack ?? `${error.name}: ${error.message}`;
}

function formatErrorObject(error: Error): Record<string, unknown> {
  const cause = 'cause' in error ? (error as { cause?: unknown }).cause : undefined;

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...(cause !== undefined && { cause }),
  };
}

export { toast, useToast };
