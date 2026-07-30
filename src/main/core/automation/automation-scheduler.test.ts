import { describe, expect, it } from 'vitest';
import type { Automation } from '@shared/automation';
import { shouldScheduleInYoda } from './automation-schedule-policy';

const baseAutomation: Automation = {
  id: 'daily-check',
  source: 'yoda',
  title: 'Daily check',
  workspaceName: 'Yoda',
  prompt: 'Check status',
  runtime: 'codex',
  scheduleLabel: '',
  status: 'active',
  triggerKind: 'cron',
  cronExpr: '0 10 * * *',
  timezone: 'Asia/Shanghai',
  projectId: null,
  nextRunAt: null,
  lastRunAt: null,
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
};

describe('Automation scheduler ownership', () => {
  it('schedules active native Yoda cron automations', () => {
    expect(shouldScheduleInYoda(baseAutomation)).toBe(true);
  });

  it('leaves Codex mirrors to the Codex scheduler', () => {
    expect(
      shouldScheduleInYoda({
        ...baseAutomation,
        id: 'codex:daily-check',
        source: 'codex',
      })
    ).toBe(false);
  });

  it('skips paused and manual Yoda automations', () => {
    expect(shouldScheduleInYoda({ ...baseAutomation, status: 'paused' })).toBe(false);
    expect(
      shouldScheduleInYoda({
        ...baseAutomation,
        triggerKind: 'manual',
        cronExpr: null,
      })
    ).toBe(false);
  });
});
