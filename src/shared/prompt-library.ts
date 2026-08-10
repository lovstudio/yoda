import { z } from 'zod';

/**
 * Prompts have one canonical flat model. Human-facing tags, sourced content,
 * and dynamic injection are capabilities of a prompt instead of separate
 * product nouns.
 */
export const promptSourceErrorCodeSchema = z.enum([
  'empty_content',
  'file_read_failed',
  'git_clone_failed',
  'git_file_not_found',
  'http_error',
  'invalid_git_path',
  'invalid_url',
  'request_failed',
  'request_timeout',
  'source_not_found',
  'too_large',
  'unsupported_url',
]);

export type PromptSourceErrorCode = z.infer<typeof promptSourceErrorCodeSchema>;

export const promptSourceErrorSchema = z.object({
  code: promptSourceErrorCodeSchema,
  detail: z.string().optional(),
});

export type PromptSourceError = z.infer<typeof promptSourceErrorSchema>;

export const PROMPT_SOURCE_DEFAULT_REFRESH_MINUTES = 60;
export const PROMPT_SOURCE_MIN_REFRESH_MINUTES = 1;
export const PROMPT_SOURCE_MAX_REFRESH_MINUTES = 43_200;
export const PROMPT_SOURCE_DEFAULT_TIMEOUT_SECONDS = 10;
export const PROMPT_SOURCE_MIN_TIMEOUT_SECONDS = 1;
export const PROMPT_SOURCE_MAX_TIMEOUT_SECONDS = 120;

const promptSourceStatusSchema = z.object({
  lastAttemptedAt: z.string().datetime().optional(),
  lastSyncedAt: z.string().datetime().optional(),
  lastError: promptSourceErrorSchema.optional(),
});

export const promptSourceSchema = z.discriminatedUnion('type', [
  promptSourceStatusSchema.extend({
    type: z.literal('file'),
    path: z.string().min(1),
  }),
  promptSourceStatusSchema.extend({
    type: z.literal('url'),
    url: z.string(),
    refreshIntervalMinutes: z
      .number()
      .int()
      .min(PROMPT_SOURCE_MIN_REFRESH_MINUTES)
      .max(PROMPT_SOURCE_MAX_REFRESH_MINUTES),
    timeoutSeconds: z
      .number()
      .int()
      .min(PROMPT_SOURCE_MIN_TIMEOUT_SECONDS)
      .max(PROMPT_SOURCE_MAX_TIMEOUT_SECONDS),
  }),
  promptSourceStatusSchema.extend({
    type: z.literal('git'),
    repositoryUrl: z.string(),
    filePath: z.string().min(1),
    ref: z.string().optional(),
    refreshIntervalMinutes: z
      .number()
      .int()
      .min(PROMPT_SOURCE_MIN_REFRESH_MINUTES)
      .max(PROMPT_SOURCE_MAX_REFRESH_MINUTES),
    timeoutSeconds: z
      .number()
      .int()
      .min(PROMPT_SOURCE_MIN_TIMEOUT_SECONDS)
      .max(PROMPT_SOURCE_MAX_TIMEOUT_SECONDS),
  }),
]);

export type PromptSource = z.infer<typeof promptSourceSchema>;

export type PromptSourceLoadResult =
  | { status: 'cancelled' }
  | { status: 'error'; error: PromptSourceError }
  | {
      status: 'success';
      name: string;
      source: PromptSource;
      text: string;
    };

export type PromptSourceRefreshResult =
  | { status: 'error'; error: PromptSourceError }
  | {
      status: 'success';
      source: PromptSource;
      text: string;
    };

export const promptTagSchema = z.string().trim().min(1).max(80);
export const promptTagsSchema = z.array(promptTagSchema).max(32);
export type PromptTag = z.infer<typeof promptTagSchema>;

/**
 * Tags are metadata for people using the library. They are never included in
 * the text sent to an agent; only `content` participates in injection.
 */
export function normalizePromptTags(tags: readonly string[]): PromptTag[] {
  const unique = new Set<string>();
  for (const value of tags) {
    const tag = value.trim();
    if (tag) unique.add(tag);
  }
  return promptTagsSchema.parse(Array.from(unique));
}

export const promptVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
export type PromptVersionNumber = z.infer<typeof promptVersionSchema>;

export const promptVersionBumpSchema = z.enum(['patch', 'minor', 'major']);
export type PromptVersionBump = z.infer<typeof promptVersionBumpSchema>;

export function incrementPromptVersion(
  version: PromptVersionNumber,
  bump: PromptVersionBump
): PromptVersionNumber {
  const parsed = promptVersionSchema.parse(version);
  const [major, minor, patch] = parsed.split('.').map(Number) as [number, number, number];
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** Where a prompt is allowed to participate in runtime injection. */
export const promptBindingsSchema = z.object({
  global: z.boolean().default(true),
  projectIds: z.array(z.string().min(1)).max(128).default([]),
});
export type PromptBindings = z.infer<typeof promptBindingsSchema>;

export const promptSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  content: z.string(),
  tags: promptTagsSchema,
  extraInfo: z.string(),
  injectionEnabled: z.boolean(),
  injectionOrder: z.number().int(),
  bindings: promptBindingsSchema,
  version: promptVersionSchema,
  source: promptSourceSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Prompt = z.infer<typeof promptSchema>;

export type PromptInjectionScope = 'user' | 'project';

/** A global prompt applies to every project; project bindings are opt-in. */
export function isPromptBoundToScope(
  prompt: Pick<Prompt, 'bindings'>,
  scope: PromptInjectionScope,
  projectId?: string | null
): boolean {
  if (scope === 'user') return prompt.bindings.global;
  return (
    prompt.bindings.global || Boolean(projectId && prompt.bindings.projectIds.includes(projectId))
  );
}

export const promptVersionSnapshotSchema = z.object({
  id: z.string(),
  promptId: z.string(),
  version: promptVersionSchema,
  title: z.string(),
  description: z.string(),
  content: z.string(),
  extraInfo: z.string(),
  source: promptSourceSchema.optional(),
  createdAt: z.string(),
});
export type PromptVersionSnapshot = z.infer<typeof promptVersionSnapshotSchema>;

export const promptCreateInputSchema = z.object({
  title: z.string(),
  description: z.string().default(''),
  content: z.string(),
  tags: promptTagsSchema.default([]),
  extraInfo: z.string().default(''),
  injectionEnabled: z.boolean().default(false),
  bindings: promptBindingsSchema.default({ global: true, projectIds: [] }),
  source: promptSourceSchema.optional(),
});
export type PromptCreateInput = z.input<typeof promptCreateInputSchema>;

export const promptUpdateInputSchema = z
  .object({
    title: z.string(),
    description: z.string(),
    content: z.string(),
    tags: promptTagsSchema,
    extraInfo: z.string(),
    injectionEnabled: z.boolean(),
    bindings: promptBindingsSchema,
    source: promptSourceSchema.nullable(),
    versionBump: promptVersionBumpSchema,
  })
  .partial();
export type PromptUpdateInput = z.input<typeof promptUpdateInputSchema>;
