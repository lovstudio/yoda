import { describe, expect, it } from 'vitest';
import { AI_LAB_APP_FRAME_SANDBOX } from './app-frame-sandbox';

describe('AI Lab app frame sandbox', () => {
  it('allows user-initiated downloads without weakening origin isolation', () => {
    const permissions = AI_LAB_APP_FRAME_SANDBOX.split(' ');

    expect(permissions).toContain('allow-downloads');
    expect(permissions).not.toContain('allow-same-origin');
    expect(permissions).not.toContain('allow-popups-to-escape-sandbox');
  });
});
