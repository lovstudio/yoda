import { LogIn, LogOut, Save, User } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { accountDisplayName } from '@renderer/lib/account-display';
import { useToast } from '@renderer/lib/hooks/use-toast';
import {
  useAccountAuthWarmUp,
  useAccountHealth,
  useAccountSession,
  useAccountSignIn,
  useAccountSignOut,
  useAccountUpdateNickname,
} from '@renderer/lib/hooks/useAccount';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import { ServerUnavailableMessage } from './ServerUnavailableMessage';

export function AccountTab() {
  const { t } = useTranslation();
  const { data: session, isLoading } = useAccountSession();
  const { data: serverAvailable } = useAccountHealth();
  const signInMutation = useAccountSignIn();
  const signOutMutation = useAccountSignOut();
  const { toast } = useToast();
  const showConfirmSignOut = useShowModal('confirmActionModal');
  const showAccountDeviceFlow = useShowModal('accountDeviceFlowModal');

  const [error, setError] = useState<string | null>(null);

  const user = session?.user ?? null;
  const isSignedIn = session?.isSignedIn ?? false;
  const hasAccount = session?.hasAccount ?? false;

  useAccountAuthWarmUp(!isLoading && !isSignedIn);

  const handleSignIn = () => {
    setError(null);
    showAccountDeviceFlow({
      onError: (msg: string) => setError(msg),
    });
    signInMutation
      .mutateAsync(undefined)
      .then((result) => {
        if (!result.success) {
          const message = result.error || t('settings.account.signInFailed');
          setError(message);
          toast({
            title: t('settings.account.signInFailed'),
            description: message,
            variant: 'destructive',
          });
          return;
        }
        toast({
          title: t('settings.account.signedIn'),
          description: result.user
            ? t('settings.account.signedInDescription', { email: result.user.email })
            : t('settings.account.signedInFallback'),
        });
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : t('settings.account.signInFailed');
        setError(message);
      });
  };

  const performSignOut = async () => {
    try {
      await signOutMutation.mutateAsync();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('settings.account.signOutFailed');
      toast({
        title: t('settings.account.signOutFailed'),
        description: message,
        variant: 'destructive',
      });
    }
  };

  const handleSignOut = () => {
    showConfirmSignOut({
      title: t('settings.account.signOutConfirmTitle'),
      description: t('settings.account.signOutConfirmDescription'),
      confirmLabel: t('settings.account.signOutConfirmLabel'),
      variant: 'default',
      onSuccess: () => void performSignOut(),
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        {t('settings.account.loading')}
      </div>
    );
  }

  if (isSignedIn && user) {
    return (
      <SignedInAccountPanel
        key={`${user.userId}:${user.name}`}
        user={user}
        signOutPending={signOutMutation.isPending}
        onSignOut={handleSignOut}
      />
    );
  }

  if (hasAccount && !isSignedIn) {
    return (
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">
            {t('settings.account.sessionExpired')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('settings.account.sessionExpiredHint')}
          </p>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {serverAvailable === false ? (
          <ServerUnavailableMessage />
        ) : (
          <Button
            type="button"
            className="w-fit"
            onClick={handleSignIn}
            disabled={signInMutation.isPending}
          >
            <LogIn className="h-3.5 w-3.5" />
            {signInMutation.isPending
              ? t('settings.account.signingIn')
              : t('settings.account.signIn')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium text-foreground">{t('settings.account.yodaAccount')}</p>
        <p className="text-xs text-muted-foreground">{t('settings.account.createAccountHint')}</p>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {serverAvailable === false ? (
        <ServerUnavailableMessage />
      ) : (
        <Button
          type="button"
          className="w-fit"
          onClick={handleSignIn}
          disabled={signInMutation.isPending}
        >
          <LogIn className="h-3.5 w-3.5" />
          {signInMutation.isPending
            ? t('settings.account.creatingAccount')
            : t('settings.account.createAccount')}
        </Button>
      )}
    </div>
  );
}

type AccountPanelUser = {
  userId: string;
  username: string;
  nickname: string;
  nicknameOverride: string;
  name: string;
  avatarUrl: string;
  email: string;
};

function SignedInAccountPanel({
  user,
  signOutPending,
  onSignOut,
}: {
  user: AccountPanelUser;
  signOutPending: boolean;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const updateNicknameMutation = useAccountUpdateNickname();
  const displayName = accountDisplayName(user);
  const [nicknameDraft, setNicknameDraft] = useState(displayName);

  const nicknameDirty = nicknameDraft.trim() !== displayName.trim();
  const nicknameBusy = updateNicknameMutation.isPending;
  const controlsDisabled = signOutPending || nicknameBusy;

  const handleNicknameSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nickname = nicknameDraft.trim();
    updateNicknameMutation.mutate(nickname, {
      onSuccess: (session) => {
        if (session.user) setNicknameDraft(accountDisplayName(session.user));
        toast({
          title: t('settings.account.nicknameSaved'),
        });
      },
      onError: (err) => {
        const message =
          err instanceof Error ? err.message : t('settings.account.nicknameSaveFailed');
        toast({
          title: t('settings.account.nicknameSaveFailed'),
          description: message,
          variant: 'destructive',
        });
      },
    });
  };

  const handleNicknameReset = () => {
    updateNicknameMutation.mutate('', {
      onSuccess: (session) => {
        if (session.user) setNicknameDraft(accountDisplayName(session.user));
        toast({
          title: t('settings.account.nicknameReset'),
        });
      },
      onError: (err) => {
        const message =
          err instanceof Error ? err.message : t('settings.account.nicknameSaveFailed');
        toast({
          title: t('settings.account.nicknameSaveFailed'),
          description: message,
          variant: 'destructive',
        });
      },
    });
  };

  return (
    <div className="@container divide-y divide-border/60">
      <section className="flex min-w-0 items-center gap-3 pb-4">
        <div className="flex min-w-0 items-center gap-3">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={displayName}
              className="size-12 shrink-0 rounded-full border border-border/60"
            />
          ) : (
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted">
              <User className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-foreground">{displayName}</p>
            {user.email && <p className="truncate text-sm text-foreground-muted">{user.email}</p>}
          </div>
        </div>
      </section>

      <form
        className="grid gap-3 py-4 @2xl:grid-cols-[10rem_minmax(0,1fr)] @2xl:items-start"
        onSubmit={handleNicknameSubmit}
      >
        <div className="min-w-0">
          <Label htmlFor="account-display-nickname" className="text-foreground">
            {t('settings.account.displayNickname')}
          </Label>
          <p className="mt-1 text-xs leading-relaxed text-foreground-passive">
            {t('settings.account.displayNicknameDescription')}
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Input
              id="account-display-nickname"
              className="h-9 min-w-48 flex-1 basis-64"
              value={nicknameDraft}
              maxLength={80}
              placeholder={t('settings.account.displayNicknamePlaceholder')}
              disabled={controlsDisabled}
              onChange={(event) => setNicknameDraft(event.currentTarget.value)}
            />
            <Button
              type="submit"
              variant="default"
              size="sm"
              disabled={controlsDisabled || !nicknameDirty}
              className="w-fit"
            >
              <Save className="h-3.5 w-3.5" />
              {nicknameBusy ? t('settings.account.nicknameSaving') : t('common.save')}
            </Button>
          </div>
          {user.nicknameOverride && (
            <button
              type="button"
              className="w-fit text-xs text-foreground-passive underline-offset-4 hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-50"
              disabled={controlsDisabled}
              onClick={handleNicknameReset}
            >
              {t('settings.account.resetNickname')}
            </button>
          )}
        </div>
      </form>

      <section className="flex flex-col gap-3 pt-4 @2xl:flex-row @2xl:items-center @2xl:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{t('settings.account.signOut')}</p>
          <p className="mt-1 text-xs text-foreground-passive">
            {t('settings.account.signOutDescription')}
          </p>
        </div>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="w-fit"
          onClick={onSignOut}
          disabled={signOutPending || nicknameBusy}
        >
          <LogOut className="h-3.5 w-3.5" />
          {t('settings.account.signOut')}
        </Button>
      </section>
    </div>
  );
}
