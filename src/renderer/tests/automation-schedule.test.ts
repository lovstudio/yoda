import { describe, expect, it } from 'vitest';
import {
  buildFriendlyCron,
  parseFriendlySchedule,
} from '@renderer/features/automation/automation-schedule';

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
});
