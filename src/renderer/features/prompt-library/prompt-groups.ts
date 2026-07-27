import type { Prompt } from '@shared/prompt-library';

export const UNGROUPED_PROMPT_GROUP = '';

export type PromptGroup = {
  name: string;
  prompts: Prompt[];
};

export type PromptGroupInjectionState = {
  state: 'all' | 'none' | 'partial';
  enabledCount: number;
  totalCount: number;
};

export function groupPrompts(prompts: Prompt[], persistedGroups: string[] = []): PromptGroup[] {
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
    return left.name.localeCompare(right.name);
  });
}

export function getNamedPromptGroups(prompts: Prompt[], persistedGroups: string[] = []): string[] {
  return groupPrompts(prompts, persistedGroups)
    .map((group) => group.name)
    .filter((name) => name !== UNGROUPED_PROMPT_GROUP);
}

export function getInjectionOrderedPromptGroups(prompts: Prompt[]): PromptGroup[] {
  return groupPrompts(
    prompts.slice().sort((left, right) => left.injectionOrder - right.injectionOrder)
  );
}

export function getPromptGroupInjectionState(
  prompts: Prompt[],
  isEnabled: (prompt: Prompt) => boolean
): PromptGroupInjectionState {
  const enabledCount = prompts.filter(isEnabled).length;
  return {
    enabledCount,
    totalCount: prompts.length,
    state: enabledCount === 0 ? 'none' : enabledCount === prompts.length ? 'all' : 'partial',
  };
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
