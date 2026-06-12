import React from 'react';
import { useTranslation } from 'react-i18next';
import type { LogoGenerationInput } from '@shared/ai-lab';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useGenerateLogo } from '../use-ai-lab';
import { LogoHistory } from './LogoHistory';
import { LogoStudio } from './LogoStudio';

/** The Logo generator — the first app hosted in AI Lab. */
export const LogoStudioApp: React.FC = () => {
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
    <div className="space-y-8">
      <LogoStudio onGenerate={handleGenerate} isPending={generateLogo.isPending} />
      <LogoHistory
        pendingInput={generateLogo.isPending ? (generateLogo.variables ?? null) : null}
        onRerun={handleGenerate}
        rerunDisabled={generateLogo.isPending}
      />
    </div>
  );
};
