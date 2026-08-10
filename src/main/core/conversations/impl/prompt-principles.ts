import type { ProjectPromptPrinciples } from '@shared/project-settings';
import { isPromptBoundToScope } from '@shared/prompt-library';
import { promptLibraryService } from '@main/core/prompt-library/prompt-library-service';

/**
 * Joins dynamically enabled library prompts and legacy project-local prompts
 * into the text appended after the runtime's system prompt at spawn.
 * The caller resolves the project layer (so this module stays free of the
 * project/db import chain); pass undefined to use the global layer only.
 * Returns undefined when nothing is enabled so callers can skip the flag.
 */
export async function getEnabledPromptPrinciplesText(
  projectPrinciples?: ProjectPromptPrinciples,
  projectId?: string
): Promise<string | undefined> {
  const globalItems = (await promptLibraryService.list()).sort(
    (left, right) => left.injectionOrder - right.injectionOrder
  );
  const overrides = projectPrinciples?.globalOverrides ?? {};
  const projectItems = projectPrinciples?.items ?? [];
  const scope = projectId ? 'project' : 'user';

  const texts: string[] = [];
  for (const item of globalItems.filter((prompt) =>
    isPromptBoundToScope(prompt, scope, projectId)
  )) {
    const enabled = overrides[item.id] ?? item.injectionEnabled;
    if (enabled && item.content.trim().length > 0) texts.push(item.content.trim());
  }
  for (const item of projectItems) {
    if (item.enabled && item.text.trim().length > 0) texts.push(item.text.trim());
  }

  if (texts.length === 0) return undefined;
  return texts.join('\n\n');
}
