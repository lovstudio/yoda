import {
  ChartNoAxesColumn,
  ChevronRight,
  CircleUserRound,
  LogIn,
  LogOut,
  Settings,
  UserRound,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { accountDisplayName } from '@renderer/lib/account-display';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useAccountSession, useAccountSignOut } from '@renderer/lib/hooks/useAccount';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { SidebarHelpMenu } from './sidebar-help-menu';

export function SidebarAccountAnchor() {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const { data: session } = useAccountSession();
  const signOutMutation = useAccountSignOut();
  const { toast } = useToast();
  const showConfirmSignOut = useShowModal('confirmActionModal');
  const user = session?.isSignedIn ? session.user : null;
  const displayName = user ? accountDisplayName(user) : t('sidebar.lovStudioAccount');

  const handleSignOut = () => {
    showConfirmSignOut({
      title: t('settings.account.signOutConfirmTitle'),
      description: t('settings.account.signOutConfirmDescription'),
      confirmLabel: t('settings.account.signOutConfirmLabel'),
      variant: 'default',
      onSuccess: () => {
        void signOutMutation.mutateAsync().catch((error: unknown) => {
          toast({
            title: t('settings.account.signOutFailed'),
            description: error instanceof Error ? error.message : undefined,
            variant: 'destructive',
          });
        });
      },
    });
  };

  return (
    <div className="flex min-w-0 flex-1 items-center text-foreground-tertiary-muted">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={t('sidebar.manageLovStudioAccount')}
              title={t('sidebar.manageLovStudioAccount')}
              className="group/account flex min-w-0 flex-1 items-center gap-1.5 rounded-xl bg-background-tertiary-1/30 px-1 py-0.5 text-left backdrop-blur-sm transition-colors hover:bg-background-tertiary-1/55 hover:text-foreground-tertiary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          }
        >
          <AccountAvatar user={user} />
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium leading-4 text-foreground-tertiary">
            {displayName}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={8}
          className="w-64 rounded-xl border-border/40 bg-background-quaternary/85 p-1.5 backdrop-blur-lg"
        >
          <div className="flex items-center gap-2 px-2 py-2">
            <AccountAvatar user={user} size="md" />
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {displayName}
            </span>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate('usage')}>
            <ChartNoAxesColumn className="size-4" />
            {t('settings.tabs.usage')}
            <ChevronRight className="ml-auto size-3 text-foreground-passive" />
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('settings', { tab: 'account' })}>
            <UserRound className="size-4" />
            {t('settings.account.manageLovStudioAccount')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('settings')}>
            <Settings className="size-4" />
            {t('sidebar.settings')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {user ? (
            <DropdownMenuItem disabled={signOutMutation.isPending} onClick={handleSignOut}>
              <LogOut className="size-4" />
              {t('settings.account.signOut')}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => navigate('settings', { tab: 'account' })}>
              <LogIn className="size-4" />
              {session?.hasAccount
                ? t('settings.account.signIn')
                : t('settings.account.createAccount')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <SidebarHelpMenu />
    </div>
  );
}

function AccountAvatar({
  user,
  size = 'sm',
}: {
  user: { avatarUrl?: string | null } | null;
  size?: 'sm' | 'md';
}) {
  const sizeClass = size === 'md' ? 'size-7' : 'size-6';
  const iconClass = size === 'md' ? 'size-4' : 'size-3.5';

  return user?.avatarUrl ? (
    <img
      src={user.avatarUrl}
      alt=""
      className={`${sizeClass} shrink-0 rounded-full object-cover`}
    />
  ) : (
    <span
      className={`flex ${sizeClass} shrink-0 items-center justify-center rounded-full bg-background-tertiary-2/70`}
    >
      <CircleUserRound className={iconClass} />
    </span>
  );
}
