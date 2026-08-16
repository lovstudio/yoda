import { getProjectComposerDefaults } from '@main/core/projects/settings/composer-default-overrides';
import { appSettingsService } from '@main/core/settings/settings-service';

/**
 * Whether a summary may be generated without the user asking for one — the
 * post-turn refresh and the panel's live `recent` note.
 *
 * An explicit regenerate ignores this: the switch withholds unprompted CLI
 * runs, it does not make summaries unreachable. Read at the moment generation
 * would start, never cached, so toggling it takes effect on the next turn.
 */
export async function isAutoSessionSummaryEnabled(projectId?: string | null): Promise<boolean> {
  const [taskSettings, composerDefaults] = await Promise.all([
    appSettingsService.get('tasks'),
    getProjectComposerDefaults(projectId),
  ]);
  return composerDefaults?.autoGenerateSummary ?? taskSettings.autoGenerateSummary;
}
