import { CircleUserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { accountDisplayName } from '@renderer/lib/account-display';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { SidebarHelpMenu } from './sidebar-help-menu';

export function SidebarAccountAnchor() {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const { data: session } = useAccountSession();
  const user = session?.isSignedIn ? session.user : null;
  const displayName = user ? accountDisplayName(user) : t('sidebar.lovStudioAccount');

  return (
    <div className="flex min-w-0 flex-1 items-center text-foreground-tertiary-muted">
      <button
        type="button"
        onClick={() => navigate('settings', { tab: 'account' })}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-background-tertiary-1/55 hover:text-foreground-tertiary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-label={t('sidebar.manageLovStudioAccount')}
        title={t('sidebar.manageLovStudioAccount')}
      >
        {user?.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="size-6 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-background-tertiary-2/70">
            <CircleUserRound className="size-3.5" />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium leading-4 text-foreground-tertiary">
          {displayName}
        </span>
      </button>
      <SidebarHelpMenu />
    </div>
  );
}
