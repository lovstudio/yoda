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

function toast({ title, description, variant, action, debugInfo }: Toast) {
  const options: ExternalToast = {
    description,
  };

  if (action) {
    options.action = { label: action.label, onClick: action.onClick };
  }

  if (debugInfo !== undefined) {
    const copyDebugAction = {
      label: i18n.t('common.copyDebugInfo'),
      onClick: () => copyDebugInfo(debugInfo),
    };

    if (action) {
      options.cancel = copyDebugAction;
    } else {
      options.action = copyDebugAction;
    }
  }

  if (variant === 'destructive') {
    return sonnerToast.error(title, options);
  }
  return sonnerToast(title ?? '', options);
}

function useToast() {
  return { toast };
}

async function copyDebugInfo(debugInfo: unknown): Promise<void> {
  try {
    await writeTextToClipboard(formatDebugInfo(debugInfo));
    sonnerToast.success(i18n.t('common.debugInfoCopied'));
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
