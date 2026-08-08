import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('TerminalWorkbench scope contract', () => {
  it('receives link behavior from its host instead of requiring a task context', () => {
    const source = readFileSync(new URL('./terminal-workbench.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain("from './use-workspace-file-links'");
    expect(source).not.toContain("from './use-workspace-web-links'");
    expect(source).not.toContain('useRequireProvisionedTask');
    expect(source).toContain('fileLinks: TerminalFileLinkOptions | null');
    expect(source).toContain('webLinks: TerminalWebLinkOptions | null');
  });
});
