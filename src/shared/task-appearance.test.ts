import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TASK_APPEARANCE_SETTINGS,
  resolveTaskAppearance,
  type TaskAppearanceSettings,
} from './task-appearance';

describe('resolveTaskAppearance', () => {
  it('preserves the default standard and long-term hierarchy', () => {
    expect(
      resolveTaskAppearance(DEFAULT_TASK_APPEARANCE_SETTINGS, {
        isLongTerm: false,
        needsReview: false,
        isIdle: true,
        isMultiAgent: false,
      })
    ).toEqual({
      titleStyle: 'regular',
      idleOpacity: 100,
      marker: 'none',
    });

    expect(
      resolveTaskAppearance(DEFAULT_TASK_APPEARANCE_SETTINGS, {
        isLongTerm: true,
        needsReview: false,
        isIdle: true,
        isMultiAgent: false,
      })
    ).toEqual({
      titleStyle: 'italic',
      idleOpacity: 70,
      marker: 'none',
    });
  });

  it('restores full strength while working or awaiting review', () => {
    for (const state of [
      { isIdle: false, needsReview: false },
      { isIdle: true, needsReview: true },
    ]) {
      expect(
        resolveTaskAppearance(DEFAULT_TASK_APPEARANCE_SETTINGS, {
          isLongTerm: true,
          isMultiAgent: false,
          ...state,
        }).idleOpacity
      ).toBe(100);
    }
  });

  it('lets multi-agent tasks override only the marker', () => {
    const settings: TaskAppearanceSettings = {
      ...DEFAULT_TASK_APPEARANCE_SETTINGS,
      longTerm: {
        titleStyle: 'medium',
        idleOpacity: 55,
        marker: 'bookmark',
      },
      multiAgent: { marker: 'dot' },
    };

    expect(
      resolveTaskAppearance(settings, {
        isLongTerm: true,
        needsReview: false,
        isIdle: true,
        isMultiAgent: true,
      })
    ).toEqual({
      titleStyle: 'medium',
      idleOpacity: 55,
      marker: 'dot',
    });
  });
});
