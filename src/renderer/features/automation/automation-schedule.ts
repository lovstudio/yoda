import { Cron } from 'croner';
import type { Automation } from '@shared/automation';

export type FriendlyScheduleKind = 'daily' | 'weekdays' | 'weekly';

export type FriendlySchedule = {
  kind: FriendlyScheduleKind;
  time: string;
  weekday: string;
};

export const DEFAULT_AUTOMATION_CRON = '0 9 * * *';

export const AUTOMATION_SCHEDULE_PREVIEW_DAYS = 7;

const MAX_SCHEDULE_EVENTS_PER_AUTOMATION = 256;

export type AutomationScheduleEvent = {
  automationId: string;
  title: string;
  scheduledAt: string;
};

export function parseFriendlySchedule(cronExpr: string): FriendlySchedule | null {
  const match = cronExpr.trim().match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+(\*|1-5|[0-6])$/);
  if (!match) return null;

  const minute = Number(match[1]);
  const hour = Number(match[2]);
  if (minute > 59 || hour > 23) return null;

  const weekdayExpression = match[3];
  const kind: FriendlyScheduleKind =
    weekdayExpression === '*' ? 'daily' : weekdayExpression === '1-5' ? 'weekdays' : 'weekly';

  return {
    kind,
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    weekday: kind === 'weekly' ? weekdayExpression : '1',
  };
}

export function buildFriendlyCron(kind: FriendlyScheduleKind, time: string, weekday = '1'): string {
  const [hour = '9', minute = '0'] = time.split(':');
  const weekdayExpression = kind === 'daily' ? '*' : kind === 'weekdays' ? '1-5' : weekday;
  return `${Number(minute)} ${Number(hour)} * * ${weekdayExpression}`;
}

/**
 * Builds the same near-term projection the scheduler uses, without starting a
 * timer in the renderer. The capped result keeps a pathological every-minute
 * schedule from making the overview itself unwieldy.
 */
export function buildAutomationSchedulePreview(
  automations: readonly Automation[],
  now: Date = new Date(),
  days = AUTOMATION_SCHEDULE_PREVIEW_DAYS
): AutomationScheduleEvent[] {
  const start = new Date(now);
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + days);

  return automations
    .flatMap((automation) => {
      if (
        automation.status !== 'active' ||
        automation.triggerKind !== 'cron' ||
        !automation.cronExpr
      ) {
        return [];
      }

      try {
        const job = new Cron(
          automation.cronExpr,
          automation.timezone ? { paused: true, timezone: automation.timezone } : { paused: true }
        );

        const events: AutomationScheduleEvent[] = [];
        let previous = start;

        for (let count = 0; count < MAX_SCHEDULE_EVENTS_PER_AUTOMATION; count += 1) {
          const runAt = job.nextRun(previous);
          if (!runAt || runAt.getTime() >= end.getTime()) break;

          events.push({
            automationId: automation.id,
            title: automation.title,
            scheduledAt: runAt.toISOString(),
          });
          previous = runAt;
        }

        return events;
      } catch {
        // Invalid schedules are rejected when saved. Treat old or synced bad
        // data as unscheduled rather than letting one row break the overview.
        return [];
      }
    })
    .sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt));
}
