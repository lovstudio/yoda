import { KeyRound, Loader2, Network, Server, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAAS_GATEWAY_EXTENSION_ID } from '@shared/extensions';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';

export function MaasGatewayStep({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation();
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const install = async () => {
    setInstalling(true);
    setError(null);
    try {
      const extension = await rpc.extensions.getExtension({
        extensionId: MAAS_GATEWAY_EXTENSION_ID,
      });
      if (!extension) throw new Error(t('onboarding.maasGateway.unavailable'));
      const result = await rpc.extensions.install({
        extensionId: MAAS_GATEWAY_EXTENSION_ID,
        grantedCapabilities: extension.manifest.capabilities,
      });
      if (!result.success) {
        throw new Error(result.error ?? t('onboarding.maasGateway.installFailed'));
      }
      onComplete();
    } catch (installError) {
      setError(
        installError instanceof Error
          ? installError.message
          : t('onboarding.maasGateway.installFailed')
      );
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="flex w-full max-w-2xl flex-col gap-6 px-10 py-8">
      <div>
        <h1 className="text-xl font-medium">{t('onboarding.maasGateway.title')}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {t('onboarding.maasGateway.description')}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Permission icon={Server} label={t('extensions.capabilities.network.loopback')} />
        <Permission icon={Network} label={t('extensions.capabilities.network.outbound')} />
        <Permission icon={KeyRound} label={t('extensions.capabilities.secrets.provider')} />
        <Permission
          icon={ShieldCheck}
          label={t('extensions.capabilities.client.codex.configure')}
        />
      </div>

      <p className="text-xs text-muted-foreground">{t('onboarding.maasGateway.security')}</p>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={installing} onClick={onComplete}>
          {t('onboarding.maasGateway.skip')}
        </Button>
        <Button disabled={installing} onClick={() => void install()}>
          {installing && <Loader2 className="size-4 animate-spin" />}
          {t('onboarding.maasGateway.install')}
        </Button>
      </div>
    </div>
  );
}

function Permission({ icon: Icon, label }: { icon: typeof Server; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
      <Icon className="size-4 text-muted-foreground" />
      <span>{label}</span>
    </div>
  );
}
