import { describe, expect, it } from 'vitest';
import { readRuntimeBarSource } from '@renderer/app/runtime-bar/test-helpers/read-bar-source';

describe('Workspace MaaS usage website link', () => {
  const source = readRuntimeBarSource();

  it('opens the configured platform website from the usage card overflow menu', () => {
    expect(source).toContain('websiteUrl={maasPresentation.websiteUrl}');
    expect(source).toContain("t('workspaceRuntime.maasUsageOpenWebsite'");
    expect(source).toContain('void rpc.app.openExternal(websiteUrl)');
  });
});
