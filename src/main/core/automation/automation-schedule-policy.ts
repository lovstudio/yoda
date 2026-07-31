import type { Automation } from '@shared/automation';

export function shouldScheduleInYoda(automation: Automation): boolean {
  return (
    automation.source === 'yoda' &&
    automation.status === 'active' &&
    automation.triggerKind === 'cron' &&
    Boolean(automation.cronExpr)
  );
}
