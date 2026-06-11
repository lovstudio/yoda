import { Info } from 'lucide-react';
import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';

const linkClassName =
  'font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground';

/** Info icon next to the skills title explaining where catalog skills come from. */
const SkillsCatalogHint: React.FC = () => {
  const { t } = useTranslation();

  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex shrink-0 cursor-help items-center text-muted-foreground transition-colors hover:text-foreground"
        aria-label={t('skills.catalogHintAria')}
      >
        <Info className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <p className="text-xs leading-relaxed text-muted-foreground">
          <Trans
            i18nKey="skills.catalogDescription"
            components={{
              openai: (
                <a
                  href="https://github.com/openai/skills"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClassName}
                />
              ),
              anthropic: (
                <a
                  href="https://github.com/anthropics/skills"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClassName}
                />
              ),
              standard: (
                <a
                  href="https://agentskills.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClassName}
                />
              ),
            }}
          />
        </p>
      </PopoverContent>
    </Popover>
  );
};

export default SkillsCatalogHint;
