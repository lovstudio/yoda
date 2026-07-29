import { ExternalLink, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LOVCODE_DOWNLOAD_URL } from '@shared/lovcode';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';

export function LovcodeInstallBanner({ version }: { version?: string }) {
  const { t } = useTranslation();
  const upgradeRequired = version !== undefined;

  return (
    <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background-1">
        <Search className="size-4 text-foreground-muted" />
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium font-mono text-foreground">
          {t(
            upgradeRequired ? 'commandPalette.lovcode.upgradeTitle' : 'commandPalette.lovcode.title'
          )}
        </h2>
        <p className="text-xs leading-relaxed text-foreground-passive max-w-sm">
          {t(
            upgradeRequired
              ? 'commandPalette.lovcode.upgradeDescription'
              : 'commandPalette.lovcode.description',
            { version }
          )}
        </p>
      </div>
      <Button
        size="sm"
        onClick={() => void rpc.app.openExternal(LOVCODE_DOWNLOAD_URL)}
        className="gap-1.5"
      >
        {t(upgradeRequired ? 'commandPalette.lovcode.upgrade' : 'commandPalette.lovcode.install')}
        <ExternalLink className="size-3.5" />
      </Button>
    </div>
  );
}
