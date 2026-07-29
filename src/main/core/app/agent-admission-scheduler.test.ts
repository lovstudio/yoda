import { describe, expect, it } from 'vitest';
import { calculateAutomaticAgentLimit, countActiveAgentAdmissions } from './agent-admission-policy';

describe('calculateAutomaticAgentLimit', () => {
  it('uses both memory and CPU budgets', () => {
    expect(calculateAutomaticAgentLimit(8 * 1024 ** 3, 8)).toBe(2);
    expect(calculateAutomaticAgentLimit(32 * 1024 ** 3, 12)).toBe(6);
  });

  it('always leaves at least one admission slot', () => {
    expect(calculateAutomaticAgentLimit(2 * 1024 ** 3, 1)).toBe(1);
  });

  it('counts only sessions that are actively running', () => {
    expect(
      countActiveAgentAdmissions(
        [
          { status: 'idle' },
          { status: 'completed' },
          { status: 'error' },
          { status: 'working' },
          { status: 'awaiting-input' },
        ],
        1
      )
    ).toBe(3);
  });
});
