import { describe, expect, it } from 'vitest';
import { isConversationSurfaceVisible } from './conversation-surface-visibility';

describe('isConversationSurfaceVisible', () => {
  it('keeps the active main-window task connected', () => {
    expect(
      isConversationSurfaceVisible({
        isActiveTask: true,
        isSplitView: false,
        forceVisible: false,
      })
    ).toBe(true);
  });

  it('keeps split-view sessions connected', () => {
    expect(
      isConversationSurfaceVisible({
        isActiveTask: false,
        isSplitView: true,
        forceVisible: false,
      })
    ).toBe(true);
  });

  it('keeps a detached task-window session connected outside the main route', () => {
    expect(
      isConversationSurfaceVisible({
        isActiveTask: false,
        isSplitView: false,
        forceVisible: true,
      })
    ).toBe(true);
  });

  it('does not connect a hidden background session', () => {
    expect(
      isConversationSurfaceVisible({
        isActiveTask: false,
        isSplitView: false,
        forceVisible: false,
      })
    ).toBe(false);
  });
});
