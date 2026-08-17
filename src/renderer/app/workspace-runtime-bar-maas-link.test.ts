import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readRuntimeBarSource } from '@renderer/app/runtime-bar/test-helpers/read-bar-source';

describe('Workspace MaaS usage website link', () => {
  const source = readRuntimeBarSource();
  const popoverSource = readFileSync(
    new URL('./workspace-maas-popover.tsx', import.meta.url),
    'utf8'
  );
  const usageCardSource = readFileSync(
    new URL('./runtime-bar/maas-usage-content.tsx', import.meta.url),
    'utf8'
  );

  // The platform's identity — its name, its console — belongs to the
  // model-access entry. The usage card beside it only reports figures.
  it('opens the configured platform website from the model access entry', () => {
    expect(popoverSource).toContain("t('workspaceRuntime.maas.openWebsite'");
    expect(source).toContain('void rpc.app.openExternal(websiteUrl)');
    expect(source).toContain('websiteUrl={websiteUrl}');
  });

  it('keeps the usage card free of platform management jumps', () => {
    expect(usageCardSource).not.toContain('openExternal');
    expect(usageCardSource).not.toContain('websiteUrl');
  });
});
