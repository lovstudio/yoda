import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('sidebar parent-task hover action', () => {
  it('keeps archive primary and retains subtask creation in the shared menu', () => {
    const taskItemSource = readFileSync(new URL('./task-item.tsx', import.meta.url), 'utf8');
    const taskMenuSource = readFileSync(
      new URL('../tasks/components/task-context-menu.tsx', import.meta.url),
      'utf8'
    );

    expect(taskItemSource).toContain('{!isArchived ? archiveControl : null}');
    expect(taskItemSource).not.toContain('const canQuickCreateSubtask =');
    expect(taskMenuSource).toContain("key: 'create-subtask-and-run'");
    expect(taskMenuSource).toContain('onSelect: actions.onCreateSubtaskAndRun');
  });
});
