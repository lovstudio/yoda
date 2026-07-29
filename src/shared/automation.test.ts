import { describe, expect, it } from 'vitest';
import { automationCreateInputSchema, automationSchema } from './automation';

describe('automation runtime compatibility', () => {
  it('migrates a retired runtime in persisted automations', () => {
    const automation = automationSchema.parse({
      id: 'automation-1',
      title: 'Legacy automation',
      workspaceName: 'Project',
      prompt: 'Run',
      runtime: 'glm',
      scheduleLabel: '',
      status: 'active',
      triggerKind: 'manual',
      cronExpr: null,
      timezone: null,
      projectId: null,
      nextRunAt: null,
      lastRunAt: null,
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
    });

    expect(automation.runtime).toBe('claude');
  });

  it('rejects retired runtimes in new automations', () => {
    expect(
      automationCreateInputSchema.safeParse({
        title: 'New automation',
        workspaceName: 'Project',
        prompt: 'Run',
        runtime: 'glm',
      }).success
    ).toBe(false);
  });
});
