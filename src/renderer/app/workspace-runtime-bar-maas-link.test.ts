import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Workspace MaaS usage website link', () => {
  const source = readFileSync(new URL('./workspace-runtime-bar.tsx', import.meta.url), 'utf8');

  it('opens the configured platform website from the usage title', () => {
    expect(source).toContain('websiteUrl={maasPresentation.websiteUrl}');
    expect(source).toContain("t('workspaceRuntime.maasUsageOpenWebsite'");
    expect(source).toContain('void rpc.app.openExternal(websiteUrl)');
  });
});
