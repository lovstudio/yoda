import { FlaskConical } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { LogoGenerationInput } from '@shared/ai-lab';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useGenerateLogo } from '../use-ai-lab';
import { LogoHistory } from './LogoHistory';
import { LogoStudio } from './LogoStudio';

export const AiLabView: React.FC = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const generateLogo = useGenerateLogo();

  const handleGenerate = (input: LogoGenerationInput) => {
    generateLogo.mutate(input, {
      onSuccess: (item) => {
        if (item.status === 'failed') {
          toast({
            title: t('aiLab.logo.failed'),
            description: item.error ?? undefined,
            variant: 'destructive',
          });
        }
      },
      onError: (error) => {
        toast({
          title: t('aiLab.logo.failed'),
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        });
      },
    });
  };

  return (
    <div className="@container flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-8">
          <header>
            <div className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-foreground-muted" />
              <h1 className="text-sm font-semibold">{t('aiLab.title')}</h1>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t('aiLab.subtitle')}
            </p>
          </header>

          <LogoStudio onGenerate={handleGenerate} isPending={generateLogo.isPending} />

          <LogoHistory
            pendingInput={generateLogo.isPending ? (generateLogo.variables ?? null) : null}
            onRerun={handleGenerate}
            rerunDisabled={generateLogo.isPending}
          />
        </div>
      </div>
    </div>
  );
};
