import type { Prompt } from '@shared/prompt-library';

type PromptPayload = Omit<Prompt, 'tags'> & {
  tags?: unknown;
};

/**
 * Keep the renderer compatible with prompts returned by an older main process
 * during upgrades or renderer hot reloads. The current wire contract includes
 * tags, but old cached/query data can still omit the field.
 */
export function normalizePromptList(prompts: readonly PromptPayload[]): Prompt[] {
  return prompts.map((prompt) => ({
    ...prompt,
    tags: Array.isArray(prompt.tags)
      ? prompt.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
  }));
}

export function collectPromptTags(prompts: Prompt[]): string[] {
  return Array.from(new Set(prompts.flatMap((prompt) => prompt.tags))).sort((left, right) =>
    left.localeCompare(right)
  );
}

export function filterPrompts(
  prompts: Prompt[],
  options: { query?: string; tag?: string; status?: 'all' | 'enabled' | 'disabled' }
): Prompt[] {
  const query = options.query?.trim().toLocaleLowerCase() ?? '';
  return prompts.filter((prompt) => {
    if (options.tag && !prompt.tags.includes(options.tag)) return false;
    if (options.status === 'enabled' && !prompt.injectionEnabled) return false;
    if (options.status === 'disabled' && prompt.injectionEnabled) return false;
    if (!query) return true;
    return [prompt.title, prompt.description, prompt.content, ...prompt.tags].some((value) =>
      value.toLocaleLowerCase().includes(query)
    );
  });
}

export function reorderPromptIds(ids: string[], activeId: string, overId: string): string[] {
  const fromIndex = ids.indexOf(activeId);
  const toIndex = ids.indexOf(overId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return ids;
  const next = ids.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/** Reorders the visible subset while leaving hidden prompts in their slots. */
export function reorderPromptIdsInVisibleList(
  allIds: string[],
  visibleIds: string[],
  activeId: string,
  overId: string
): string[] {
  const reorderedVisibleIds = reorderPromptIds(visibleIds, activeId, overId);
  if (reorderedVisibleIds === visibleIds) return allIds;
  const visible = new Set(visibleIds);
  let visibleIndex = 0;
  return allIds.map((id) => {
    if (!visible.has(id)) return id;
    const next = reorderedVisibleIds[visibleIndex];
    visibleIndex += 1;
    return next ?? id;
  });
}
