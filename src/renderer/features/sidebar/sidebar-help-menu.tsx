import {
  BookOpen,
  CircleHelp,
  Download,
  ExternalLink,
  Globe,
  MessageSquareShare,
  RefreshCw,
  Settings,
  Smartphone,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import yodaIcon from '@/assets/images/yoda/icon-light.png';
import { PRODUCT_NAME } from '@shared/app-identity';
import { YODA_DOCS_URL, YODA_WEBSITE_URL } from '@shared/urls';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';

export const SidebarHelpMenu = observer(function SidebarHelpMenu() {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const showFeedbackModal = useShowModal('feedbackModal');
  const update = appState.update;
  const versionLabel = `V${update.currentVersion || '...'}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={t('sidebar.help')}
            title={t('sidebar.help')}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-foreground-tertiary-passive transition-colors hover:bg-background-tertiary-1/55 hover:text-foreground-tertiary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        }
      >
        <CircleHelp className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-60">
        <div className="flex items-center gap-2 px-2 py-2">
          <img src={yodaIcon} alt="" className="size-6 shrink-0 rounded-md" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">
              {PRODUCT_NAME}
            </span>
            <span className="block font-mono text-[10px] font-normal text-foreground-passive">
              {t('settings.update.currentVersion')} {versionLabel}
            </span>
          </span>
        </div>
        <DropdownMenuSeparator />
        {update.hasUpdate ? (
          <DropdownMenuItem onClick={() => navigate('settings', { tab: 'general' })}>
            <Download className="size-4 text-accent" />
            {update.availableVersion ? `V${update.availableVersion}` : t('sidebar.update')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={() => navigate('mobile')}>
          <Smartphone className="size-4" />
          {t('sidebar.mobile')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate('settings')}>
          <Settings className="size-4" />
          {t('sidebar.settings')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void rpc.app.openExternal(YODA_WEBSITE_URL)}>
          <Globe className="size-4" />
          {t('sidebar.website')}
          <ExternalLink className="ml-auto size-3 text-foreground-passive" />
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void rpc.app.openExternal(YODA_DOCS_URL)}>
          <BookOpen className="size-4" />
          {t('sidebar.docs')}
          <ExternalLink className="ml-auto size-3 text-foreground-passive" />
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => showFeedbackModal({})}>
          <MessageSquareShare className="size-4" />
          {t('sidebar.giveFeedback')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={update.state.status === 'checking'}
          onClick={() => void update.check({ notify: true })}
        >
          <RefreshCw
            className={update.state.status === 'checking' ? 'size-4 animate-spin' : 'size-4'}
          />
          {t('settings.update.checkForUpdates')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
