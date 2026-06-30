import { LogIn, LogOut, RefreshCw, RotateCcw, Save, User } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { accountDisplayName } from '@renderer/lib/account-display';
import { useToast } from '@renderer/lib/hooks/use-toast';
import {
  useAccountAuthWarmUp,
  useAccountHealth,
  useAccountRefreshSession,
  useAccountSession,
  useAccountSignIn,
  useAccountSignOut,
  useAccountUpdateNickname,
} from '@renderer/lib/hooks/useAccount';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import { cn } from '@renderer/utils/utils';
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
            ? t('settings.account.signedInDescription', { username: result.user.username })
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
  const refreshSessionMutation = useAccountRefreshSession();
  const updateNicknameMutation = useAccountUpdateNickname();
  const displayName = accountDisplayName(user);
  const [nicknameDraft, setNicknameDraft] = useState(displayName);

  const nicknameDirty = nicknameDraft.trim() !== displayName.trim();
  const nicknameBusy = updateNicknameMutation.isPending;
  const controlsDisabled = refreshSessionMutation.isPending || signOutPending || nicknameBusy;

  const handleRefreshSession = () => {
    refreshSessionMutation.mutate(undefined, {
      onSuccess: (session) => {
        if (session.user) setNicknameDraft(accountDisplayName(session.user));
      },
      onError: (err) => {
        const message = err instanceof Error ? err.message : t('settings.account.refreshFailed');
        toast({
          title: t('settings.account.refreshFailed'),
          description: message,
          variant: 'destructive',
        });
      },
    });
  };

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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={user.username}
            className="h-12 w-12 rounded-full border border-border/60"
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border/60 bg-muted">
            <User className="h-6 w-6 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-sm font-medium text-foreground">
            {t('settings.account.connectedAs')} <span className="font-semibold">{displayName}</span>
          </p>
          <p className="truncate text-xs text-muted-foreground">
            @{user.username}
            {user.email ? ` - ${user.email}` : ''}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          onClick={handleRefreshSession}
          disabled={controlsDisabled}
        >
          <RefreshCw
            className={cn('h-3.5 w-3.5', refreshSessionMutation.isPending && 'animate-spin')}
          />
          {refreshSessionMutation.isPending
            ? t('settings.account.refreshing')
            : t('settings.account.refresh')}
        </Button>
        <Button type="button" className="w-fit" onClick={onSignOut} disabled={controlsDisabled}>
          <LogOut className="h-3.5 w-3.5" />
          {t('settings.account.signOut')}
        </Button>
      </div>
      <form className="flex flex-col gap-2" onSubmit={handleNicknameSubmit}>
        <div className="flex flex-col gap-1">
          <Label htmlFor="account-display-nickname">{t('settings.account.displayNickname')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('settings.account.displayNicknameDescription')}
          </p>
        </div>
        <div className="flex max-w-xl flex-wrap items-center gap-2">
          <Input
            id="account-display-nickname"
            className="min-w-48 flex-1 basis-56"
            value={nicknameDraft}
            maxLength={80}
            placeholder={t('settings.account.displayNicknamePlaceholder')}
            disabled={controlsDisabled}
            onChange={(event) => setNicknameDraft(event.currentTarget.value)}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={controlsDisabled || !nicknameDirty}
            className="w-fit"
          >
            <Save className="h-3.5 w-3.5" />
            {nicknameBusy ? t('settings.account.nicknameSaving') : t('common.save')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={controlsDisabled || !user.nicknameOverride}
            className="w-fit"
            onClick={handleNicknameReset}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('settings.account.resetNickname')}
          </Button>
        </div>
      </form>
    </div>
  );
}
