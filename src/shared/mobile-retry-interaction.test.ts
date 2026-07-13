import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('mobile gateway recovery interaction', () => {
  it('offers an accessible retry action when the connected dashboard cannot load', () => {
    const source = readFileSync(new URL('../../apps/mobile/src/App.tsx', import.meta.url), 'utf8');

    expect(source).toContain('onRetry={handleRefresh}');
    expect(source).toContain('accessibilityLabel="Retry loading Yoda gateway"');
    expect(source).toContain("{retrying ? 'Retrying' : 'Retry'}");
  });
});
