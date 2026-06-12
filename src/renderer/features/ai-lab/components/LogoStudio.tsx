import { Plug, Sparkles, TerminalSquare } from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AI_LAB_DEFAULT_ZENMUX_MODEL,
  AI_LAB_ZENMUX_MODELS,
  LOGO_STYLE_IDS,
  type AiLabEngineId,
  type AiLabEngineStatus,
  type AiLabZenmuxModel,
  type LogoGenerationInput,
  type LogoStyleId,
} from '@shared/ai-lab';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import { Spinner } from '@renderer/lib/ui/spinner';
import { Textarea } from '@renderer/lib/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { useAiLabEngines } from '../use-ai-lab';

const ENGINE_STORAGE_KEY = 'yoda.aiLab.engine';

const ZENMUX_MODEL_LABELS: Record<AiLabZenmuxModel, string> = {
  'google/gemini-3-pro-image-preview': 'Nano Banana Pro',
  'openai/gpt-image-2': 'GPT Image 2',
};

const COUNT_OPTIONS: Record<AiLabEngineId, number[]> = {
  zenmux: [1, 2, 4],
  codex: [1, 2],
};

function loadStoredEngine(): AiLabEngineId | null {
  const stored = localStorage.getItem(ENGINE_STORAGE_KEY);
  return stored === 'zenmux' || stored === 'codex' ? stored : null;
}

export const LogoStudio: React.FC<{
  onGenerate: (input: LogoGenerationInput) => void;
  isPending: boolean;
}> = ({ onGenerate, isPending }) => {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const { data: engines } = useAiLabEngines();

  const [brandName, setBrandName] = useState('');
  const [description, setDescription] = useState('');
  const [styleId, setStyleId] = useState<LogoStyleId>('minimal');
  // null = no explicit pick yet: seamlessly follow whichever engine is
  // actually usable on this machine instead of forcing a setup step.
  const [pickedEngine, setPickedEngine] = useState<AiLabEngineId | null>(loadStoredEngine);
  const [model, setModel] = useState<AiLabZenmuxModel>(AI_LAB_DEFAULT_ZENMUX_MODEL);
  const [rawCount, setRawCount] = useState(4);

  const engine: AiLabEngineId =
    pickedEngine ?? engines?.find((status) => status.available)?.id ?? 'zenmux';
  const count = clampCount(rawCount, engine);
  const selectedStatus: AiLabEngineStatus | undefined = engines?.find(
    (status) => status.id === engine
  );

  const handlePickEngine = (next: AiLabEngineId) => {
    setPickedEngine(next);
    localStorage.setItem(ENGINE_STORAGE_KEY, next);
  };

  const canGenerate =
    brandName.trim().length > 0 && selectedStatus?.available === true && !isPending;

  const handleSubmit = () => {
    if (!canGenerate) return;
    onGenerate({
      brandName: brandName.trim(),
      description: description.trim(),
      styleId,
      engine,
      model: engine === 'zenmux' ? model : undefined,
      count,
    });
  };

  return (
    <section className="rounded-xl border border-border bg-background-secondary p-5">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ai-lab-brand-name">{t('aiLab.logo.brandName')}</Label>
          <Input
            id="ai-lab-brand-name"
            value={brandName}
            onChange={(event) => setBrandName(event.target.value)}
            placeholder={t('aiLab.logo.brandNamePlaceholder')}
            maxLength={80}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ai-lab-description">{t('aiLab.logo.description')}</Label>
          <Textarea
            id="ai-lab-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t('aiLab.logo.descriptionPlaceholder')}
            rows={2}
            maxLength={400}
          />
        </div>

        <div className="space-y-1.5">
          <Label>{t('aiLab.logo.style')}</Label>
          <div className="flex flex-wrap gap-1.5">
            {LOGO_STYLE_IDS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setStyleId(id)}
                className={
                  styleId === id
                    ? 'rounded-full border border-accent bg-accent/10 px-3 py-1 text-xs font-medium text-accent'
                    : 'rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                }
              >
                {t(`aiLab.logo.styles.${id}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <div className="space-y-1.5">
            <Label>{t('aiLab.logo.engine')}</Label>
            <ToggleGroup
              multiple={false}
              value={[engine]}
              onValueChange={([value]) => {
                if (value) handlePickEngine(value as AiLabEngineId);
              }}
            >
              <ToggleGroupItem value="zenmux" className="gap-1.5">
                <Plug className="h-3.5 w-3.5" />
                {t('aiLab.logo.engineZenmux')}
              </ToggleGroupItem>
              <ToggleGroupItem value="codex" className="gap-1.5">
                <TerminalSquare className="h-3.5 w-3.5" />
                {t('aiLab.logo.engineCodex')}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {engine === 'zenmux' && (
            <div className="space-y-1.5">
              <Label>{t('aiLab.logo.model')}</Label>
              <ToggleGroup
                multiple={false}
                value={[model]}
                onValueChange={([value]) => {
                  if (value) setModel(value as AiLabZenmuxModel);
                }}
              >
                {AI_LAB_ZENMUX_MODELS.map((id) => (
                  <ToggleGroupItem key={id} value={id}>
                    {ZENMUX_MODEL_LABELS[id]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>{t('aiLab.logo.count')}</Label>
            <ToggleGroup
              multiple={false}
              value={[String(count)]}
              onValueChange={([value]) => {
                if (value) setRawCount(Number(value));
              }}
            >
              {COUNT_OPTIONS[engine].map((option) => (
                <ToggleGroupItem key={option} value={String(option)} className="min-w-8">
                  {option}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>

        {selectedStatus && !selectedStatus.available && (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
            <span>
              {engine === 'zenmux'
                ? t('aiLab.logo.engineUnavailableZenmux')
                : t('aiLab.logo.engineUnavailableCodex')}
            </span>
            {engine === 'zenmux' && (
              <Button size="xs" variant="outline" onClick={() => navigate('maas')}>
                {t('aiLab.logo.connectZenmux')}
              </Button>
            )}
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button onClick={handleSubmit} disabled={!canGenerate}>
            {isPending ? <Spinner className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            {isPending ? t('aiLab.logo.generating') : t('aiLab.logo.generate')}
          </Button>
          {isPending && engine === 'codex' && (
            <span className="text-xs text-muted-foreground">
              {t('aiLab.logo.generatingCodexHint')}
            </span>
          )}
        </div>
      </div>
    </section>
  );
};

function clampCount(current: number, engine: AiLabEngineId): number {
  const options = COUNT_OPTIONS[engine];
  return options.includes(current) ? current : options[options.length - 1]!;
}
