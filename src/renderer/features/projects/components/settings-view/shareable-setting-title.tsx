import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  ProjectSettingsOverrideState,
  ShareableProjectSettingsWriteField,
} from '@shared/project-settings';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { FieldTitle } from '@renderer/lib/ui/field';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';

type Props = {
  children: React.ReactNode;
  leafLabel: string;
  overrideSources: ProjectSettingsOverrideState[ShareableProjectSettingsWriteField];
  onRestore: () => void;
};

export function ShareableSettingTitle({ children, leafLabel, overrideSources, onRestore }: Props) {
  const { t } = useTranslation();
  const overrideWorkingDirectoryCount = t('projects.settings.workingDirectoryCount', {
    count: overrideSources.length,
  });
  const teamConfigLabel = t('projects.settings.teamSettings');

  return (
    <div className="flex min-h-5 items-center justify-between gap-3">
      <FieldTitle className="min-w-0 flex-1">{children}</FieldTitle>
      {overrideSources.length > 0 ? (
        <div className="flex h-4.5 shrink-0 items-center gap-1.5">
          <TooltipProvider delay={150}>
            <Tooltip>
              <TooltipTrigger className="inline-flex h-4.5 items-center">
                <Badge
                  variant="outline"
                  className="rounded-xs h-4.5 border-amber-200 bg-amber-50 leading-none text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
                >
                  {t('projects.settings.overriding')}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top" align="start" className="max-w-sm">
                {t('projects.settings.overridesTooltip', {
                  teamSettings: teamConfigLabel,
                  count: overrideWorkingDirectoryCount,
                })}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                className="inline-flex h-4.5 items-center"
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="size-4.5 rounded-full p-0 text-muted-foreground hover:text-foreground"
                    aria-label={t('projects.settings.useTeamSettingsFor', { label: leafLabel })}
                    onClick={onRestore}
                  >
                    <RotateCcw className="size-3" aria-hidden="true" />
                  </Button>
                }
              />
              <TooltipContent side="top" align="end">
                {t('projects.settings.useTeamSettings')}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      ) : null}
    </div>
  );
}
