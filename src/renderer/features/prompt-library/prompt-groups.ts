import type { Prompt } from '@shared/prompt-library';

export const UNGROUPED_PROMPT_GROUP = '';

export type PromptGroup = {
  name: string;
  prompts: Prompt[];
};

export function groupPrompts(prompts: Prompt[]): PromptGroup[] {
  const promptsByGroup = new Map<string, Prompt[]>();

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

export function getNamedPromptGroups(prompts: Prompt[]): string[] {
  return groupPrompts(prompts)
    .map((group) => group.name)
    .filter((name) => name !== UNGROUPED_PROMPT_GROUP);
}
