import { RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CUSTOM_THEME_SCHEMA_VERSION,
  customThemeSchema,
  type CustomTheme,
  type DreamSkin,
  type DreamSkinDecorationPreset,
} from '@shared/custom-theme';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { dreamSkinBackgroundImage } from '@renderer/lib/providers/dream-skin-assets';
import {
  analyzeDreamSkinImage,
  rebuildDreamSkinColors,
  updateDreamSkinAccent,
} from '@renderer/lib/providers/dream-skin-palette';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Input } from '@renderer/lib/ui/input';
import { Switch } from '@renderer/lib/ui/switch';

export type DreamSkinEditorModalArgs = {
  initialTheme: CustomTheme;
};

type Props = BaseModalProps<CustomTheme> & DreamSkinEditorModalArgs;

const DECORATIONS: DreamSkinDecorationPreset[] = [
  'none',
  'petals',
  'embers',
  'stars',
  'orbit',
  'glow',
];

export function DreamSkinEditorModal({ initialTheme, onSuccess, onClose }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<CustomTheme>(initialTheme);
  const [analyzing, setAnalyzing] = useState(false);
  const skin = draft.skin;

  const previewStyle = useMemo(() => {
    if (!skin) return undefined;
    return {
      backgroundImage: dreamSkinBackgroundImage(skin.image),
      backgroundPosition: `${skin.imageTreatment.positionX}% ${skin.imageTreatment.positionY}%`,
      filter: `blur(${skin.imageTreatment.blur}px)`,
      opacity: skin.imageTreatment.artOpacity,
      transform: `scale(${skin.imageTreatment.zoom})`,
    };
  }, [skin]);

  if (!skin) return null;

  const updateSkin = (next: (current: DreamSkin) => DreamSkin) => {
    setDraft((current) => (current.skin ? { ...current, skin: next(current.skin) } : current));
  };

  const rerunAnalysis = async () => {
    setAnalyzing(true);
    try {
      const analysis = await analyzeDreamSkinImage(skin.image);
      setDraft((current) => ({
        ...current,
        mode: analysis.mode,
        colors: analysis.colors,
      }));
    } finally {
      setAnalyzing(false);
    }
  };

  const submit = () => {
    onSuccess(
      customThemeSchema.parse({
        ...draft,
        schemaVersion: CUSTOM_THEME_SCHEMA_VERSION,
      })
    );
  };

  const textOnRight = skin.imageTreatment.textSide === 'right';
  const overlayDirection = textOnRight ? '270deg' : '90deg';
  const overlayStop = `${Math.round(32 + skin.imageTreatment.overlayStrength * 48)}%`;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('settings.theme.skinEditorTitle')}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="@container gap-4">
        <div
          className="relative isolate min-h-64 overflow-hidden rounded-xl border"
          style={
            {
              borderColor: draft.colors.border1,
              backgroundColor: draft.colors.background,
              color: draft.colors.foreground,
              '--primary-button-background': draft.colors.primaryButtonBackground,
              '--status-in-review': draft.colors.statusInReview,
            } as CSSProperties
          }
          data-dream-decoration={skin.decorations.preset}
        >
          <div className="absolute -inset-3 bg-cover transition-transform" style={previewStyle} />
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(${overlayDirection}, color-mix(in srgb, ${draft.colors.background} ${Math.round(
                58 + skin.imageTreatment.overlayStrength * 38
              )}%, transparent) 0%, color-mix(in srgb, ${draft.colors.background} ${Math.round(
                32 + skin.imageTreatment.overlayStrength * 44
              )}%, transparent) ${overlayStop}, transparent 84%)`,
            }}
          />
          <div
            className="dream-skin-editor-decoration absolute inset-0"
            style={{ opacity: 0.2 + skin.decorations.density * 0.65 }}
            aria-hidden="true"
          />
          {skin.imageTreatment.showOverlayCopy ? (
            <div
              className={`relative z-10 flex min-h-64 max-w-[62%] flex-col justify-center gap-3 p-8 ${
                textOnRight ? 'ml-auto items-end text-right' : 'items-start text-left'
              }`}
            >
              <span
                className="rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.16em]"
                style={{
                  borderColor: draft.colors.border1,
                  backgroundColor: `${draft.colors.background}cc`,
                  color: draft.colors.primaryButtonBackground,
                }}
              >
                {skin.statusText}
              </span>
              <strong
                className={
                  skin.typography === 'sans'
                    ? 'text-3xl font-semibold'
                    : 'font-serif text-3xl font-semibold'
                }
              >
                {draft.name}
              </strong>
              <span className="text-sm" style={{ color: draft.colors.foregroundMuted }}>
                {skin.tagline}
              </span>
            </div>
          ) : null}
        </div>

        <section className="grid gap-3 rounded-lg border border-border/70 bg-background-1 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-foreground">
                {t('settings.theme.skinEditorIdentity')}
              </div>
              <div className="text-[11px] text-foreground-muted">
                {t('settings.theme.skinEditorIdentityHint')}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void rerunAnalysis()}
              disabled={analyzing}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${analyzing ? 'animate-spin' : ''}`} />
              {t('settings.theme.reanalyzePalette')}
            </Button>
          </div>
          <div className="grid gap-3 @2xl:grid-cols-2">
            <EditorField label={t('settings.theme.skinName')}>
              <Input
                value={draft.name}
                maxLength={80}
                data-autofocus
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
              />
            </EditorField>
            <EditorField label={t('settings.theme.skinSubtitle')}>
              <Input
                value={skin.brandSubtitle}
                maxLength={80}
                onChange={(event) =>
                  updateSkin((current) => ({ ...current, brandSubtitle: event.target.value }))
                }
              />
            </EditorField>
            <EditorField label={t('settings.theme.skinTagline')}>
              <Input
                value={skin.tagline}
                maxLength={160}
                onChange={(event) =>
                  updateSkin((current) => ({ ...current, tagline: event.target.value }))
                }
              />
            </EditorField>
            <EditorField label={t('settings.theme.skinStatus')}>
              <Input
                value={skin.statusText}
                maxLength={80}
                onChange={(event) =>
                  updateSkin((current) => ({ ...current, statusText: event.target.value }))
                }
              />
            </EditorField>
          </div>
        </section>

        <section className="grid gap-3 rounded-lg border border-border/70 bg-background-1 p-3">
          <div className="text-xs font-semibold text-foreground">
            {t('settings.theme.skinEditorPalette')}
          </div>
          <div className="grid gap-3 @2xl:grid-cols-3">
            <EditorField label={t('settings.theme.skinMode')}>
              <NativeSelect
                value={draft.mode}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    mode: value as CustomTheme['mode'],
                    colors: rebuildDreamSkinColors(current.colors, value as CustomTheme['mode']),
                  }))
                }
                options={[
                  { value: 'light', label: t('settings.theme.skinModeLight') },
                  { value: 'dark', label: t('settings.theme.skinModeDark') },
                ]}
              />
            </EditorField>
            <EditorField label={t('settings.theme.skinAccent')}>
              <div className="flex items-center gap-2">
                <Input
                  type="color"
                  className="w-12 px-1"
                  value={draft.colors.primaryButtonBackground}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      colors: updateDreamSkinAccent(
                        current.colors,
                        event.target.value,
                        current.mode
                      ),
                    }))
                  }
                />
                <code className="text-xs text-foreground-muted">
                  {draft.colors.primaryButtonBackground}
                </code>
              </div>
            </EditorField>
            <EditorField label={t('settings.theme.skinTypography')}>
              <NativeSelect
                value={skin.typography}
                onChange={(value) =>
                  updateSkin((current) => ({
                    ...current,
                    typography: value as DreamSkin['typography'],
                  }))
                }
                options={[
                  { value: 'editorial', label: t('settings.theme.skinTypographyEditorial') },
                  { value: 'serif', label: t('settings.theme.skinTypographySerif') },
                  { value: 'sans', label: t('settings.theme.skinTypographySans') },
                ]}
              />
            </EditorField>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              draft.colors.background,
              draft.colors.background1,
              draft.colors.background2,
              draft.colors.primaryButtonBackground,
              draft.colors.foreground,
            ].map((color) => (
              <span
                key={color}
                className="h-7 flex-1 rounded border border-black/10"
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>
        </section>

        <section className="grid gap-3 rounded-lg border border-border/70 bg-background-1 p-3">
          <div className="text-xs font-semibold text-foreground">
            {t('settings.theme.skinEditorComposition')}
          </div>
          <div className="grid gap-x-4 gap-y-3 @2xl:grid-cols-2">
            <RangeField
              label={t('settings.theme.skinPositionX')}
              value={skin.imageTreatment.positionX}
              min={0}
              max={100}
              suffix="%"
              onChange={(value) =>
                updateSkin((current) => ({
                  ...current,
                  imageTreatment: { ...current.imageTreatment, positionX: value },
                }))
              }
            />
            <RangeField
              label={t('settings.theme.skinPositionY')}
              value={skin.imageTreatment.positionY}
              min={0}
              max={100}
              suffix="%"
              onChange={(value) =>
                updateSkin((current) => ({
                  ...current,
                  imageTreatment: { ...current.imageTreatment, positionY: value },
                }))
              }
            />
            <RangeField
              label={t('settings.theme.skinZoom')}
              value={skin.imageTreatment.zoom}
              min={1}
              max={2.5}
              step={0.05}
              suffix="×"
              onChange={(value) =>
                updateSkin((current) => ({
                  ...current,
                  imageTreatment: { ...current.imageTreatment, zoom: value },
                }))
              }
            />
            <RangeField
              label={t('settings.theme.skinOverlay')}
              value={skin.imageTreatment.overlayStrength}
              min={0}
              max={0.85}
              step={0.01}
              format={(value) => `${Math.round(value * 100)}%`}
              onChange={(value) =>
                updateSkin((current) => ({
                  ...current,
                  imageTreatment: { ...current.imageTreatment, overlayStrength: value },
                }))
              }
            />
            <RangeField
              label={t('settings.theme.skinBlur')}
              value={skin.imageTreatment.blur}
              min={0}
              max={20}
              suffix="px"
              onChange={(value) =>
                updateSkin((current) => ({
                  ...current,
                  imageTreatment: { ...current.imageTreatment, blur: value },
                }))
              }
            />
            <RangeField
              label={t('settings.theme.skinArtOpacity')}
              value={skin.imageTreatment.artOpacity}
              min={0.25}
              max={1}
              step={0.01}
              format={(value) => `${Math.round(value * 100)}%`}
              onChange={(value) =>
                updateSkin((current) => ({
                  ...current,
                  imageTreatment: { ...current.imageTreatment, artOpacity: value },
                }))
              }
            />
          </div>
          <div className="grid gap-2 @2xl:grid-cols-3">
            <ToggleField
              label={t('settings.theme.skinTextRight')}
              checked={textOnRight}
              onCheckedChange={(checked) =>
                updateSkin((current) => ({
                  ...current,
                  imageTreatment: {
                    ...current.imageTreatment,
                    textSide: checked ? 'right' : 'left',
                  },
                }))
              }
            />
            <ToggleField
              label={t('settings.theme.skinOverlayCopy')}
              checked={skin.imageTreatment.showOverlayCopy}
              onCheckedChange={(checked) =>
                updateSkin((current) => ({
                  ...current,
                  imageTreatment: { ...current.imageTreatment, showOverlayCopy: checked },
                }))
              }
            />
            <ToggleField
              label={t('settings.theme.skinExtendWorkspace')}
              checked={skin.imageTreatment.extendToWorkspace}
              onCheckedChange={(checked) =>
                updateSkin((current) => ({
                  ...current,
                  imageTreatment: { ...current.imageTreatment, extendToWorkspace: checked },
                }))
              }
            />
          </div>
        </section>

        <section className="grid gap-3 rounded-lg border border-border/70 bg-background-1 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            {t('settings.theme.skinEditorDecorations')}
          </div>
          <div className="grid gap-3 @2xl:grid-cols-2">
            <EditorField label={t('settings.theme.skinDecoration')}>
              <NativeSelect
                value={skin.decorations.preset}
                onChange={(value) =>
                  updateSkin((current) => ({
                    ...current,
                    decorations: {
                      ...current.decorations,
                      preset: value as DreamSkinDecorationPreset,
                    },
                  }))
                }
                options={DECORATIONS.map((value) => ({
                  value,
                  label: t(`settings.theme.skinDecoration_${value}`),
                }))}
              />
            </EditorField>
            <RangeField
              label={t('settings.theme.skinDecorationDensity')}
              value={skin.decorations.density}
              min={0}
              max={1}
              step={0.01}
              format={(value) => `${Math.round(value * 100)}%`}
              onChange={(value) =>
                updateSkin((current) => ({
                  ...current,
                  decorations: { ...current.decorations, density: value },
                }))
              }
            />
          </div>
          <ToggleField
            label={t('settings.theme.skinDecorationMotion')}
            checked={skin.decorations.motion}
            onCheckedChange={(checked) =>
              updateSkin((current) => ({
                ...current,
                decorations: { ...current.decorations, motion: checked },
              }))
            }
          />
        </section>

        <section className="grid gap-3 rounded-lg border border-border/70 bg-background-1 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            {t('settings.theme.skinEditorRights')}
          </div>
          <Input
            value={skin.provenance?.sourceLabel ?? ''}
            maxLength={160}
            placeholder={t('settings.theme.skinSourcePlaceholder')}
            onChange={(event) =>
              updateSkin((current) => ({
                ...current,
                provenance: {
                  source: current.provenance?.source ?? 'local',
                  rightsConfirmed: current.provenance?.rightsConfirmed ?? false,
                  sourceLabel: event.target.value,
                },
              }))
            }
          />
          <ToggleField
            label={t('settings.theme.skinRightsConfirmed')}
            checked={skin.provenance?.rightsConfirmed ?? false}
            onCheckedChange={(checked) =>
              updateSkin((current) => ({
                ...current,
                provenance: {
                  source: current.provenance?.source ?? 'local',
                  sourceLabel: current.provenance?.sourceLabel,
                  rightsConfirmed: checked,
                },
              }))
            }
          />
        </section>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <ConfirmButton
          onClick={submit}
          disabled={!draft.name.trim() || !(skin.provenance?.rightsConfirmed ?? false)}
        >
          {t('settings.theme.saveAndApplySkin')}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}

function EditorField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1.5 text-[11px] text-foreground-muted">
      <span>{label}</span>
      {children}
    </label>
  );
}

function NativeSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-border-primary focus:ring-2 focus:ring-primary/30"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-1 text-[11px] text-foreground-muted">
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <code>{format ? format(value) : `${Number(value.toFixed(2))}${suffix}`}</code>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="accent-primary"
      />
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border/60 bg-background px-2.5 py-2 text-xs text-foreground-muted">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}
