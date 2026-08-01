export type QuotaWindowLabelKey =
  | 'workspaceRuntime.quotaWindowMinutes'
  | 'workspaceRuntime.quotaWindowHours'
  | 'workspaceRuntime.quotaWindowDays'
  | 'workspaceRuntime.quotaWindowWeeks';

export interface QuotaWindowLabel {
  translationKey: QuotaWindowLabelKey;
  value: number;
}

function normalizeSessionLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function getDistinctAgentTaskTitle(sessionTitle: string, taskTitle: string): string | null {
  const trimmedTaskTitle = taskTitle.trim();

  return normalizeSessionLabel(sessionTitle) === normalizeSessionLabel(trimmedTaskTitle)
    ? null
    : trimmedTaskTitle;
}

const QUOTA_WINDOW_UNITS: ReadonlyArray<{
  minutes: number;
  translationKey: QuotaWindowLabelKey;
}> = [
  { minutes: 7 * 24 * 60, translationKey: 'workspaceRuntime.quotaWindowWeeks' },
  { minutes: 24 * 60, translationKey: 'workspaceRuntime.quotaWindowDays' },
  { minutes: 60, translationKey: 'workspaceRuntime.quotaWindowHours' },
];

export function getQuotaWindowLabel(windowMinutes: number): QuotaWindowLabel {
  const exactUnit = QUOTA_WINDOW_UNITS.find(
    (unit) => windowMinutes >= unit.minutes && windowMinutes % unit.minutes === 0
  );

  if (exactUnit) {
    return {
      translationKey: exactUnit.translationKey,
      value: windowMinutes / exactUnit.minutes,
    };
  }

  return {
    translationKey: 'workspaceRuntime.quotaWindowMinutes',
    value: windowMinutes,
  };
}
