import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  githubAuthDeviceCodeChannel,
  githubAuthErrorChannel,
  githubAuthSuccessChannel,
} from '@shared/events/githubEvents';
import type { GitHubUser } from '@shared/github';
import { DeviceFlowPanel } from '@renderer/lib/components/device-flow-panel';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { events, rpc } from '@renderer/lib/ipc';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import { log } from '@renderer/utils/logger';

interface GithubDeviceFlowModalProps {
  onClose: () => void;
  onError?: (error: string) => void;
}

type GithubDeviceFlowOverlayExtraProps = {
  onError?: (error: string) => void;
};

export function GithubDeviceFlowModalOverlay({
  onClose,
  onError,
}: GithubDeviceFlowOverlayExtraProps & BaseModalProps<unknown>) {
  return (
    <GithubDeviceFlowModal
      onClose={onClose}
      onError={(error) => {
        onError?.(error);
        onClose();
      }}
    />
  );
}

export function GithubDeviceFlowModal({ onClose, onError }: GithubDeviceFlowModalProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { cancelGithubConnect } = useGithubContext();

  // Presentational state - updated via IPC events from main process
  const [userCode, setUserCode] = useState<string>('');
  const [verificationUri, setVerificationUri] = useState<string>('');
  const [timeRemaining, setTimeRemaining] = useState<number>(900);
  const [copied, setCopied] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [browserOpening, setBrowserOpening] = useState(false);
  const [browserOpenCountdown, setBrowserOpenCountdown] = useState(3);

  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const autoOpenTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autoOpenCountdownRef = useRef<NodeJS.Timeout | null>(null);
  const hasAutocopied = useRef(false);
  const hasOpenedBrowser = useRef(false);
  const authSucceededRef = useRef(false);

  // Cancel the auth flow if the modal is dismissed before auth completes
  useEffect(() => {
    return () => {
      if (!authSucceededRef.current) {
        cancelGithubConnect();
      }
    };
  }, [cancelGithubConnect]);

  // Countdown timer for code expiration
  useEffect(() => {
    if (success || error) return;

    countdownIntervalRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          setError(t('auth.codeExpired'));
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, [success, error, t]);

  const copyToClipboard = useCallback(
    async (code: string, isAutomatic = false) => {
      if (!code) return;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(code);
        } else {
          // Fallback for older browsers
          const textArea = document.createElement('textarea');
          textArea.value = code;
          textArea.style.position = 'fixed';
          textArea.style.left = '-999999px';
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
        }

        setCopied(true);

        if (!isAutomatic) {
          toast({
            title: t('auth.codeCopied'),
            description: t('auth.github.pasteCodeDescription'),
          });
        }

        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        log.error('Failed to copy:', err);
        if (!isAutomatic) {
          toast({
            title: t('auth.copyFailed'),
            description: t('auth.copyFailedDescription'),
            variant: 'destructive',
          });
        }
      }
    },
    [toast, t]
  );

  const openGitHub = useCallback(() => {
    if (verificationUri) {
      hasOpenedBrowser.current = true;
      void rpc.app.openExternal(verificationUri);
    }
  }, [verificationUri]);

  // Subscribe to auth events from main process
  useEffect(() => {
    // Device code received - display to user
    const cleanupDeviceCode = events.on(githubAuthDeviceCodeChannel, (data) => {
      setUserCode(data.userCode);
      setVerificationUri(data.verificationUri);
      setTimeRemaining(data.expiresIn);

      // Auto-copy code
      if (!hasAutocopied.current) {
        hasAutocopied.current = true;
        void copyToClipboard(data.userCode, true);

        // Show countdown and open browser after 3 seconds
        setBrowserOpening(true);
        let countdown = 3;
        autoOpenCountdownRef.current = setInterval(() => {
          countdown--;
          setBrowserOpenCountdown(countdown);
          if (countdown <= 0 && autoOpenCountdownRef.current) {
            clearInterval(autoOpenCountdownRef.current);
            autoOpenCountdownRef.current = null;
          }
        }, 1000);

        autoOpenTimerRef.current = setTimeout(() => {
          autoOpenTimerRef.current = null;
          setBrowserOpening(false);
          if (!hasOpenedBrowser.current) {
            hasOpenedBrowser.current = true;
            void rpc.app.openExternal(data.verificationUri);
          }
        }, 3000);
      }
    });

    // Auth successful
    const cleanupSuccess = events.on(githubAuthSuccessChannel, (data) => {
      authSucceededRef.current = true;
      setSuccess(true);
      setUser(data.user);

      // Auto-close after showing success animation
      setTimeout(() => {
        onClose();
      }, 1000);
    });

    // Auth error
    const cleanupError = events.on(githubAuthErrorChannel, (data) => {
      setError(data.message || data.error);

      if (onError) {
        onError(data.error);
      }

      toast({
        title: t('auth.github.authenticationFailed'),
        description: data.message || t('common.errorOccurred'),
        variant: 'destructive',
      });
    });

    // Cleanup listeners on unmount
    return () => {
      cleanupDeviceCode();
      cleanupSuccess();
      cleanupError();
      // The modal is gone — a pending auto-open must not pop the browser.
      if (autoOpenTimerRef.current) {
        clearTimeout(autoOpenTimerRef.current);
        autoOpenTimerRef.current = null;
      }
      if (autoOpenCountdownRef.current) {
        clearInterval(autoOpenCountdownRef.current);
        autoOpenCountdownRef.current = null;
      }
    };
  }, [copyToClipboard, onError, onClose, toast, t]);

  // Keyboard shortcuts (Escape is handled by the dialog itself)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        if (window.getSelection()?.toString()) return;
        e.preventDefault();
        void copyToClipboard(userCode);
      } else if (e.key === 'Enter' || ((e.metaKey || e.ctrlKey) && e.key === 'r')) {
        e.preventDefault();
        openGitHub();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [copyToClipboard, openGitHub, userCode]);

  return (
    <DeviceFlowPanel
      title={t('auth.github.connectTitle')}
      description={t('auth.github.pasteCodeDescription')}
      openLabel={t('auth.openService', { service: 'GitHub' })}
      userCode={userCode}
      timeRemaining={timeRemaining}
      copied={copied}
      browserOpening={browserOpening}
      browserOpenCountdown={browserOpenCountdown}
      canOpen={Boolean(verificationUri)}
      onCopy={() => copyToClipboard(userCode)}
      onOpen={openGitHub}
      onCancel={onClose}
      success={
        success
          ? {
              title: t('common.success'),
              description: t('auth.github.connected'),
              detail: user ? (
                <div className="flex items-center justify-center gap-2">
                  {user.avatar_url && (
                    <img src={user.avatar_url} alt={user.name} className="h-10 w-10 rounded-full" />
                  )}
                  <div className="text-left">
                    <p className="text-sm font-medium">{user.name || user.login}</p>
                    <p className="text-xs text-muted-foreground">@{user.login}</p>
                  </div>
                </div>
              ) : undefined,
            }
          : null
      }
      error={error ? { title: t('auth.github.authenticationFailed'), message: error } : null}
      footer={
        <button
          type="button"
          onClick={() => rpc.app.openExternal('https://github.com/lovstudio/yoda/issues')}
          className="mt-3 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus:underline focus:outline-none"
        >
          {t('auth.troubleLink')}
        </button>
      }
    />
  );
}
