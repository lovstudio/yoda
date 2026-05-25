import { ArrowLeft, ArrowRight } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { getTaskView } from '@renderer/features/tasks/stores/task-selectors';
import { appState } from '@renderer/lib/stores/app-state';
import type { HistoryEntry } from '@renderer/lib/stores/navigation-history-store';
import { Button } from '@renderer/lib/ui/button';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

export function applyHistoryEntry(entry: HistoryEntry): void {
  if (entry.kind === 'view') {
    appState.navigation._applyNavigation(entry.viewId, entry.params);
  } else {
    appState.navigation._applyNavigation('task', {
      projectId: entry.projectId,
      taskId: entry.taskId,
    });
    getTaskView(entry.projectId, entry.taskId)?.tabManager.setActiveTab(entry.tabId);
  }
}

export const NavButtons = observer(function NavButtons() {
  const { t } = useTranslation();
  const { canGoBack, canGoForward } = appState.history;
  return (
    <div className="[-webkit-app-region:no-drag] flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="size-7 p-0"
              disabled={!canGoBack}
              onClick={() => appState.history.back(applyHistoryEntry)}
            />
          }
        >
          <ArrowLeft className="h-4 w-4" />
        </TooltipTrigger>
        <TooltipContent>
          {t('navigation.goBack')}
          <ShortcutHint settingsKey="navigateBack" />
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="size-7 p-0"
              disabled={!canGoForward}
              onClick={() => appState.history.forward(applyHistoryEntry)}
            />
          }
        >
          <ArrowRight className="h-4 w-4" />
        </TooltipTrigger>
        <TooltipContent>
          {t('navigation.goForward')}
          <ShortcutHint settingsKey="navigateForward" />
        </TooltipContent>
      </Tooltip>
    </div>
  );
});
