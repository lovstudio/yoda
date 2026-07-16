import { Coins, ExternalLink, LogIn, LogOut, Radio, RefreshCw, Save, User } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { accountDisplayName } from '@renderer/lib/account-display';
import { useToast } from '@renderer/lib/hooks/use-toast';
import {
  useAccountAuthWarmUp,
  useAccountCommerce,
  useAccountHealth,
  useAccountSession,
  useAccountSignIn,
  useAccountSignOut,
  useAccountUpdateNickname,
  useActivateRelayPass,
  useRevokeRelayDevice,
  useStartRelayTrial,
} from '@renderer/lib/hooks/useAccount';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import { ServerUnavailableMessage } from './ServerUnavailableMessage';
import { SettingsSyncCard } from './SettingsSyncCard';

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
      <section className="flex min-w-0 flex-wrap items-center justify-between gap-3 pb-4">
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void rpc.app.openExternal('https://lovstudio.ai/account')}
        >
          <ExternalLink className="size-3.5" />
          {t('settings.account.manageLovStudioAccount')}
        </Button>
      </section>

      <AccountCommercePanel accountUserId={user.userId} />

      <SettingsSyncCard />

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

function AccountCommercePanel({ accountUserId }: { accountUserId: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const commerce = useAccountCommerce(accountUserId);
  const activate = useActivateRelayPass();
  const startTrial = useStartRelayTrial();
  const revokeDevice = useRevokeRelayDevice();
  const snapshot = commerce.data;

  const activateRelay = () => {
    activate.mutate(undefined, {
      onSuccess: () => toast({ title: t('settings.account.relayActivated') }),
      onError: (error) =>
        toast({
          title: t('settings.account.relayActivationFailed'),
          description: error instanceof Error ? error.message : undefined,
          variant: 'destructive',
        }),
    });
  };

  const startRelayTrial = () => {
    startTrial.mutate(undefined, {
      onSuccess: () => toast({ title: t('settings.account.relayTrialStarted') }),
      onError: (error) =>
        toast({
          title: t('settings.account.relayTrialFailed'),
          description: error instanceof Error ? error.message : undefined,
          variant: 'destructive',
        }),
    });
  };

  return (
    <section className="grid gap-4 py-4 @2xl:grid-cols-[10rem_minmax(0,1fr)]">
      <div>
        <p className="text-sm font-medium text-foreground">{t('settings.account.planAndRelay')}</p>
        <p className="mt-1 text-xs leading-relaxed text-foreground-passive">
          {t('settings.account.planAndRelayDescription')}
        </p>
      </div>
      <div className="min-w-0 space-y-3">
        {commerce.isLoading ? (
          <p className="text-xs text-foreground-muted">{t('common.loading')}</p>
        ) : commerce.error || !snapshot ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-foreground-destructive">
              {t('settings.account.commerceUnavailable')}
            </p>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => void commerce.refetch()}
            >
              <RefreshCw className="size-3" />
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <>
            <div className="grid gap-2 @lg:grid-cols-2">
              <div className="rounded-lg border border-border bg-background-quaternary-1 p-3">
                <div className="flex items-center gap-2 text-xs text-foreground-muted">
                  <Coins className="size-3.5" />
                  {t('settings.account.lovstudioCredits')}
                </div>
                <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                  {snapshot.credits.balance}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-background-quaternary-1 p-3">
                <div className="flex items-center gap-2 text-xs text-foreground-muted">
                  <Radio className="size-3.5" />
                  {t('settings.account.relayPass')}
                </div>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {t(`settings.account.relayStatus.${snapshot.relay.status}`)}
                </p>
                {snapshot.relay.accessEndsAt ? (
                  <p className="mt-1 text-xs text-foreground-passive">
                    {t('settings.account.relayAccessUntil', {
                      date: new Date(snapshot.relay.accessEndsAt).toLocaleDateString(),
                    })}
                  </p>
                ) : null}
              </div>
            </div>

            <p className="text-xs leading-5 text-foreground-muted">
              {t('settings.account.relayOffer', {
                credits: snapshot.offer.priceCredits,
                days: snapshot.offer.periodDays,
                trialDays: snapshot.offer.trialDays,
              })}
            </p>
            {!snapshot.relay.configured ? (
              <p className="text-xs text-foreground-destructive">
                {t('settings.account.relayUnavailable')}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={snapshot.relay.status === 'none' ? startRelayTrial : activateRelay}
                disabled={
                  activate.isPending ||
                  startTrial.isPending ||
                  !snapshot.relay.configured ||
                  (snapshot.relay.status !== 'none' &&
                    snapshot.credits.balance < snapshot.offer.priceCredits)
                }
              >
                <Radio className="size-3.5" />
                {activate.isPending || startTrial.isPending
                  ? t('settings.account.activatingRelay')
                  : snapshot.relay.status === 'none'
                    ? t('settings.account.startRelayTrial', {
                        days: snapshot.offer.trialDays,
                      })
                    : snapshot.relay.enabled
                      ? t('settings.account.renewRelay')
                      : t('settings.account.activateRelay')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void rpc.app.openExternal(snapshot.credits.purchaseUrl)}
              >
                <ExternalLink className="size-3.5" />
                {t('settings.account.buyCredits')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void commerce.refetch()}
                disabled={commerce.isFetching}
              >
                <RefreshCw className={commerce.isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} />
                {t('common.refresh')}
              </Button>
            </div>

            {snapshot.relay.devices.length > 0 ? (
              <div className="space-y-1.5 pt-1">
                <p className="text-xs font-medium text-foreground">
                  {t('settings.account.relayDevices')}
                </p>
                {snapshot.relay.devices.map((device) => (
                  <div
                    key={device.id}
                    className="flex min-w-0 items-center gap-2 rounded-md border border-border px-2.5 py-2 text-xs"
                  >
                    <span
                      className={
                        device.status === 'online'
                          ? 'size-2 rounded-full bg-emerald-500'
                          : 'size-2 rounded-full bg-foreground-tertiary-passive'
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">{device.name}</span>
                    <span className="text-foreground-passive">
                      {t(`settings.account.relayDeviceStatus.${device.status}`)}
                    </span>
                    {device.status !== 'revoked' ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={revokeDevice.isPending}
                        onClick={() => revokeDevice.mutate(device.id)}
                      >
                        {t('settings.account.revokeDevice')}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
