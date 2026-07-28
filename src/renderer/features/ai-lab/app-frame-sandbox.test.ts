import { describe, expect, it } from 'vitest';
import { AI_LAB_APP_FRAME_SANDBOX, AI_LAB_PROJECT_APP_FRAME_SANDBOX } from './app-frame-sandbox';

describe('AI Lab app frame sandbox', () => {
  it('allows user-initiated downloads without weakening origin isolation', () => {
    const permissions = AI_LAB_APP_FRAME_SANDBOX.split(' ');

    expect(permissions).toContain('allow-downloads');
    expect(permissions).not.toContain('allow-same-origin');
    expect(permissions).not.toContain('allow-popups-to-escape-sandbox');
  });

  it('allows same-origin module loading only for isolated loopback project Apps', () => {
    const permissions = AI_LAB_PROJECT_APP_FRAME_SANDBOX.split(' ');

    expect(permissions).toContain('allow-same-origin');
    expect(permissions).toContain('allow-scripts');
    expect(permissions).not.toContain('allow-popups-to-escape-sandbox');
  });
});
