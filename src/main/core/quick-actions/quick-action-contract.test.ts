import { describe, expect, it } from 'vitest';
import {
  buildQuickActionCompilationPrompt,
  parseCompiledQuickAction,
} from './quick-action-contract';

describe('quick action compilation contract', () => {
  it('requires a repository-backed program command instead of an Agent prompt', () => {
    const prompt = buildQuickActionCompilationPrompt(
      'Start the project locally.',
      '/tmp/example-project'
    );

    expect(prompt).toContain('Inspect the repository');
    expect(prompt).toContain('programmatic shell command');
    expect(prompt).toContain('Do not invoke claude, codex');
    expect(prompt).toContain('/tmp/example-project');
  });

  it('parses a strict compiled command response', () => {
    expect(
      parseCompiledQuickAction(
        JSON.stringify({
          label: 'Start locally',
          command: 'pnpm run dev',
          explanation: 'package.json defines the dev script',
        })
      )
    ).toEqual({
      label: 'Start locally',
      command: 'pnpm run dev',
      explanation: 'package.json defines the dev script',
    });
  });

  it('rejects a response without an executable command', () => {
    expect(() =>
      parseCompiledQuickAction(
        JSON.stringify({
          label: 'Start locally',
          explanation: 'No command was generated',
        })
      )
    ).toThrow('incomplete command');
  });
});
