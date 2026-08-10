import {
  BookOpen,
  ChevronUp,
  Download,
  ExternalLink,
  Globe,
  MessageSquareShare,
  RefreshCw,
  Settings,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import yodaIcon from '@/assets/images/yoda/icon-light.png';
import { PRODUCT_NAME } from '@shared/app-identity';
import { YODA_DOCS_URL, YODA_WEBSITE_URL } from '@shared/urls';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';

export const SidebarProductMenu = observer(function SidebarProductMenu() {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const showFeedbackModal = useShowModal('feedbackModal');
  const [open, setOpen] = useState(false);
  const update = appState.update;
  const versionLabel = `V${update.currentVersion || '...'}`;

  const openExternal = (url: string) => {
    setOpen(false);
    void rpc.app.openExternal(url);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={t('workspaceStatus.productMenu')}
        title={t('workspaceStatus.productMenu')}
        className="group/product flex h-full w-full min-w-0 items-center gap-1.5 px-2 text-foreground-tertiary-muted transition-colors hover:bg-background-tertiary-1 hover:text-foreground-tertiary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border [-webkit-app-region:no-drag]"
      >
        <img src={yodaIcon} alt="" className="size-4 shrink-0 rounded-[3px]" />
        <span className="min-w-0 truncate font-medium text-foreground-tertiary">
          {PRODUCT_NAME}
        </span>
        <span
          className={cn(
            'shrink-0 font-mono text-[10px] text-foreground-tertiary-passive',
            update.hasUpdate && 'text-accent'
          )}
        >
          {versionLabel}
        </span>
        <ChevronUp className="size-3 shrink-0 text-foreground-tertiary-passive transition-transform group-data-popup-open/product:rotate-180" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        className="w-64 gap-0 overflow-hidden rounded-xl border border-border bg-background p-1.5 text-foreground shadow-xl"
      >
        <div className="mb-1 flex items-center gap-2 px-2 py-2">
          <img src={yodaIcon} alt="" className="size-7 rounded-lg" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{PRODUCT_NAME}</div>
            <div className="font-mono text-[10px] text-foreground-passive">{versionLabel}</div>
          </div>
          {update.hasUpdate ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('settings', { tab: 'general' });
              }}
              className="flex h-7 items-center gap-1 rounded-full bg-accent/12 px-2 text-[10px] font-medium text-accent transition-colors hover:bg-accent/20"
            >
              <Download className="size-3" />
              {update.availableVersion ? `V${update.availableVersion}` : t('sidebar.update')}
            </button>
          ) : null}
        </div>
        <div className="mb-1 border-t border-border" />
        <ProductMenuItem
          icon={Smartphone}
          label={t('sidebar.mobile')}
          onClick={() => {
            setOpen(false);
            navigate('mobile');
          }}
        />
        <ProductMenuItem
          icon={Settings}
          label={t('sidebar.settings')}
          onClick={() => {
            setOpen(false);
            navigate('settings');
          }}
        />
        <div className="mb-1 border-t border-border" />
        <ProductMenuItem
          icon={Globe}
          label={t('sidebar.website')}
          suffix={<ExternalLink className="size-3 text-foreground-passive" />}
          onClick={() => openExternal(YODA_WEBSITE_URL)}
        />
        <ProductMenuItem
          icon={BookOpen}
          label={t('sidebar.docs')}
          suffix={<ExternalLink className="size-3 text-foreground-passive" />}
          onClick={() => openExternal(YODA_DOCS_URL)}
        />
        <ProductMenuItem
          icon={MessageSquareShare}
          label={t('sidebar.giveFeedback')}
          onClick={() => {
            setOpen(false);
            showFeedbackModal({});
          }}
        />
        <ProductMenuItem
          icon={RefreshCw}
          label={t('settings.update.checkForUpdates')}
          disabled={update.state.status === 'checking'}
          iconClassName={update.state.status === 'checking' ? 'animate-spin' : undefined}
          onClick={() => {
            setOpen(false);
            void update.check({ notify: true });
          }}
        />
      </PopoverContent>
    </Popover>
  );
});

function ProductMenuItem({
  icon: Icon,
  label,
  suffix,
  disabled,
  iconClassName,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  suffix?: ReactNode;
  disabled?: boolean;
  iconClassName?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-xs text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground disabled:opacity-50"
    >
      <Icon className={cn('size-3.5 shrink-0', iconClassName)} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {suffix}
    </button>
  );
}
