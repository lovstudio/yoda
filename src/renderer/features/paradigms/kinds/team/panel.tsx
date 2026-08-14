import { Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FEATURE_WORKFLOW_STAGES, hasFeatureWorkflowContract } from '@shared/feature-workflow';
import { getRuntime } from '@shared/runtime-registry';
import { FeatureWorkflowPreview } from '@renderer/features/agent-room/feature-workflow-rail';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import type { ParadigmPanelProps } from '../../panel-context';

/**
 * The selected team's roster. The team itself is chosen in the picker sidebar
 * (each team is its own entry), so the panel only reports who will run and where
 * the roster is edited.
 */
export function TeamParadigmPanel({ entry, teams }: ParadigmPanelProps) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const team = teams.find((candidate) => candidate.id === entry.teamId);
  const isFeatureWorkflow = Boolean(team && hasFeatureWorkflowContract(team));

  return (
    <div className="flex flex-col gap-2">
      {team && (
        <>
          {isFeatureWorkflow && <FeatureWorkflowPreview />}
          <div className="flex flex-col gap-0.5 border border-border/60 bg-background-1/40 p-2">
            {team.members.map((member) => {
              const featureStage = isFeatureWorkflow
                ? FEATURE_WORKFLOW_STAGES.find((stage) => stage.handle === member.handle)
                : undefined;
              return (
                <div key={member.handle} className="flex items-center gap-2 px-1 py-1 text-xs">
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {featureStage
                      ? t(`featureWorkflow.stages.${featureStage.id}.title`)
                      : member.displayName}
                  </span>
                  {member.role === 'leader' && (
                    <span className="shrink-0 bg-primary/15 px-1.5 py-px text-[10px] text-primary">
                      {t('home.teamLeader')}
                    </span>
                  )}
                  <span className="shrink-0 font-mono text-[10px] text-foreground-muted">
                    {getRuntime(member.runtime)?.name ?? member.runtime}
                  </span>
                </div>
              );
            })}
          </div>
        </>
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
