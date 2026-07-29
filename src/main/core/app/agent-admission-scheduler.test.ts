import { describe, expect, it } from 'vitest';
import { calculateAutomaticAgentLimit } from './agent-admission-policy';

describe('calculateAutomaticAgentLimit', () => {
  it('uses both memory and CPU budgets', () => {
    expect(calculateAutomaticAgentLimit(8 * 1024 ** 3, 8)).toBe(2);
    expect(calculateAutomaticAgentLimit(32 * 1024 ** 3, 12)).toBe(6);
  });

  it('always leaves at least one admission slot', () => {
    expect(calculateAutomaticAgentLimit(2 * 1024 ** 3, 1)).toBe(1);
  });
});
