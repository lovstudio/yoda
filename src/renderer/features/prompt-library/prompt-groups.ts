import type { Prompt } from '@shared/prompt-library';

export const UNGROUPED_PROMPT_GROUP = '';

export type PromptGroup = {
  name: string;
  prompts: Prompt[];
};

export function groupPrompts(prompts: Prompt[], persistedGroups: string[] = []): PromptGroup[] {
  const persistedGroupOrder = new Map(
    persistedGroups
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name, index) => [name, index])
  );
  const promptsByGroup = new Map<string, Prompt[]>(
    persistedGroups
      .map((name): [string, Prompt[]] => [name.trim(), []])
      .filter(([name]) => name.length > 0)
  );

  for (const prompt of prompts) {
    const groupName = prompt.groupName.trim();
    const group = promptsByGroup.get(groupName);
    if (group) group.push(prompt);
    else promptsByGroup.set(groupName, [prompt]);
  }

  return Array.from(promptsByGroup, ([name, groupItems]) => ({
    name,
    prompts: groupItems,
  })).sort((left, right) => {
    if (left.name === UNGROUPED_PROMPT_GROUP) return 1;
    if (right.name === UNGROUPED_PROMPT_GROUP) return -1;
    const leftOrder = persistedGroupOrder.get(left.name);
    const rightOrder = persistedGroupOrder.get(right.name);
    if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder;
    if (leftOrder !== undefined) return -1;
    if (rightOrder !== undefined) return 1;
    return left.name.localeCompare(right.name);
  });
}

export function getNamedPromptGroups(prompts: Prompt[], persistedGroups: string[] = []): string[] {
  return groupPrompts(prompts, persistedGroups)
    .map((group) => group.name)
    .filter((name) => name !== UNGROUPED_PROMPT_GROUP);
}

export function getInjectionOrderedPromptGroups(prompts: Prompt[]): PromptGroup[] {
  const orderedPrompts = prompts
    .slice()
    .sort((left, right) => left.injectionOrder - right.injectionOrder);
  const orderedGroupNames = Array.from(
    new Set(orderedPrompts.map((prompt) => prompt.groupName.trim()).filter(Boolean))
  );
  return groupPrompts(orderedPrompts, orderedGroupNames);
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
