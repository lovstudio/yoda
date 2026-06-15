import { isValidElement, type ReactNode } from 'react';
import { toast as sonnerToast, type ExternalToast } from 'sonner';
import i18n from '@renderer/lib/i18n';

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

// The copy action is only attached to error/destructive toasts — that is the
// only place copying the message or debug info is useful. Success, loading and
// neutral info toasts (including ones with their own action like "Undo") stay
// clean.
function toast(input: Toast | ToastDisplayContent, externalOptions?: ExternalToast) {
  if (!isToastObject(input)) {
    return sonnerToast(input, externalOptions);
  }

  const { title, description, variant, action, debugInfo } = input;
  const options: ExternalToast = {
    description,
  };

  if (action) {
    options.action = { label: action.label, onClick: action.onClick };
  }

  if (variant === 'destructive') {
    addCopyAction(options, { title, description, debugInfo });
    return sonnerToast.error(title, options);
  }
  return sonnerToast(title ?? '', options);
}

toast.success = (message: ToastDisplayContent, options?: ExternalToast) =>
  sonnerToast.success(message, options);

toast.error = (message: ToastDisplayContent, options?: ExternalToast) =>
  sonnerToast.error(
    message,
    withCopyAction(options, { title: message, description: options?.description })
  );

toast.loading = (message: ToastDisplayContent, options?: ExternalToast) =>
  sonnerToast.loading(message, options);

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
    await writeTextToClipboard(formatToastCopyText(payload));
    sonnerToast.success(
      i18n.t(payload.debugInfo !== undefined ? 'common.debugInfoCopied' : 'common.copied')
    );
  } catch {
    sonnerToast.error(i18n.t('common.copyFailed'));
  }
}

async function writeTextToClipboard(text: string): Promise<void> {
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
