import React from 'react';
import { useTranslation } from 'react-i18next';
import { captureComponentError } from '../../_legacy/errorTracking';
import { copyTextToClipboard } from '../hooks/use-toast';
import { rpc } from '../ipc';
import { Button } from '../ui/button';

type ErrorBoundaryVariant = 'fullscreen' | 'inline';

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
};

type ErrorBoundaryProps = {
  children?: React.ReactNode;
  componentName?: string;
  variant?: ErrorBoundaryVariant;
};

function CopyDebugInfoButton({ debugInfo }: { debugInfo: string }) {
  const { t } = useTranslation();
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle');

  const label =
    copyState === 'copied'
      ? t('common.debugInfoCopied')
      : copyState === 'failed'
        ? t('common.copyFailed')
        : t('common.copyDebugInfo');

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => {
        void copyTextToClipboard(debugInfo)
          .then(() => setCopyState('copied'))
          .catch(() => setCopyState('failed'));
      }}
    >
      {label}
    </Button>
  );
}

function FullscreenFallback({
  message,
  debugInfo,
  onReload,
}: {
  message: string;
  debugInfo: string;
  onReload: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background p-6">
      <div className="max-w-xl rounded-md border border-border bg-card p-6 text-card-foreground shadow-sm">
        <h1 className="mb-2 text-lg font-semibold">{t('common.somethingWentWrong')}</h1>
        <p className="mb-4 break-all text-sm text-muted-foreground">{message}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="default" onClick={onReload}>
            {t('common.reload')}
          </Button>
          <CopyDebugInfoButton debugInfo={debugInfo} />
        </div>
      </div>
    </div>
  );
}

function InlineFallback({
  message,
  componentName,
  debugInfo,
  onReset,
}: {
  message: string;
  componentName?: string;
  debugInfo: string;
  onReset: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full w-full items-center justify-center p-4">
      <div className="max-w-md rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <div className="mb-1 font-medium text-destructive">
          {t('common.somethingWentWrong')}
          {componentName ? ` · ${componentName}` : ''}
        </div>
        <div className="mb-3 break-all text-muted-foreground">{message}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={onReset}>
            {t('common.retry')}
          </Button>
          <CopyDebugInfoButton debugInfo={debugInfo} />
        </div>
      </div>
    </div>
  );
}

function formatErrorDebugInfo(
  error: Error | null,
  componentName: string | undefined,
  componentStack: string | null
): string {
  return [
    componentName ? `Component: ${componentName}` : null,
    error ? `${error.name}: ${error.message}` : null,
    error?.stack ? `\nJavaScript stack:\n${error.stack}` : null,
    componentStack ? `\nReact component stack:\n${componentStack}` : null,
    typeof window !== 'undefined' ? `\nLocation: ${window.location.href}` : null,
    typeof navigator !== 'undefined' ? `User agent: ${navigator.userAgent}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, componentStack: null };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null });
    try {
      captureComponentError(error, this.props.componentName || 'App', {
        component_stack: info.componentStack,
        error_boundary: true,
        severity: this.props.variant === 'inline' ? 'high' : 'critical',
      });
    } catch {}
  }

  handleReload = () => {
    void rpc.viewState.reset().finally(() => {
      try {
        window.location.reload();
      } catch {}
    });
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null, componentStack: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children as React.ReactElement;
    const message = this.state.error?.message || 'An unexpected error occurred.';
    const debugInfo = formatErrorDebugInfo(
      this.state.error,
      this.props.componentName,
      this.state.componentStack
    );
    if (this.props.variant === 'inline') {
      return (
        <InlineFallback
          message={message}
          componentName={this.props.componentName}
          debugInfo={debugInfo}
          onReset={this.handleReset}
        />
      );
    }
    return (
      <FullscreenFallback message={message} debugInfo={debugInfo} onReload={this.handleReload} />
    );
  }
}
