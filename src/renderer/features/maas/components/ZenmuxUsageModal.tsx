import { BarChart3, ExternalLink, FileSearch, ListChecks, ReceiptText } from 'lucide-react';
import type React from 'react';
import { useTranslation } from 'react-i18next';
import { MAAS_PLATFORMS, type MaasConnection } from '@shared/maas';
import { rpc } from '@renderer/lib/ipc';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { cn } from '@renderer/utils/utils';
import { useMaasConnections } from '../useMaas';

const ZENMUX_COST_URL = 'https://zenmux.ai/platform/cost';
const ZENMUX_USAGE_URL = 'https://zenmux.ai/platform/usage';
const ZENMUX_LOGS_URL = 'https://zenmux.ai/platform/logs';

type Props = BaseModalProps<void>;

function findZenmuxConnection(connections: MaasConnection[] | undefined): MaasConnection {
  return (
    connections?.find((connection) => connection.platformId === 'zenmux') ?? {
      platformId: 'zenmux',
      displayName: MAAS_PLATFORMS.zenmux.name,
      endpoint: MAAS_PLATFORMS.zenmux.defaultEndpoint,
      keyFingerprint: null,
      connectedAt: null,
      lastCheckedAt: null,
      connected: false,
      error: null,
    }
  );
}

function formatDateTime(value: string | null): string {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function ZenmuxUsageModal(_props: Props) {
  const { t } = useTranslation();
  const { data: connections } = useMaasConnections();
  const connection = findZenmuxConnection(connections);

  return (
    <>
      <DialogHeader className="min-w-0 flex-1 items-center gap-4">
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-lg font-semibold tracking-normal text-foreground normal-case">
            {t('maas.records.title')}
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm leading-relaxed">
            {t('maas.records.subtitle')}
          </DialogDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => void rpc.app.openExternal(ZENMUX_COST_URL)}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t('maas.records.openZenmuxCost')}
        </Button>
      </DialogHeader>
      <DialogContentArea className="gap-4 px-6 pb-6 pt-0">
        <section className="rounded-lg border border-border bg-background p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <ReceiptText className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium text-foreground">
                  {t('maas.records.officialCostTitle')}
                </h3>
                <Badge variant="outline" className="border-border/70 bg-background-secondary">
                  {t('maas.records.officialCostBadge')}
                </Badge>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t('maas.records.officialCostDescription')}
              </p>
            </div>
          </div>
        </section>

        <div className="grid gap-3 sm:grid-cols-3">
          <ZenmuxConsoleLink
            icon={BarChart3}
            title={t('maas.records.costAnalyticsTitle')}
            description={t('maas.records.costAnalyticsDescription')}
            url={ZENMUX_COST_URL}
          />
          <ZenmuxConsoleLink
            icon={ListChecks}
            title={t('maas.records.usageAnalyticsTitle')}
            description={t('maas.records.usageAnalyticsDescription')}
            url={ZENMUX_USAGE_URL}
          />
          <ZenmuxConsoleLink
            icon={FileSearch}
            title={t('maas.records.logsTitle')}
            description={t('maas.records.logsDescription')}
            url={ZENMUX_LOGS_URL}
          />
        </div>

        <section className="rounded-lg border border-border/70 bg-background-1 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('maas.records.connectionTitle')}
          </div>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <ConnectionMeta label={t('maas.records.endpoint')} value={connection.endpoint} />
            <ConnectionMeta
              label={t('maas.records.key')}
              value={
                connection.keyFingerprint
                  ? t('maas.records.keyFingerprint', {
                      fingerprint: connection.keyFingerprint,
                    })
                  : t('maas.records.noKey')
              }
            />
            <ConnectionMeta
              label={t('maas.records.connectionStatus')}
              value={
                connection.connected ? t('maas.records.connected') : t('maas.records.notConnected')
              }
              ok={connection.connected}
            />
            <ConnectionMeta
              label={t('maas.records.lastChecked')}
              value={
                connection.lastCheckedAt
                  ? formatDateTime(connection.lastCheckedAt)
                  : t('maas.records.neverChecked')
              }
            />
          </div>
        </section>
      </DialogContentArea>
    </>
  );
}

const ZenmuxConsoleLink: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  url: string;
}> = ({ icon: Icon, title, description, url }) => {
  return (
    <button
      type="button"
      className="group min-w-0 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-primary/40 hover:bg-background-1 focus:outline-none focus:ring-2 focus:ring-ring"
      onClick={() => void rpc.app.openExternal(url)}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background-secondary text-foreground-muted transition-colors group-hover:text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
      </div>
      <h3 className="mt-3 text-sm font-medium text-foreground">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
    </button>
  );
};

const ConnectionMeta: React.FC<{ label: string; value: string; ok?: boolean }> = ({
  label,
  value,
  ok,
}) => {
  return (
    <div className="min-w-0 rounded-md border border-border/70 bg-background px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-1 truncate text-sm text-foreground',
          ok === true && 'text-emerald-700 dark:text-emerald-300',
          ok === false && 'text-muted-foreground'
        )}
      >
        {value}
      </div>
    </div>
  );
};
