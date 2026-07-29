import { Check, ExternalLink, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LOVCODE_DOWNLOAD_URL } from '@shared/lovcode';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';

export function LovcodeInstallBanner({ desktopInstalled = false }: { desktopInstalled?: boolean }) {
  const { t } = useTranslation();
  const Icon = desktopInstalled ? Check : Search;

  return (
    <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background-1">
        <Icon className="size-4 text-foreground-muted" />
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium font-mono text-foreground">
          {t(
            desktopInstalled
              ? 'commandPalette.lovcode.desktopOnlyTitle'
              : 'commandPalette.lovcode.title'
          )}
        </h2>
        <p className="text-xs leading-relaxed text-foreground-passive max-w-sm">
          {t(
            desktopInstalled
              ? 'commandPalette.lovcode.desktopOnlyDescription'
              : 'commandPalette.lovcode.description'
          )}
        </p>
      </div>
      {!desktopInstalled && (
        <Button
          size="sm"
          onClick={() => void rpc.app.openExternal(LOVCODE_DOWNLOAD_URL)}
          className="gap-1.5"
        >
          {t('commandPalette.lovcode.install')}
          <ExternalLink className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
