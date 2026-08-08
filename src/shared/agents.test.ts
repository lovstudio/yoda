import { describe, expect, it } from 'vitest';
import { resolveAgentPermissionMode } from './agents';
import { getDefaultPermissionModeId } from './runtime-registry';

describe('Agent execution settings', () => {
  it('maps reusable access levels to Codex permission modes', () => {
    expect(getDefaultPermissionModeId('codex')).toBe('default');
    expect(resolveAgentPermissionMode('codex', 'inherit')).toBeUndefined();
    expect(resolveAgentPermissionMode('codex', 'plan')).toBe('plan');
    expect(resolveAgentPermissionMode('codex', 'write')).toBe('full-auto');
    expect(resolveAgentPermissionMode('codex', 'full-access')).toBe('bypass');
  });

  it('maps reusable access levels to Claude permission modes', () => {
    expect(resolveAgentPermissionMode('claude', 'plan')).toBe('plan');
    expect(resolveAgentPermissionMode('claude', 'write')).toBe('accept-edits');
    expect(resolveAgentPermissionMode('claude', 'full-access')).toBe('bypass');
  });

  it('degrades unsupported intermediate levels without escalating permissions', () => {
    expect(resolveAgentPermissionMode('gemini', 'plan')).toBe('default');
    expect(resolveAgentPermissionMode('gemini', 'write')).toBe('default');
  });
});
