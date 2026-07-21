import { Compass, ExternalLink } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';

const EXTERNAL_SKILL_MARKETPLACES = [
  { name: 'Skills.sh', url: 'https://skills.sh' },
  { name: 'ClawHub', url: 'https://clawhub.ai/skills' },
  { name: 'SkillsMP', url: 'https://skillsmp.com' },
  { name: 'AgentSkill.sh', url: 'https://agentskill.sh' },
  { name: 'GitHub Topics', url: 'https://github.com/topics/agent-skills' },
] as const;

/** Secondary navigation to independent community catalogs outside Yoda. */
const ExternalSkillMarketplaces: React.FC = () => {
  const { t } = useTranslation();

  return (
    <section
      aria-labelledby="external-skill-marketplaces-title"
      className="mb-6 rounded-lg border border-border/70 bg-background-1/45 p-3"
    >
      <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-center @2xl:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background text-foreground-muted">
            <Compass className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="external-skill-marketplaces-title" className="text-sm font-medium">
              {t('skills.marketplaces.title')}
            </h2>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {t('skills.marketplaces.description')}
            </p>
          </div>
        </div>

        <nav
          aria-label={t('skills.marketplaces.ariaLabel')}
          className="flex shrink-0 flex-wrap gap-1.5 @2xl:justify-end"
        >
          {EXTERNAL_SKILL_MARKETPLACES.map((marketplace) => (
            <Button
              key={marketplace.url}
              variant="outline"
              size="xs"
              className="bg-background text-foreground-muted hover:text-foreground"
              onClick={() => void rpc.app.openExternal(marketplace.url)}
              aria-label={t('skills.marketplaces.open', { marketplace: marketplace.name })}
            >
              {marketplace.name}
              <ExternalLink className="size-3" aria-hidden="true" />
            </Button>
          ))}
        </nav>
      </div>
    </section>
  );
};

export default ExternalSkillMarketplaces;
