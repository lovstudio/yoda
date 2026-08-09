import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('sidebar parent-task creation shortcut', () => {
  it('uses the session-starting shared action', () => {
    const source = readFileSync(new URL('./task-item.tsx', import.meta.url), 'utf8');

    expect(source).toContain(
      'const canQuickCreateSubtask = isParentTask && Boolean(menuActions.onCreateSubtaskAndRun);'
    );
    expect(source).toContain("aria-label={t('tasks.context.createSubtaskAndRun')}");
    expect(source).toContain('menuActions.onCreateSubtaskAndRun?.();');
  });
});
