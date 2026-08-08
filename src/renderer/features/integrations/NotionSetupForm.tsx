import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { copyTextToClipboard, useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';

export const NOTION_PERSONAL_TOKEN_URL = 'https://www.notion.so/developers/tokens';
export const NOTION_INTERNAL_CONNECTION_GUIDE_URL =
  'https://developers.notion.com/guides/get-started/internal-connections';

type Props = {
  token: string;
  onChange: (value: string) => void;
  error?: string | null;
};

export function notionConnectionErrorKey(error: string): string {
  const normalized = error.toLowerCase();
  if (normalized.includes('authentication failed') || normalized.includes('unauthorized')) {
    return 'integrations.setup.notion.errors.invalidToken';
  }
  if (
    normalized.includes('required capabilities') ||
    normalized.includes('missing the required') ||
    normalized.includes('restricted_resource')
  ) {
    return 'integrations.setup.notion.errors.missingCapability';
  }
  if (normalized.includes('rate limit')) {
    return 'integrations.setup.notion.errors.rateLimited';
  }
  if (
    normalized.includes('temporarily unavailable') ||
    normalized.includes('service_unavailable')
  ) {
    return 'integrations.setup.notion.errors.unavailable';
  }
  return 'integrations.setup.notion.errors.generic';
}

export function NotionSetupForm({ token, onChange, error }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [showToken, setShowToken] = useState(false);
  const [copiedErrorFor, setCopiedErrorFor] = useState<string | null>(null);
  const copiedError = copiedErrorFor === error;

  const openNotionPage = async (url: string) => {
    try {
      await rpc.app.openExternal(url);
    } catch (openError) {
      toast({
        title: t('integrations.setup.notion.openFailed'),
        description: t('integrations.setup.notion.openFailedDescription'),
        variant: 'destructive',
        debugInfo: openError,
      });
    }
  };

  const copyError = async () => {
    if (!error) return;
    try {
      await copyTextToClipboard(
        [
          'Notion connection failed',
          'Provider: notion',
          'Stage: verify-token',
          `Error: ${error}`,
        ].join('\n')
      );
      setCopiedErrorFor(error);
    } catch (copyFailure) {
      toast({
        title: t('common.copyFailed'),
        variant: 'destructive',
        debugInfo: copyFailure,
      });
    }
  };

  return (
    <div className="@container grid gap-4" data-testid="notion-setup-form">
      <section className="rounded-lg border border-border bg-muted/20 p-3.5">
        <div className="flex flex-col gap-3 @md:flex-row @md:items-center">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-mono text-muted-foreground">
            1
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-foreground">
                {t('integrations.setup.notion.personalTokenTitle')}
              </p>
              <span className="rounded-full border border-border bg-background-2 px-2 py-0.5 text-tiny font-medium text-foreground-muted">
                {t('integrations.setup.notion.recommended')}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t('integrations.setup.notion.personalTokenDescription')}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full @md:w-auto"
            onClick={() => void openNotionPage(NOTION_PERSONAL_TOKEN_URL)}
          >
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            {t('integrations.setup.notion.openTokenPage')}
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          </Button>
        </div>
      </section>

      <section className="grid gap-2">
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-mono text-muted-foreground">
            2
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <Label htmlFor="notion-access-token">{t('integrations.setup.notion.tokenLabel')}</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('integrations.setup.notion.tokenHint')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 pl-11">
          <Input
            id="notion-access-token"
            type={showToken ? 'text' : 'password'}
            placeholder={t('integrations.setup.notion.tokenPlaceholder')}
            value={token}
            onChange={(event) => onChange(event.target.value)}
            className="h-9 flex-1 font-mono"
            aria-invalid={!!error}
            aria-describedby={error ? 'notion-connection-error' : 'notion-token-storage-note'}
            autoComplete="off"
            autoFocus
            spellCheck={false}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setShowToken((visible) => !visible)}
            aria-pressed={showToken}
          >
            {showToken ? (
              <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {t(
              showToken
                ? 'integrations.setup.notion.hideToken'
                : 'integrations.setup.notion.showToken'
            )}
          </Button>
        </div>
        <p
          id="notion-token-storage-note"
          className="flex items-center gap-1.5 pl-11 text-xs text-muted-foreground"
        >
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
          {t('integrations.setup.notion.storedLocally')}
        </p>
      </section>

      {error ? (
        <div
          id="notion-connection-error"
          className="flex items-start justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3"
          role="alert"
        >
          <p className="text-xs leading-relaxed text-destructive">
            {t(notionConnectionErrorKey(error))}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="shrink-0 text-destructive"
            onClick={() => void copyError()}
          >
            {copiedError ? (
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {t(copiedError ? 'common.copied' : 'integrations.setup.notion.copyError')}
          </Button>
        </div>
      ) : null}

      <details className="group rounded-md border border-border/70 bg-muted/10 px-3 py-2.5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t('integrations.setup.notion.internalSummary')}
          <ChevronDown
            className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="mt-2 flex flex-col gap-2 border-t border-border/60 pt-2 @md:flex-row @md:items-center">
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
            {t('integrations.setup.notion.internalDescription')}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full @md:w-auto"
            onClick={() => void openNotionPage(NOTION_INTERNAL_CONNECTION_GUIDE_URL)}
          >
            {t('integrations.setup.notion.openInternalGuide')}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </details>
    </div>
  );
}
