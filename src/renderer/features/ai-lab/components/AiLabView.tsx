import { ArrowLeft, FlaskConical, Plus } from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/lib/ui/button';
import { AI_LAB_APPS, type AiLabAppDefinition } from '../app-registry';

/**
 * AI Lab — the in-app hub for vibe-coded mini-apps. The landing view is an
 * app-store-style launcher grid; clicking a tile opens that app full-page
 * with a back affordance. Apps register in `app-registry.tsx`.
 */
export const AiLabView: React.FC = () => {
  const [activeAppId, setActiveAppId] = useState<string | null>(null);
  const activeApp = AI_LAB_APPS.find((app) => app.id === activeAppId) ?? null;

  return (
    <div className="@container flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
          {activeApp ? (
            <AppHost app={activeApp} onBack={() => setActiveAppId(null)} />
          ) : (
            <Launcher onOpen={(app) => setActiveAppId(app.id)} />
          )}
        </div>
      </div>
    </div>
  );
};

const Launcher: React.FC<{ onOpen: (app: AiLabAppDefinition) => void }> = ({ onOpen }) => {
  const { t } = useTranslation();
  return (
    <>
      <header>
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-foreground-muted" />
          <h1 className="text-sm font-semibold">{t('aiLab.title')}</h1>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('aiLab.subtitle')}</p>
      </header>

      <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
        {AI_LAB_APPS.map((app) => (
          <button
            key={app.id}
            type="button"
            onClick={() => onOpen(app)}
            className="group flex items-start gap-3 rounded-xl border border-border bg-background-secondary p-4 text-left transition-colors hover:border-accent"
          >
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${app.iconClassName}`}
            >
              <app.icon className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{t(`aiLab.apps.${app.id}.name`)}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                {t(`aiLab.apps.${app.id}.description`)}
              </span>
            </span>
          </button>
        ))}

        {/* The hub is meant to grow — invite the next vibe-coded app. */}
        <div className="flex items-start gap-3 rounded-xl border border-dashed border-border p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Plus className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-muted-foreground">
              {t('aiLab.comingSoonTitle')}
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
              {t('aiLab.comingSoonDescription')}
            </span>
          </span>
        </div>
      </div>
    </>
  );
};

const AppHost: React.FC<{ app: AiLabAppDefinition; onBack: () => void }> = ({ app, onBack }) => {
  const { t } = useTranslation();
  return (
    <>
      <header className="flex items-start gap-2">
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={t('aiLab.back')}
          title={t('aiLab.back')}
          onClick={onBack}
          className="mt-0.5 shrink-0"
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold">{t(`aiLab.apps.${app.id}.name`)}</h1>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {t(`aiLab.apps.${app.id}.description`)}
          </p>
        </div>
      </header>
      <app.Component />
    </>
  );
};
