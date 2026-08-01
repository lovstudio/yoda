import { describe, expect, it } from 'vitest';
import {
  buildQuickActionCompilationPrompt,
  parseCompiledQuickAction,
} from './quick-action-contract';

describe('quick action compilation contract', () => {
  it('classifies deterministic commands separately from intelligent Skills', () => {
    const prompt = buildQuickActionCompilationPrompt(
      'Start the project locally.',
      '/tmp/example-project'
    );

    expect(prompt).toContain('Inspect the repository');
    expect(prompt).toContain('Choose "command"');
    expect(prompt).toContain('Choose "skill"');
    expect(prompt).toContain('Choose "none"');
    expect(prompt).toContain('must not invoke claude, codex');
    expect(prompt).toContain('/tmp/example-project');
  });

  it('uses the completed run as evidence for post-task distillation', () => {
    const prompt = buildQuickActionCompilationPrompt(
      'Start the local preview.',
      '/tmp/example-project',
      'The task succeeded by running pnpm run dev.'
    );

    expect(prompt).toContain('WHAT ACTUALLY HAPPENED IN THIS RUN');
    expect(prompt).toContain('pnpm run dev');
  });

  it('keeps the UI quiet for tasks without a reusable operation', () => {
    expect(
      parseCompiledQuickAction(
        JSON.stringify({
          kind: 'none',
          explanation: 'This was a one-off investigation.',
        })
      )
    ).toEqual({
      kind: 'none',
      explanation: 'This was a one-off investigation.',
    });
  });

  it('parses a strict compiled command response', () => {
    expect(
      parseCompiledQuickAction(
        JSON.stringify({
          kind: 'command',
          label: 'Start locally',
          command: 'pnpm run dev',
          explanation: 'package.json defines the dev script',
        })
      )
    ).toEqual({
      kind: 'command',
      label: 'Start locally',
      command: 'pnpm run dev',
      explanation: 'package.json defines the dev script',
    });
  });

  it('keeps adaptive work as a reusable Skill instruction', () => {
    expect(
      parseCompiledQuickAction(
        JSON.stringify({
          kind: 'skill',
          label: 'Review recent changes',
          instruction: 'Review recent changes, identify the highest-risk regression, and fix it.',
          explanation: 'Each run needs contextual review and judgment.',
        })
      )
    ).toEqual({
      kind: 'skill',
      label: 'Review recent changes',
      instruction: 'Review recent changes, identify the highest-risk regression, and fix it.',
      explanation: 'Each run needs contextual review and judgment.',
    });
  });

  it('rejects a command result without an executable command', () => {
    expect(() =>
      parseCompiledQuickAction(
        JSON.stringify({
          kind: 'command',
          label: 'Start locally',
          explanation: 'No command was generated',
        })
      )
    ).toThrow('incomplete command');
  });
});
