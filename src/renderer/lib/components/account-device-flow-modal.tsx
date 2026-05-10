import { AlertCircle, Check, Copy, ExternalLink } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import yodaLogo from '@/assets/images/yoda/yoda_logo_white.svg';
import {
  accountAuthDeviceCodeChannel,
  accountAuthErrorChannel,
  accountAuthSuccessChannel,
} from '@shared/events/accountEvents';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { events, rpc } from '@renderer/lib/ipc';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Spinner } from '@renderer/lib/ui/spinner';
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
  const { toast } = useToast();

  const [userCode, setUserCode] = useState<string>('');
  const [verificationUri, setVerificationUri] = useState<string>('');
  const [verificationUriComplete, setVerificationUriComplete] = useState<string>('');
  const [timeRemaining, setTimeRemaining] = useState<number>(600);
  const [copied, setCopied] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ username: string; email: string; avatarUrl: string } | null>(
    null
  );
  const [browserOpening, setBrowserOpening] = useState(false);
  const [browserOpenCountdown, setBrowserOpenCountdown] = useState(3);

  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
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
          setError('Code expired. Please try again.');
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
  }, [success, error]);

  const copyToClipboard = useCallback(
    async (code: string, isAutomatic = false) => {
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
          toast({ title: '✓ Code copied', description: 'Paste it on Lovstudio to authorize' });
        }
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        log.error('Failed to copy:', err);
        if (!isAutomatic) {
          toast({
            title: 'Copy failed',
            description: 'Please copy the code manually',
            variant: 'destructive',
          });
        }
      }
    },
    [toast]
  );

  const openVerification = useCallback(() => {
    const uri = verificationUriComplete || verificationUri;
    if (uri) {
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
        const countdownTimer = setInterval(() => {
          countdown--;
          setBrowserOpenCountdown(countdown);
          if (countdown <= 0) clearInterval(countdownTimer);
        }, 1000);

        setTimeout(() => {
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
        title: 'Sign-in failed',
        description: data.message,
        variant: 'destructive',
      });
    });

    return () => {
      cleanupDeviceCode();
      cleanupSuccess();
      cleanupError();
    };
  }, [copyToClipboard, onError, onClose, toast]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
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

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col items-center px-8 py-12">
      <img src={yodaLogo} alt="Yoda" className="mb-8 h-8 opacity-90" />

      {success ? (
        <div className="flex flex-col items-center space-y-6 duration-300 animate-in fade-in zoom-in">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500 duration-500 animate-in zoom-in">
            <Check className="h-8 w-8 text-white" strokeWidth={3} />
          </div>
          <div className="space-y-2 text-center">
            <h2 className="text-2xl font-semibold">Signed in</h2>
            <p className="text-sm text-muted-foreground">Welcome to Yoda</p>
            {user && (
              <div className="mt-4 flex items-center justify-center gap-2">
                <div className="text-left">
                  <p className="text-sm font-medium">@{user.username}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : error ? (
        <div className="flex w-full flex-col items-center space-y-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/20">
            <AlertCircle className="h-8 w-8 text-red-500" />
          </div>
          <div className="space-y-2 text-center">
            <h2 className="text-xl font-semibold">Sign-in failed</h2>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
          <Button onClick={onClose} variant="outline" className="w-full">
            Close
          </Button>
        </div>
      ) : (
        <div className="flex w-full flex-col items-center space-y-6">
          <div className="space-y-2 text-center">
            <h2 className="text-2xl font-semibold">Sign in to Lovstudio</h2>
            <p className="text-sm text-muted-foreground">Authorize Yoda from your browser</p>
          </div>

          {userCode && (
            <>
              <div className="w-full space-y-3 rounded-lg bg-muted/30 p-6">
                <p className="text-center text-xs font-medium text-muted-foreground">Your code</p>
                <p className="select-all text-center font-mono text-4xl font-bold tracking-wider">
                  {userCode}
                </p>
              </div>

              <Button
                onClick={() => copyToClipboard(userCode)}
                variant="outline"
                className="w-full"
                disabled={copied}
              >
                {copied ? (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy Code
                  </>
                )}
              </Button>
            </>
          )}

          <div className="w-full space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold">
                1
              </div>
              <p className="text-muted-foreground">
                Sign in to Lovstudio in your browser if needed
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold">
                2
              </div>
              <p className="text-muted-foreground">
                Confirm the code{' '}
                <span className="font-medium text-foreground">(already copied!)</span>
              </p>
            </div>
          </div>

          {browserOpening && (
            <div className="w-full rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
              <p className="text-center text-sm text-blue-600 dark:text-blue-400">
                Opening Lovstudio in {browserOpenCountdown}s...
              </p>
            </div>
          )}

          <div className="flex flex-col items-center gap-2 text-center">
            <Spinner className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Waiting for authorization...</p>
            {timeRemaining > 0 && (
              <p className="text-xs text-muted-foreground">
                Code expires in {formatTime(timeRemaining)}
              </p>
            )}
          </div>

          {(verificationUriComplete || verificationUri) && !browserOpening && (
            <Button onClick={openVerification} className="w-full" size="lg">
              <ExternalLink className="mr-2 h-4 w-4" />
              Open Lovstudio
            </Button>
          )}

          <div className="space-x-3 text-center text-xs text-muted-foreground">
            <span>⌘C to copy</span>
            <span>•</span>
            <span>⌘R to reopen</span>
            <span>•</span>
            <span>Esc to cancel</span>
          </div>
        </div>
      )}
    </div>
  );
}
