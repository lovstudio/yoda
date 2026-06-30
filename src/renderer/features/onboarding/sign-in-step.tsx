import { CheckCircle, LogIn, User } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { accountDisplayName } from '@renderer/lib/account-display';
import {
  useAccountAuthWarmUp,
  useAccountSession,
  useAccountSignIn,
} from '@renderer/lib/hooks/useAccount';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';

export function SignInStep({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation();
  const { data: session, isLoading: sessionLoading } = useAccountSession();
  const signInMutation = useAccountSignIn();
  const showAccountDeviceFlow = useShowModal('accountDeviceFlowModal');
  const [error, setError] = useState<string | null>(null);

  useAccountAuthWarmUp(!sessionLoading && !(session?.isSignedIn ?? false));

  const handleSignIn = () => {
    setError(null);
    showAccountDeviceFlow({
      onError: (msg: string) => setError(msg),
    });
    signInMutation
      .mutateAsync(undefined)
      .then((result) => {
        if (!result.success) {
          setError(result.error || t('onboarding.signInFailed'));
          return;
        }
        onComplete();
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : t('onboarding.signInFailed'));
      });
  };

  if (sessionLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-foreground-muted">
        {t('onboarding.loading')}
      </div>
    );
  }

  if (session?.isSignedIn && session.user) {
    const { user } = session;
    const displayName = accountDisplayName(user);
    return (
      <div className="flex flex-col space-y-8 max-w-sm">
        <div className="flex flex-col items-center justify-center gap-6">
          <div className="relative">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.username}
                className="h-14 w-14 rounded-full border border-border"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-background-1">
                <User className="h-7 w-7 text-foreground-muted" />
              </div>
            )}
            <CheckCircle className="absolute -bottom-1 -right-1 h-5 w-5 text-primary fill-background" />
          </div>
          <div className="flex flex-col items-center justify-center gap-1">
            <h1 className="text-xl text-center">
              {t('onboarding.connectedAs', { name: displayName })}
            </h1>
            {user.email && (
              <p className="text-sm text-foreground-muted text-center">{user.email}</p>
            )}
          </div>
        </div>
        <Button size={'lg'} onClick={onComplete}>
          {t('onboarding.continue')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-8 max-w-sm">
      <div className="flex flex-col items-center justify-center gap-6">
        <LogIn className="h-10 w-10" absoluteStrokeWidth strokeWidth={1.5} />
        <div className="flex flex-col items-center justify-center gap-2">
          <h1 className="text-xl text-center">{t('onboarding.signInToLovstudio')}</h1>
          <p className="text-md text-foreground-muted text-center">
            {t('onboarding.signInDescription')}
          </p>
        </div>
      </div>
      {error && <p className="text-sm text-destructive text-center">{error}</p>}
      <div className="flex flex-col w-full gap-2">
        <Button size={'lg'} onClick={handleSignIn} disabled={signInMutation.isPending}>
          <LogIn className="h-4 w-4" />
          {signInMutation.isPending ? t('onboarding.signingIn') : t('onboarding.signInToLovstudio')}
        </Button>
        <Button variant="ghost" onClick={onComplete} disabled={signInMutation.isPending}>
          {t('onboarding.skip')}
        </Button>
      </div>
    </div>
  );
}
