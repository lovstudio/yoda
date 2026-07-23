import { Compass, ExternalLink, MoreHorizontal } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { rpc } from '@renderer/lib/ipc';
import { SplitButton, type SplitButtonAction } from '@renderer/lib/ui/split-button';

const EXTERNAL_SKILL_MARKETPLACES = [
  { value: 'clawhub', name: 'ClawHub', url: 'https://clawhub.ai/skills' },
  { value: 'skills-sh', name: 'Skills.sh', url: 'https://skills.sh' },
  { value: 'skillsmp', name: 'SkillsMP', url: 'https://skillsmp.com' },
  { value: 'agentskill-sh', name: 'AgentSkill.sh', url: 'https://agentskill.sh' },
  {
    value: 'github-topics',
    name: 'GitHub Topics',
    url: 'https://github.com/topics/agent-skills',
  },
] as const;

/** Secondary navigation to independent community catalogs outside Yoda. */
const ExternalSkillMarketplaces: React.FC = () => {
  const { t } = useTranslation();
  const marketplaceActions: SplitButtonAction[] = EXTERNAL_SKILL_MARKETPLACES.map(
    (marketplace) => ({
      value: marketplace.value,
      label: marketplace.name,
      action: () => void rpc.app.openExternal(marketplace.url),
    })
  );

  return (
    <section
      aria-labelledby="external-skill-marketplaces-title"
      className="mb-4 flex flex-col gap-3 rounded-lg border border-border/70 bg-background-1/45 p-3 @xl:flex-row @xl:items-center @xl:justify-between"
    >
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

      <SplitButton
        actions={marketplaceActions}
        defaultValue="clawhub"
        variant="outline"
        size="sm"
        className="w-full shrink-0 @xl:w-40"
        dropdownContentClassName="w-64"
        icon={<ExternalLink className="size-3.5" aria-hidden="true" />}
        dropdownIcon={<MoreHorizontal className="size-3.5" aria-hidden="true" />}
        dropdownAriaLabel={t('skills.marketplaces.menuAria')}
      />
    </section>
  );
};

export default ExternalSkillMarketplaces;
