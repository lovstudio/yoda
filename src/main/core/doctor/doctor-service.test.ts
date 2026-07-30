import { describe, expect, it } from 'vitest';
import { doctorStatus } from './doctor-score';

describe('Doctor score status', () => {
  it('maps scores to stable health bands', () => {
    expect(doctorStatus(100)).toBe('healthy');
    expect(doctorStatus(85)).toBe('healthy');
    expect(doctorStatus(84)).toBe('attention');
    expect(doctorStatus(60)).toBe('attention');
    expect(doctorStatus(59)).toBe('critical');
  });

  it('keeps intentionally inactive clients out of the warning bands', () => {
    expect(doctorStatus(100, true)).toBe('inactive');
    expect(doctorStatus(0, true)).toBe('inactive');
  });
});
