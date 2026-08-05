import { z } from 'zod';

/**
 * Prompts have one canonical model. Grouping, sourced content and dynamic
 * injection are capabilities of a prompt instead of separate product nouns.
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

export const promptGroupNameSchema = z.string().trim().min(1).max(80);
export type PromptGroupName = z.infer<typeof promptGroupNameSchema>;

export const promptGroupSchema = z.object({
  name: promptGroupNameSchema,
  parentName: promptGroupNameSchema.nullable(),
});
export type PromptGroup = z.infer<typeof promptGroupSchema>;

export const promptSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  content: z.string(),
  groupName: z.string(),
  extraInfo: z.string(),
  injectionEnabled: z.boolean(),
  injectionOrder: z.number().int(),
  source: promptSourceSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Prompt = z.infer<typeof promptSchema>;

export const promptCreateInputSchema = z.object({
  title: z.string(),
  description: z.string().default(''),
  content: z.string(),
  groupName: z.string().default(''),
  extraInfo: z.string().default(''),
  injectionEnabled: z.boolean().default(false),
  source: promptSourceSchema.optional(),
});
export type PromptCreateInput = z.infer<typeof promptCreateInputSchema>;

export const promptUpdateInputSchema = z
  .object({
    title: z.string(),
    description: z.string(),
    content: z.string(),
    groupName: z.string(),
    extraInfo: z.string(),
    injectionEnabled: z.boolean(),
    source: promptSourceSchema.nullable(),
  })
  .partial();
export type PromptUpdateInput = z.infer<typeof promptUpdateInputSchema>;
