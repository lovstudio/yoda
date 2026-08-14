import { promptBindingsSchema, type Prompt, type PromptBindings } from '@shared/prompt-library';

type PromptPayload = Omit<Prompt, 'tags' | 'bindings'> & {
  tags?: unknown;
  bindings?: unknown;
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
    bindings: normalizePromptBindings(prompt.bindings),
  }));
}

function normalizePromptBindings(value: unknown): PromptBindings {
  const parsed = promptBindingsSchema.safeParse(value);
  return parsed.success ? parsed.data : promptBindingsSchema.parse({});
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
