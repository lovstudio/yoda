import { CircleUserRound, Coins } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { accountDisplayName } from '@renderer/lib/account-display';
import { useAccountCommerce, useAccountSession } from '@renderer/lib/hooks/useAccount';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';

export function SidebarAccountAnchor() {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const { data: session, isLoading } = useAccountSession();
  const user = session?.isSignedIn ? session.user : null;
  const commerce = useAccountCommerce(user?.userId, Boolean(user));
  const displayName = user ? accountDisplayName(user) : t('sidebar.lovStudioAccount');
  const subtitle = isLoading
    ? t('common.loading')
    : user
      ? user.email
      : session?.hasAccount
        ? t('sidebar.accountSignInRequired')
        : t('sidebar.accountLocalMode');

  return (
    <button
      type="button"
      onClick={() => navigate('settings', { tab: 'account' })}
      className="flex h-11 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-foreground-tertiary-muted transition-colors hover:bg-background-tertiary-1 hover:text-foreground-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={t('sidebar.manageLovStudioAccount')}
      title={t('sidebar.manageLovStudioAccount')}
    >
      {user?.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt=""
          className="size-7 shrink-0 rounded-full border border-border/70 object-cover"
        />
      ) : (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background-tertiary-1">
          <CircleUserRound className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground-tertiary">
          {displayName}
        </span>
        <span className="block truncate text-[10px] text-foreground-tertiary-passive">
          {subtitle}
        </span>
      </span>
      {commerce.data ? (
        <span className="flex shrink-0 items-center gap-1 text-[10px] tabular-nums text-foreground-tertiary-passive">
          <Coins className="size-3" />
          {commerce.data.credits.balance}
        </span>
      ) : null}
    </button>
  );
}
