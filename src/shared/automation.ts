import { z } from 'zod';
import { RUNTIME_IDS } from './runtime-registry';

export const automationStatusSchema = z.enum(['active', 'paused']);
export type AutomationStatus = z.infer<typeof automationStatusSchema>;

/** P1 supports manual + cron triggers; event/webhook land in later phases. */
export const automationTriggerKindSchema = z.enum(['manual', 'cron']);
export type AutomationTriggerKind = z.infer<typeof automationTriggerKindSchema>;

/** A saved automation: a recurring prompt the user can run as an agent task. */
export const automationSchema = z.object({
  id: z.string(),
  title: z.string(),
  workspaceName: z.string(),
  prompt: z.string(),
  runtime: z.enum(RUNTIME_IDS),
  scheduleLabel: z.string(),
  status: automationStatusSchema,
  triggerKind: automationTriggerKindSchema,
  cronExpr: z.string().nullable(),
  timezone: z.string().nullable(),
  /** Real project to run the agent task in. null = internal Drafts workspace. */
  projectId: z.string().nullable(),
  /** Cached next scheduled run (ISO) for display. null when not scheduled. */
  nextRunAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Automation = z.infer<typeof automationSchema>;

export const automationCreateInputSchema = z.object({
  title: z.string(),
  workspaceName: z.string(),
  prompt: z.string(),
  runtime: z.enum(RUNTIME_IDS),
  scheduleLabel: z.string().default(''),
  status: automationStatusSchema.default('active'),
  triggerKind: automationTriggerKindSchema.default('manual'),
  cronExpr: z.string().nullable().default(null),
  timezone: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
});
export type AutomationCreateInput = z.infer<typeof automationCreateInputSchema>;

export const automationUpdateInputSchema = z
  .object({
    title: z.string(),
    workspaceName: z.string(),
    prompt: z.string(),
    runtime: z.enum(RUNTIME_IDS),
    scheduleLabel: z.string(),
    status: automationStatusSchema,
    triggerKind: automationTriggerKindSchema,
    cronExpr: z.string().nullable(),
    timezone: z.string().nullable(),
    projectId: z.string().nullable(),
    lastRunAt: z.string().nullable(),
  })
  .partial();
export type AutomationUpdateInput = z.infer<typeof automationUpdateInputSchema>;

export const automationRunStatusSchema = z.enum(['running', 'success', 'failed', 'skipped']);
export type AutomationRunStatus = z.infer<typeof automationRunStatusSchema>;

export type AutomationRun = {
  id: string;
  automationId: string;
  taskId: string | null;
  trigger: string;
  status: AutomationRunStatus;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
};
