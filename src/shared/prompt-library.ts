import { z } from 'zod';

/**
 * A reusable prompt saved by the user. Lives in the Library surface and is
 * selectable when composing a new task. This is distinct from the system
 * `promptPrinciples` in settings (always-on rules injected into every session);
 * a Prompt here is an opt-in, copy-as-you-go template.
 */
export const promptSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  content: z.string(),
  groupName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Prompt = z.infer<typeof promptSchema>;

export const promptCreateInputSchema = z.object({
  title: z.string(),
  description: z.string().default(''),
  content: z.string(),
  groupName: z.string().default(''),
});
export type PromptCreateInput = z.infer<typeof promptCreateInputSchema>;

export const promptUpdateInputSchema = z
  .object({
    title: z.string(),
    description: z.string(),
    content: z.string(),
    groupName: z.string(),
  })
  .partial();
export type PromptUpdateInput = z.infer<typeof promptUpdateInputSchema>;
