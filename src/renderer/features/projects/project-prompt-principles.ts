import type { ProjectPromptPrinciples, PromptPrinciple } from '@shared/project-settings';

/**
 * Pure helpers shared by every surface that edits a project's prompt-principle
 * layer (settings page + composer popover), so the resolve/write rules stay
 * identical across them. The stored value is kept minimal — `undefined` once a
 * project carries no overrides and no local items — so dirty-detection and the
 * `.yoda.json` share summary don't see empty noise.
 */

/** Whether a global principle is enabled for this project (override ?? global default). */
export function effectiveGlobalEnabled(
  project: ProjectPromptPrinciples | undefined,
  principle: Pick<PromptPrinciple, 'id' | 'enabled'>
): boolean {
  return project?.globalOverrides?.[principle.id] ?? principle.enabled;
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

/** Flip a global principle on/off for this project; clears the override when it matches the global default. */
export function setGlobalOverride(
  project: ProjectPromptPrinciples | undefined,
  principle: Pick<PromptPrinciple, 'id' | 'enabled'>,
  enabled: boolean
): ProjectPromptPrinciples | undefined {
  const overrides = { ...(project?.globalOverrides ?? {}) };
  if (enabled === principle.enabled) {
    delete overrides[principle.id];
  } else {
    overrides[principle.id] = enabled;
  }
  return normalize({ globalOverrides: overrides, items: project?.items });
}

/** Replace the project-local principle list. */
export function setProjectItems(
  project: ProjectPromptPrinciples | undefined,
  items: PromptPrinciple[]
): ProjectPromptPrinciples | undefined {
  return normalize({ globalOverrides: project?.globalOverrides, items });
}
