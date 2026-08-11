import { describe, expect, it } from 'vitest';
import type { Automation } from '@shared/automation';
import {
  buildAutomationSchedulePreview,
  buildFriendlyCron,
  parseFriendlySchedule,
} from '@renderer/features/automation/automation-schedule';

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'daily',
    source: 'yoda',
    title: 'Daily review',
    workspaceName: 'Yoda',
    prompt: 'Review the day.',
    runtime: 'codex',
    scheduleLabel: '',
    status: 'active',
    triggerKind: 'cron',
    cronExpr: '0 9 * * *',
    timezone: 'UTC',
    projectId: null,
    nextRunAt: null,
    lastRunAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('automation schedule helpers', () => {
  it.each([
    ['0 9 * * *', { kind: 'daily', time: '09:00', weekday: '1' }],
    ['30 18 * * 1-5', { kind: 'weekdays', time: '18:30', weekday: '1' }],
    ['5 8 * * 4', { kind: 'weekly', time: '08:05', weekday: '4' }],
  ])('turns supported cron schedules into editable fields', (cron, expected) => {
    expect(parseFriendlySchedule(cron)).toEqual(expected);
  });

  it('leaves advanced and invalid cron schedules in custom mode', () => {
    expect(parseFriendlySchedule('*/15 * * * *')).toBeNull();
    expect(parseFriendlySchedule('0 25 * * *')).toBeNull();
  });

  it('builds daily, weekday, and weekly cron schedules', () => {
    expect(buildFriendlyCron('daily', '09:15')).toBe('15 9 * * *');
    expect(buildFriendlyCron('weekdays', '18:30')).toBe('30 18 * * 1-5');
    expect(buildFriendlyCron('weekly', '08:05', '4')).toBe('5 8 * * 4');
  });

  it('projects only active scheduled automations into the upcoming calendar', () => {
    const preview = buildAutomationSchedulePreview(
      [
        makeAutomation(),
        makeAutomation({ id: 'paused', title: 'Paused review', status: 'paused' }),
        makeAutomation({
          id: 'manual',
          title: 'Manual review',
          triggerKind: 'manual',
          cronExpr: null,
        }),
      ],
      new Date('2026-08-11T00:00:00.000Z'),
      2
    );

    expect(preview).toEqual([
      {
        automationId: 'daily',
        title: 'Daily review',
        scheduledAt: '2026-08-11T09:00:00.000Z',
      },
      {
        automationId: 'daily',
        title: 'Daily review',
        scheduledAt: '2026-08-12T09:00:00.000Z',
      },
    ]);
  });

  it('skips invalid legacy schedules without breaking the rest of the projection', () => {
    const preview = buildAutomationSchedulePreview(
      [
        makeAutomation({ id: 'invalid', cronExpr: 'not a cron' }),
        makeAutomation({ id: 'valid', title: 'Valid review' }),
      ],
      new Date('2026-08-11T00:00:00.000Z'),
      1
    );

    expect(preview).toEqual([
      {
        automationId: 'valid',
        title: 'Valid review',
        scheduledAt: '2026-08-11T09:00:00.000Z',
      },
    ]);
  });
});
