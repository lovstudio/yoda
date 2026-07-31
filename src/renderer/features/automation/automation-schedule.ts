export type FriendlyScheduleKind = 'daily' | 'weekdays' | 'weekly';

export type FriendlySchedule = {
  kind: FriendlyScheduleKind;
  time: string;
  weekday: string;
};

export const DEFAULT_AUTOMATION_CRON = '0 9 * * *';

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
