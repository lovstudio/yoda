import { isValidElement, type ReactNode } from 'react';
import { toast as sonnerToast, type ExternalToast } from 'sonner';
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
  debugInfo?: unknown;
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
function toast(input: Toast | ToastDisplayContent, externalOptions?: ExternalToast) {
  if (!isToastObject(input)) {
    const toastId = sonnerToast(input, externalOptions);
    recordToast(
      'info',
      { title: input, description: externalOptions?.description },
      toastId,
      externalOptions,
      externalOptions?.action
    );
    return toastId;
  }

  const { title, description, variant, action, debugInfo } = input;
  const options: ExternalToast = {
    ...(externalOptions ?? {}),
    description: description ?? externalOptions?.description,
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
      action ?? externalOptions?.action
    );
    return toastId;
  }
  const toastId = sonnerToast(title ?? '', options);
  recordToast(
    'info',
    { title, description: options.description, debugInfo },
    toastId,
    options,
    action ?? externalOptions?.action
  );
  return toastId;
}

toast.success = (message: ToastDisplayContent, options?: ExternalToast) => {
  const toastId = sonnerToast.success(message, options);
  recordToast(
    'success',
    { title: message, description: options?.description },
    toastId,
    options,
    options?.action
  );
  return toastId;
};

toast.error = (message: ToastDisplayContent, options?: ExternalToast) => {
  const nextOptions = withCopyAction(options, {
    title: message,
    description: options?.description,
  });
  const toastId = sonnerToast.error(message, nextOptions);
  recordToast(
    'error',
    { title: message, description: options?.description },
    toastId,
    nextOptions,
    options?.action
  );
  return toastId;
};

toast.loading = (message: ToastDisplayContent, options?: ExternalToast) => {
  const toastId = sonnerToast.loading(message, options);
  recordToast(
    'loading',
    { title: message, description: options?.description },
    toastId,
    options,
    options?.action
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
    ('title' in value || 'description' in value || 'variant' in value || 'debugInfo' in value)
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
  action?: unknown
): void {
  const titleText = nodeToText(payload.title);
  const descriptionText = nodeToText(payload.description);
  const title = titleText ?? descriptionText ?? i18n.t('workspaceRuntime.notifications.untitled');
  const details = formatToastCopyText(payload) || title;
  const toastKey = String(options?.id ?? toastId);
  const notificationId = workspaceNotificationStore.enqueue(
    {
      title,
      description: titleText ? (descriptionText ?? undefined) : undefined,
      details,
      kind,
      source: 'toast',
    },
    toastNotificationIds.get(toastKey),
    toNotificationAction(action)
  );
  toastNotificationIds.set(toastKey, notificationId);
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
