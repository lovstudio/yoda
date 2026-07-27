import type { ProjectPromptPrinciples, PromptPrinciple } from '@shared/project-settings';
import type { Prompt } from '@shared/prompt-library';

/**
 * Pure helpers shared by every surface that edits a project's prompt-injection
 * layer (settings page + composer popover), so the resolve/write rules stay
 * identical across them. The stored value is kept minimal — `undefined` once a
 * project carries no overrides and no local items — so dirty-detection and the
 * `.yoda.json` share summary don't see empty noise.
 */

/** Whether a library prompt is injected for this project (override ?? global default). */
export function effectiveGlobalEnabled(
  project: ProjectPromptPrinciples | undefined,
  prompt: Pick<Prompt, 'id' | 'injectionEnabled'>
): boolean {
  return project?.globalOverrides?.[prompt.id] ?? prompt.injectionEnabled;
}

function normalize(next: ProjectPromptPrinciples): ProjectPromptPrinciples | undefined {
  const overrides =
    next.globalOverrides && Object.keys(next.globalOverrides).length > 0
      ? next.globalOverrides
      : undefined;
  const items = next.items && next.items.length > 0 ? next.items : undefined;
  if (!overrides && !items) return undefined;
  return { globalOverrides: overrides, items };
}

/** Toggle a library prompt for this project; clear overrides matching the global default. */
export function setGlobalOverride(
  project: ProjectPromptPrinciples | undefined,
  prompt: Pick<Prompt, 'id' | 'injectionEnabled'>,
  enabled: boolean
): ProjectPromptPrinciples | undefined {
  const overrides = { ...(project?.globalOverrides ?? {}) };
  if (enabled === prompt.injectionEnabled) {
    delete overrides[prompt.id];
  } else {
    overrides[prompt.id] = enabled;
  }
  return normalize({ globalOverrides: overrides, items: project?.items });
}

/** Replace the legacy project-local prompt list. */
export function setProjectItems(
  project: ProjectPromptPrinciples | undefined,
  items: PromptPrinciple[]
): ProjectPromptPrinciples | undefined {
  return normalize({ globalOverrides: project?.globalOverrides, items });
}
