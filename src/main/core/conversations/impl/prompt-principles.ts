import type { ProjectPromptPrinciples } from '@shared/project-settings';
import { appSettingsService } from '@main/core/settings/settings-service';

/**
 * Joins the enabled prompt principles into the text appended after the
 * runtime's system prompt at spawn. Two layers stack:
 *  - app-global principles (Settings → Prompts), each of which a project may
 *    flip on/off via its `globalOverrides`;
 *  - project-local principles (`projectPrinciples.items`), appended after.
 * The caller resolves the project layer (so this module stays free of the
 * project/db import chain); pass undefined to use the global layer only.
 * Returns undefined when nothing is enabled so callers can skip the flag.
 */
export async function getEnabledPromptPrinciplesText(
  projectPrinciples?: ProjectPromptPrinciples
): Promise<string | undefined> {
  const { items: globalItems } = await appSettingsService.get('promptPrinciples');
  const overrides = projectPrinciples?.globalOverrides ?? {};
  const projectItems = projectPrinciples?.items ?? [];

  const texts: string[] = [];
  for (const item of globalItems) {
    const enabled = overrides[item.id] ?? item.enabled;
    if (enabled && item.text.trim().length > 0) texts.push(item.text.trim());
  }
  for (const item of projectItems) {
    if (item.enabled && item.text.trim().length > 0) texts.push(item.text.trim());
  }

  if (texts.length === 0) return undefined;
  return texts.join('\n\n');
}
