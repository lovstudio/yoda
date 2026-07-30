import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Workspace runtime bar Doctor entry', () => {
  it('opens the detached Doctor window from a labeled bottom-bar action', () => {
    const source = readFileSync(new URL('./workspace-runtime-bar.tsx', import.meta.url), 'utf8');
    expect(source).toContain("t('workspaceRuntime.doctor')");
    expect(source).toContain('rpc.app.openDoctorWindow()');
    expect(source).toContain('<Stethoscope');
  });
});
