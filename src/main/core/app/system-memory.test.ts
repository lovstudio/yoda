import { describe, expect, it } from 'vitest';
import { calculateMemoryUsedPercent, parseDarwinMemoryPressureUsedPercent } from './system-memory';

describe('system memory usage', () => {
  it('calculates portable memory usage with bounded rounding', () => {
    expect(calculateMemoryUsedPercent(1_000, 555)).toBe(44.5);
    expect(calculateMemoryUsedPercent(0, 0)).toBe(0);
    expect(calculateMemoryUsedPercent(1_000, 2_000)).toBe(0);
  });

  it('uses the macOS memory pressure free percentage', () => {
    expect(
      parseDarwinMemoryPressureUsedPercent(
        ['The system has 38654705664 bytes.', 'System-wide memory free percentage: 55%'].join('\n')
      )
    ).toBe(45);
  });

  it('rejects missing or invalid macOS pressure output', () => {
    expect(parseDarwinMemoryPressureUsedPercent('memory pressure unavailable')).toBeUndefined();
    expect(
      parseDarwinMemoryPressureUsedPercent('System-wide memory free percentage: 101%')
    ).toBeUndefined();
  });
});
