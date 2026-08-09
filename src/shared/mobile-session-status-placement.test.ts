import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('mobile session runtime status placement', () => {
  const source = readFileSync(new URL('../../apps/mobile/src/App.tsx', import.meta.url), 'utf8');

  it('keeps the runtime status as centered title metadata instead of the composer', () => {
    const navigationBar = source.slice(
      source.indexOf('function SessionNavigationBar'),
      source.indexOf('function InputMediaControls')
    );
    const inputComposer = source.slice(
      source.indexOf('function SessionInputComposer'),
      source.indexOf('function SessionRuntimeStatus')
    );

    expect(navigationBar).toContain('<SessionRuntimeStatus');
    expect(navigationBar.indexOf('<SessionRuntimeStatus')).toBeLessThan(
      navigationBar.indexOf('</View>\n        <Pressable')
    );
    expect(navigationBar).not.toContain('Session ·');
    expect(navigationBar).not.toContain('styles.sessionNavEyebrow');
    expect(inputComposer).not.toContain('<SessionRuntimeStatus');
    expect(inputComposer).toContain('styles.sessionInputCount');
  });
});
