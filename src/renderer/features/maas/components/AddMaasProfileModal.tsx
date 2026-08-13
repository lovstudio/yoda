import { ArrowLeft, Globe2, ImageIcon, Loader2, Search, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MaasProfileWebsiteMetadata } from '@shared/maas';
import { rpc } from '@renderer/lib/ipc';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Input } from '@renderer/lib/ui/input';
import { Textarea } from '@renderer/lib/ui/textarea';

export type NewMaasProfileDraft = {
  displayName: string;
  endpoint: string;
  websiteUrl?: string;
  description?: string;
  logoUrl?: string;
};

type Props = BaseModalProps<NewMaasProfileDraft>;

function normalizedWebsiteUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function AddMaasProfileModal({ onSuccess, onClose }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2>(1);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [inspectionError, setInspectionError] = useState<string | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const canContinue = Boolean(websiteUrl.trim()) && !isInspecting;
  const canCreate = Boolean(displayName.trim() && endpoint.trim());
  const progressLabel = useMemo(
    () => t('maas.addProfileModal.progress', { current: step, total: 2 }),
    [step, t]
  );

  const applyMetadata = (metadata: MaasProfileWebsiteMetadata) => {
    setWebsiteUrl(metadata.websiteUrl);
    setDisplayName(metadata.name ?? '');
    setDescription(metadata.description ?? '');
    setLogoUrl(metadata.logoUrl ?? '');
  };

  const continueManually = () => {
    setInspectionError(null);
    setStep(2);
  };

  const inspectWebsite = async () => {
    if (!canContinue) return;
    setIsInspecting(true);
    setInspectionError(null);
    try {
      const result = await rpc.maas.inspectProfileWebsite(normalizedWebsiteUrl(websiteUrl));
      if (result.success) applyMetadata(result.metadata);
      else setInspectionError(result.error);
    } catch (error) {
      setInspectionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsInspecting(false);
      setStep(2);
    }
  };

  const createProfile = () => {
    if (!canCreate) return;
    onSuccess({
      displayName: displayName.trim(),
      endpoint: endpoint.trim(),
      websiteUrl: normalizedWebsiteUrl(websiteUrl) || undefined,
      description: description.trim() || undefined,
      logoUrl: logoUrl.trim() || undefined,
    });
  };

  return (
    <>
      <DialogHeader className="min-w-0 flex-1 items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.055] text-foreground">
          {step === 1 ? <Globe2 className="size-4" /> : <Sparkles className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-between gap-3">
            <DialogTitle className="text-base font-semibold tracking-normal text-foreground normal-case">
              {t(
                step === 1
                  ? 'maas.addProfileModal.websiteTitle'
                  : 'maas.addProfileModal.detailsTitle'
              )}
            </DialogTitle>
            <span className="shrink-0 text-[11px] tabular-nums text-foreground-muted">
              {progressLabel}
            </span>
          </div>
          <DialogDescription className="text-xs leading-relaxed">
            {t(
              step === 1
                ? 'maas.addProfileModal.websiteDescription'
                : 'maas.addProfileModal.detailsDescription'
            )}
          </DialogDescription>
        </div>
      </DialogHeader>

      <DialogContentArea className="gap-4 px-6 pb-6 pt-0">
        <div className="grid grid-cols-2 gap-1.5" aria-label={progressLabel}>
          <span className="h-1 rounded-full bg-primary" />
          <span
            className={step === 2 ? 'h-1 rounded-full bg-primary' : 'h-1 rounded-full bg-border'}
          />
        </div>

        {step === 1 ? (
          <div className="grid gap-4">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">
                {t('maas.addProfileModal.websiteLabel')}
              </span>
              <Input
                data-autofocus
                type="url"
                inputMode="url"
                spellCheck={false}
                value={websiteUrl}
                placeholder={t('maas.addProfileModal.websitePlaceholder')}
                onChange={(event) => setWebsiteUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void inspectWebsite();
                  }
                }}
              />
              <span className="text-[11px] leading-relaxed text-foreground-muted">
                {t('maas.addProfileModal.websitePrivacy')}
              </span>
            </label>

            <div className="flex items-start gap-3 rounded-xl border border-border/55 bg-foreground/[0.018] px-3.5 py-3">
              <Search className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
              <p className="text-xs leading-relaxed text-foreground-muted">
                {t('maas.addProfileModal.fetchExplanation')}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {inspectionError ? (
              <div
                role="status"
                className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3.5 py-3 text-xs leading-relaxed text-amber-800 dark:text-amber-300"
              >
                {t('maas.addProfileModal.fetchSkipped', { error: inspectionError })}
              </div>
            ) : null}

            <div className="grid gap-3 rounded-xl border border-border/55 bg-background-1/60 p-3.5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-background">
                  {logoUrl ? (
                    <img src={logoUrl} alt="" className="size-10 object-contain" />
                  ) : (
                    <ImageIcon className="size-4 text-foreground-muted" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium text-foreground">
                      {t('maas.connection.displayName')}
                    </span>
                    <Input
                      data-autofocus
                      value={displayName}
                      placeholder={t('maas.addProfileModal.namePlaceholder')}
                      onChange={(event) => setDisplayName(event.target.value)}
                    />
                  </label>
                </div>
              </div>

              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-foreground">
                  {t('maas.addProfileModal.logoLabel')}
                </span>
                <Input
                  type="url"
                  inputMode="url"
                  spellCheck={false}
                  value={logoUrl}
                  placeholder={t('maas.addProfileModal.logoPlaceholder')}
                  onChange={(event) => setLogoUrl(event.target.value)}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-foreground">
                  {t('maas.addProfileModal.descriptionLabel')}
                </span>
                <Textarea
                  value={description}
                  rows={2}
                  placeholder={t('maas.addProfileModal.descriptionPlaceholder')}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
            </div>

            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">
                {t('maas.connection.endpoint')}
              </span>
              <Input
                type="url"
                inputMode="url"
                spellCheck={false}
                value={endpoint}
                placeholder={t('maas.addProfileModal.endpointPlaceholder')}
                onChange={(event) => setEndpoint(event.target.value)}
              />
              <span className="text-[11px] leading-relaxed text-foreground-muted">
                {t('maas.addProfileModal.endpointHelp')}
              </span>
            </label>
          </div>
        )}
      </DialogContentArea>

      <DialogFooter className="justify-between sm:justify-between">
        {step === 1 ? (
          <Button type="button" variant="ghost" onClick={continueManually}>
            {t('maas.addProfileModal.skip')}
          </Button>
        ) : (
          <Button type="button" variant="ghost" onClick={() => setStep(1)}>
            <ArrowLeft className="size-3.5" />
            {t('common.back')}
          </Button>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {step === 1 ? (
            <Button type="button" disabled={!canContinue} onClick={() => void inspectWebsite()}>
              {isInspecting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Search className="size-3.5" />
              )}
              {isInspecting
                ? t('maas.addProfileModal.fetching')
                : t('maas.addProfileModal.fetchAndContinue')}
            </Button>
          ) : (
            <Button type="button" disabled={!canCreate} onClick={createProfile}>
              {t('maas.addProfileModal.create')}
            </Button>
          )}
        </div>
      </DialogFooter>
    </>
  );
}
