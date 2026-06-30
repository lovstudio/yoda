import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  accountAuthDeviceCodeChannel,
  accountAuthErrorChannel,
  accountAuthSuccessChannel,
} from '@shared/events/accountEvents';
import { accountDisplayName } from '@renderer/lib/account-display';
import { DeviceFlowPanel } from '@renderer/lib/components/device-flow-panel';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { events, rpc } from '@renderer/lib/ipc';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { log } from '@renderer/utils/logger';

interface AccountDeviceFlowModalProps {
  onClose: () => void;
  onError?: (error: string) => void;
}

type AccountDeviceFlowOverlayExtraProps = {
  onError?: (error: string) => void;
};

export function AccountDeviceFlowModalOverlay({
  onClose,
  onError,
}: AccountDeviceFlowOverlayExtraProps & BaseModalProps<unknown>) {
  return (
    <AccountDeviceFlowModal
      onClose={onClose}
      onError={(error) => {
        onError?.(error);
        onClose();
      }}
    />
  );
}

export function AccountDeviceFlowModal({ onClose, onError }: AccountDeviceFlowModalProps) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [userCode, setUserCode] = useState<string>('');
  const [verificationUri, setVerificationUri] = useState<string>('');
  const [verificationUriComplete, setVerificationUriComplete] = useState<string>('');
  const [timeRemaining, setTimeRemaining] = useState<number>(600);
  const [copied, setCopied] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ username: string; name?: string; email: string } | null>(null);
  const [browserOpening, setBrowserOpening] = useState(false);
  const [browserOpenCountdown, setBrowserOpenCountdown] = useState(3);

  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const autoOpenTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autoOpenCountdownRef = useRef<NodeJS.Timeout | null>(null);
  const hasAutocopied = useRef(false);
  const hasOpenedBrowser = useRef(false);
  const authSucceededRef = useRef(false);

  useEffect(() => {
    return () => {
      if (!authSucceededRef.current) {
        void rpc.account.cancelSignIn();
      }
    };
  }, []);

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
            description: t('auth.lovstudio.pasteCodeDescription'),
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

  const openVerification = useCallback(() => {
    const uri = verificationUriComplete || verificationUri;
    if (uri) {
      hasOpenedBrowser.current = true;
      void rpc.app.openExternal(uri);
    }
  }, [verificationUri, verificationUriComplete]);

  useEffect(() => {
    const cleanupDeviceCode = events.on(accountAuthDeviceCodeChannel, (data) => {
      setUserCode(data.userCode);
      setVerificationUri(data.verificationUri);
      setVerificationUriComplete(data.verificationUriComplete);
      setTimeRemaining(data.expiresIn);

      if (!hasAutocopied.current) {
        hasAutocopied.current = true;
        void copyToClipboard(data.userCode, true);

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
            void rpc.app.openExternal(data.verificationUriComplete);
          }
        }, 3000);
      }
    });

    const cleanupSuccess = events.on(accountAuthSuccessChannel, (data) => {
      authSucceededRef.current = true;
      setSuccess(true);
      setUser(data.user);
      setTimeout(() => onClose(), 1000);
    });

    const cleanupError = events.on(accountAuthErrorChannel, (data) => {
      setError(data.message);
      onError?.(data.message);
      toast({
        title: t('auth.lovstudio.signInFailed'),
        description: data.message,
        variant: 'destructive',
      });
    });

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        if (window.getSelection()?.toString()) return;
        e.preventDefault();
        void copyToClipboard(userCode);
      } else if (e.key === 'Enter' || ((e.metaKey || e.ctrlKey) && e.key === 'r')) {
        e.preventDefault();
        openVerification();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [copyToClipboard, openVerification, userCode]);

  return (
    <DeviceFlowPanel
      title={t('auth.lovstudio.signInTitle')}
      description={t('auth.lovstudio.pasteCodeDescription')}
      openLabel={t('auth.openService', { service: 'Lovstudio' })}
      userCode={userCode}
      timeRemaining={timeRemaining}
      copied={copied}
      browserOpening={browserOpening}
      browserOpenCountdown={browserOpenCountdown}
      canOpen={Boolean(verificationUriComplete || verificationUri)}
      onCopy={() => copyToClipboard(userCode)}
      onOpen={openVerification}
      onCancel={onClose}
      success={
        success
          ? {
              title: t('auth.signedIn'),
              description: t('auth.lovstudio.signedInWelcome'),
              detail: user ? (
                <div className="text-center">
                  <p className="text-sm font-medium">{accountDisplayName(user)}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
              ) : undefined,
            }
          : null
      }
      error={error ? { title: t('auth.lovstudio.signInFailed'), message: error } : null}
    />
  );
}
