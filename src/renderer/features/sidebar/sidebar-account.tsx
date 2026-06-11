import { ChevronsUpDown, LogIn, User } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  useAccountAuthWarmUp,
  useAccountSession,
  useAccountSignIn,
} from '@renderer/lib/hooks/useAccount';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { cn } from '@renderer/utils/utils';

/**
 * Account anchor pinned to the very bottom of the left sidebar. Surfaces the
 * signed-in identity (avatar / name) and toggles the secondary sidebar
 * navigation, falling back to a sign-in prompt when no live session exists.
 * Usage details live in the dedicated Usage view, not here.
 * Mirrors the data flow of the settings AccountTab so the two stay consistent.
 */
export const SidebarAccount: React.FC = observer(function SidebarAccount() {
  const { t } = useTranslation();

  const { data: session, isLoading } = useAccountSession();
  const signInMutation = useAccountSignIn();

  const showAccountDeviceFlow = useShowModal('accountDeviceFlowModal');

  const user = session?.user ?? null;
  const isSignedIn = session?.isSignedIn ?? false;

  useAccountAuthWarmUp(!isLoading && !isSignedIn);

  const handleToggleSidebarNav = React.useCallback(() => {
    sidebarStore.toggleNavSectionHidden();
  }, []);

  const handleSignIn = React.useCallback(() => {
    showAccountDeviceFlow({});
    signInMutation.mutateAsync(undefined).catch(() => {
      // The device-flow modal owns its own error surface; nothing to do here.
    });
  }, [showAccountDeviceFlow, signInMutation]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5">
        <div className="size-6 shrink-0 animate-pulse rounded-full bg-background-tertiary-2" />
        <div className="h-2.5 w-2/3 animate-pulse rounded bg-background-tertiary-2" />
      </div>
    );
  }

  if (isSignedIn && user) {
    const displayName = user.name?.trim() || `@${user.username}`;
    const navHidden = sidebarStore.navSectionHidden;

    return (
      <button
        type="button"
        onClick={handleToggleSidebarNav}
        className={cn(
          'group/account flex w-full items-center gap-2 px-3 py-1.5 text-left outline-none transition-colors',
          'hover:bg-background-tertiary-1 focus-visible:bg-background-tertiary-1'
        )}
        aria-expanded={!navHidden}
        aria-label={navHidden ? t('sidebar.account.showNav') : t('sidebar.account.hideNav')}
        title={navHidden ? t('sidebar.account.showNav') : t('sidebar.account.hideNav')}
      >
        <Avatar avatarUrl={user.avatarUrl} alt={displayName} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground-tertiary">
          {displayName}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-foreground-tertiary-passive transition-colors group-hover/account:text-foreground-tertiary" />
      </button>
    );
  }

  // Signed out or session expired — a single sign-in affordance.
  return (
    <button
      type="button"
      onClick={handleSignIn}
      disabled={signInMutation.isPending}
      className={cn(
        'group/account flex w-full items-center gap-2.5 px-3 py-2.5 text-left outline-none transition-colors',
        'hover:bg-background-tertiary-1 focus-visible:bg-background-tertiary-1 disabled:opacity-60'
      )}
      aria-label={t('settings.account.signIn')}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-foreground-tertiary-passive transition-colors group-hover/account:border-accent/60 group-hover/account:text-accent">
        <User className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[13px] font-medium text-foreground-tertiary">
          {signInMutation.isPending
            ? t('settings.account.signingIn')
            : t('sidebar.account.signInPrompt')}
        </span>
        <span className="truncate text-[11px] text-foreground-tertiary-passive">
          {t('sidebar.account.signInHint')}
        </span>
      </span>
      <LogIn className="size-3.5 shrink-0 text-foreground-tertiary-passive transition-colors group-hover/account:text-accent" />
    </button>
  );
});

function Avatar({ avatarUrl, alt }: { avatarUrl?: string; alt: string }) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={alt}
        className="size-6 shrink-0 rounded-full border border-border/60 object-cover"
      />
    );
  }
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background-tertiary-2 text-foreground-tertiary">
      <User className="size-3.5" />
    </span>
  );
}
