import { describe, expect, it } from 'vitest';
import { AUTOMATION_SESSION_INSTRUCTIONS, withExecutionModeInstructions } from './execution-mode';

describe('withExecutionModeInstructions', () => {
  it('keeps interactive conversations unchanged', () => {
    expect(withExecutionModeInstructions('Project principles', 'interactive')).toBe(
      'Project principles'
    );
  });

  it('adds the single-run automation contract after project principles', () => {
    const instructions = withExecutionModeInstructions('Project principles', 'automation');

    expect(instructions).toBe(`Project principles\n\n${AUTOMATION_SESSION_INSTRUCTIONS}`);
    expect(instructions).toContain('Do not create, resume, update, pause, or wait on a Goal.');
    expect(instructions).toContain('A later schedule is a separate run.');
  });
});
