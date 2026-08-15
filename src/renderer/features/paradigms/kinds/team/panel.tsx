import { Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getRuntime } from '@shared/runtime-registry';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import type { ParadigmPanelProps } from '../../panel-context';

/**
 * The selected team's roster. The team itself is chosen in the picker list (each
 * team is its own row), so the panel only reports who will run and where the
 * roster is edited.
 *
 * A team's paradigm instance keeps the team's id — rooms reference it — so the
 * entry id resolves the roster directly.
 */
export function TeamParadigmPanel({ entry, teams }: ParadigmPanelProps) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const team = teams.find((candidate) => candidate.id === entry.id);

  return (
    <div className="flex flex-col gap-2">
      {team && (
        <div className="flex flex-col gap-0.5 border border-border/60 bg-background-1/40 p-2">
          {team.members.map((member) => (
            <div key={member.handle} className="flex items-center gap-2 px-1 py-1 text-xs">
              <span className="min-w-0 flex-1 truncate text-foreground">{member.displayName}</span>
              {member.role === 'leader' && (
                <span className="shrink-0 bg-primary/15 px-1.5 py-px text-[10px] text-primary">
                  {t('home.teamLeader')}
                </span>
              )}
              <span className="shrink-0 font-mono text-[10px] text-foreground-muted">
                {getRuntime(member.runtime)?.name ?? member.runtime}
              </span>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => navigate('library', { section: 'agentTeams' })}
        className="flex items-center gap-1.5 self-start rounded-md px-1 py-0.5 text-xs text-foreground-muted transition-colors hover:text-foreground"
      >
        <Settings2 className="size-3.5 shrink-0" />
        <span>{t('home.teamManageHint')}</span>
      </button>
    </div>
  );
}
