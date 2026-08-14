import { describe, expect, it } from 'vitest';
import { isTerminalFileLinkActivation, isTerminalLinkActivation } from './terminal-link-activation';

function mouseEvent(
  overrides: Partial<Pick<MouseEvent, 'button' | 'ctrlKey' | 'metaKey'>> = {}
): MouseEvent {
  return {
    button: 0,
    ctrlKey: false,
    metaKey: false,
    ...overrides,
  } as MouseEvent;
}

describe('terminal link activation', () => {
  it('opens smart file paths with an ordinary primary click', () => {
    expect(isTerminalFileLinkActivation(mouseEvent())).toBe(true);
    expect(isTerminalFileLinkActivation(mouseEvent({ button: 1 }))).toBe(false);
  });

  it('opens web links with an ordinary primary click', () => {
    expect(isTerminalLinkActivation(mouseEvent())).toBe(true);
    expect(isTerminalLinkActivation(mouseEvent({ button: 1 }))).toBe(false);
  });
});
