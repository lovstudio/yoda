import { CircleHelp, CircleUserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { YODA_DOCS_URL } from '@shared/urls';
import { accountDisplayName } from '@renderer/lib/account-display';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

export function SidebarAccountAnchor() {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const { data: session, isLoading } = useAccountSession();
  const user = session?.isSignedIn ? session.user : null;
  const displayName = user ? accountDisplayName(user) : t('sidebar.lovStudioAccount');
  const subtitle = isLoading
    ? t('common.loading')
    : user
      ? user.email
      : session?.hasAccount
        ? t('sidebar.accountSignInRequired')
        : t('sidebar.accountLocalMode');

  return (
    <div className="group/account flex min-h-14 w-full min-w-0 items-center rounded-2xl border border-border/60 bg-background-tertiary-1/70 text-foreground-tertiary-muted shadow-[0_1px_0_rgb(255_255_255_/_0.04)] transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-px hover:border-border hover:bg-background-tertiary-2/80 hover:shadow-sm">
      <button
        type="button"
        onClick={() => navigate('settings', { tab: 'account' })}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[inherit] px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={t('sidebar.manageLovStudioAccount')}
        title={`${t('sidebar.manageLovStudioAccount')} · ${subtitle}`}
      >
        {user?.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt=""
            className="size-8 shrink-0 rounded-full border border-border/70 object-cover shadow-sm"
          />
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background-tertiary-2 shadow-sm">
            <CircleUserRound className="size-[17px]" />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-4 text-foreground-tertiary">
          {displayName}
        </span>
      </button>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={() => void rpc.app.openExternal(YODA_DOCS_URL)}
              className="mr-2 flex size-8 shrink-0 items-center justify-center rounded-full text-foreground-tertiary-passive transition-colors hover:bg-background-tertiary-2 hover:text-foreground-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              aria-label={t('sidebar.help')}
            />
          }
        >
          <CircleHelp className="size-[19px]" />
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8}>
          {t('sidebar.help')}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
