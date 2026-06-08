import {
  ChevronsUpDown,
  LogIn,
  LogOut,
  MessageSquareShare,
  Settings,
  Settings2,
  User,
} from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@renderer/lib/hooks/use-toast';
import {
  useAccountSession,
  useAccountSignIn,
  useAccountSignOut,
} from '@renderer/lib/hooks/useAccount';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';

/**
 * Account anchor pinned to the very bottom of the left sidebar. Surfaces the
 * signed-in identity (avatar / name / email) and an account menu, falling back
 * to a sign-in prompt when no live session exists. Mirrors the data flow of the
 * settings AccountTab so the two stay consistent.
 */
export const SidebarAccount: React.FC = function SidebarAccount() {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const { toast } = useToast();

  const { data: session, isLoading } = useAccountSession();
  const signInMutation = useAccountSignIn();
  const signOutMutation = useAccountSignOut();

  const showAccountDeviceFlow = useShowModal('accountDeviceFlowModal');
  const showConfirmSignOut = useShowModal('confirmActionModal');
  const showFeedbackModal = useShowModal('feedbackModal');

  const user = session?.user ?? null;
  const isSignedIn = session?.isSignedIn ?? false;

  const goToAccount = React.useCallback(() => {
    navigate('settings', { tab: 'account' });
  }, [navigate]);

  const goToSettings = React.useCallback(() => {
    navigate('settings');
  }, [navigate]);

  const handleGiveFeedback = React.useCallback(() => {
    showFeedbackModal({});
  }, [showFeedbackModal]);

  const handleSignIn = React.useCallback(() => {
    showAccountDeviceFlow({});
    signInMutation.mutateAsync(undefined).catch(() => {
      // The device-flow modal owns its own error surface; nothing to do here.
    });
  }, [showAccountDeviceFlow, signInMutation]);

  const handleSignOut = React.useCallback(() => {
    showConfirmSignOut({
      title: t('settings.account.signOutConfirmTitle'),
      description: t('settings.account.signOutConfirmDescription'),
      confirmLabel: t('settings.account.signOutConfirmLabel'),
      variant: 'default',
      onSuccess: () => {
        signOutMutation.mutateAsync().catch((err) => {
          toast({
            title: t('settings.account.signOutFailed'),
            description: err instanceof Error ? err.message : undefined,
            variant: 'destructive',
          });
        });
      },
    });
  }, [showConfirmSignOut, signOutMutation, t, toast]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className="size-8 shrink-0 animate-pulse rounded-full bg-background-tertiary-2" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="h-2.5 w-2/3 animate-pulse rounded bg-background-tertiary-2" />
          <div className="h-2 w-1/2 animate-pulse rounded bg-background-tertiary-1" />
        </div>
      </div>
    );
  }

  if (isSignedIn && user) {
    const displayName = user.name?.trim() || `@${user.username}`;
    const secondary = user.email?.trim() || `@${user.username}`;

    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            'group/account flex w-full items-center gap-2.5 px-3 py-2.5 text-left outline-none transition-colors',
            'hover:bg-background-tertiary-1 focus-visible:bg-background-tertiary-1',
            'data-popup-open:bg-background-tertiary-1'
          )}
          aria-label={t('sidebar.account.openMenu')}
        >
          <Avatar avatarUrl={user.avatarUrl} alt={displayName} />
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-[13px] font-medium text-foreground-tertiary">
              {displayName}
            </span>
            <span className="truncate text-[11px] text-foreground-tertiary-passive">
              {secondary}
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-foreground-tertiary-passive transition-colors group-hover/account:text-foreground-tertiary" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="top"
          sideOffset={6}
          className="w-(--anchor-width) min-w-56"
        >
          <DropdownMenuItem onClick={goToAccount}>
            <Settings2 className="size-4" />
            {t('sidebar.account.manage')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={goToSettings}>
            <Settings className="size-4" />
            {t('sidebar.settings')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleGiveFeedback}>
            <MessageSquareShare className="size-4" />
            {t('sidebar.giveFeedback')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={handleSignOut}
            disabled={signOutMutation.isPending}
          >
            <LogOut className="size-4" />
            {t('settings.account.signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
};

function Avatar({ avatarUrl, alt }: { avatarUrl?: string; alt: string }) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={alt}
        className="size-8 shrink-0 rounded-full border border-border/60 object-cover"
      />
    );
  }
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background-tertiary-2 text-foreground-tertiary">
      <User className="size-4" />
    </span>
  );
}
