import type { PromptGroup as PersistedPromptGroup, Prompt } from '@shared/prompt-library';

export const UNGROUPED_PROMPT_GROUP = '';

export type PromptGroup = PersistedPromptGroup & {
  depth: number;
  prompts: Prompt[];
};

function normalizedGroups(
  prompts: Prompt[],
  persistedGroups: PersistedPromptGroup[]
): PersistedPromptGroup[] {
  const groups = new Map(
    persistedGroups.map((group) => [group.name.trim(), { ...group, name: group.name.trim() }])
  );
  const unknownNames = Array.from(
    new Set(prompts.map((prompt) => prompt.groupName.trim()).filter(Boolean))
  )
    .filter((name) => !groups.has(name))
    .sort((left, right) => left.localeCompare(right));
  for (const name of unknownNames) {
    groups.set(name, { name, parentName: null });
  }
  return Array.from(groups.values()).filter((group) => group.name.length > 0);
}

export function groupPrompts(
  prompts: Prompt[],
  persistedGroups: PersistedPromptGroup[] = []
): PromptGroup[] {
  const groups = normalizedGroups(prompts, persistedGroups);
  const knownNames = new Set(groups.map((group) => group.name));
  const children = new Map<string | null, PersistedPromptGroup[]>();
  for (const group of groups) {
    const parentName =
      group.parentName && knownNames.has(group.parentName) ? group.parentName : null;
    const siblings = children.get(parentName) ?? [];
    siblings.push({ ...group, parentName });
    children.set(parentName, siblings);
  }

  const promptsByGroup = new Map<string, Prompt[]>();
  for (const prompt of prompts) {
    const name = prompt.groupName.trim();
    const group = promptsByGroup.get(name) ?? [];
    group.push(prompt);
    promptsByGroup.set(name, group);
  }

  const result: PromptGroup[] = [];
  const visited = new Set<string>();
  const visit = (parentName: string | null, depth: number): void => {
    for (const group of children.get(parentName) ?? []) {
      if (visited.has(group.name)) continue;
      visited.add(group.name);
      result.push({
        ...group,
        depth,
        prompts: promptsByGroup.get(group.name) ?? [],
      });
      visit(group.name, depth + 1);
    }
  };
  visit(null, 0);
  for (const group of groups) {
    if (!visited.has(group.name)) {
      result.push({
        ...group,
        parentName: null,
        depth: 0,
        prompts: promptsByGroup.get(group.name) ?? [],
      });
    }
  }

  const ungroupedPrompts = promptsByGroup.get(UNGROUPED_PROMPT_GROUP) ?? [];
  if (ungroupedPrompts.length > 0) {
    result.push({
      name: UNGROUPED_PROMPT_GROUP,
      parentName: null,
      depth: 0,
      prompts: ungroupedPrompts,
    });
  }
  return result;
}

export function getNamedPromptGroups(
  prompts: Prompt[],
  persistedGroups: PersistedPromptGroup[] = []
): string[] {
  return groupPrompts(prompts, persistedGroups)
    .map((group) => group.name)
    .filter((name) => name !== UNGROUPED_PROMPT_GROUP);
}

export function getGroupDescendants(
  groups: PersistedPromptGroup[],
  groupName: string
): Set<string> {
  const descendants = new Set<string>();
  let added = true;
  while (added) {
    added = false;
    for (const group of groups) {
      if (
        group.parentName &&
        (group.parentName === groupName || descendants.has(group.parentName)) &&
        !descendants.has(group.name)
      ) {
        descendants.add(group.name);
        added = true;
      }
    }
  }
  return descendants;
}

export function getGroupPath(groups: PersistedPromptGroup[], groupName: string): string {
  const byName = new Map(groups.map((group) => [group.name, group]));
  const path: string[] = [];
  const visited = new Set<string>();
  let cursor: string | null = groupName;
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    path.unshift(cursor);
    cursor = byName.get(cursor)?.parentName ?? null;
  }
  return path.join(' / ');
}

export function getVisiblePromptGroups(
  groups: PromptGroup[],
  collapsedGroups: ReadonlySet<string>
): PromptGroup[] {
  const hiddenParents = new Set<string>();
  return groups.filter((group) => {
    if (group.name === UNGROUPED_PROMPT_GROUP) return true;
    const hidden = group.parentName !== null && hiddenParents.has(group.parentName);
    if (hidden || collapsedGroups.has(group.name)) hiddenParents.add(group.name);
    return !hidden;
  });
}

export function getInjectionOrderedPromptGroups(prompts: Prompt[]): PromptGroup[] {
  const orderedPrompts = prompts
    .slice()
    .sort((left, right) => left.injectionOrder - right.injectionOrder);
  const orderedGroups = Array.from(
    new Set(orderedPrompts.map((prompt) => prompt.groupName.trim()).filter(Boolean))
  ).map((name) => ({ name, parentName: null }));
  return groupPrompts(orderedPrompts, orderedGroups);
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
