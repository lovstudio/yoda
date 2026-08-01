import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('sidebar project new task entry', () => {
  it('gives the floating-window preference priority over one-click creation', () => {
    const source = readFileSync(new URL('./project-item.tsx', import.meta.url), 'utf8');
    const fallbackStart = source.indexOf("openMode === 'modal' ||");
    const fallbackEnd = source.indexOf('const strategyKind', fallbackStart);
    const fallback = source.slice(fallbackStart, fallbackEnd);

    expect(source).toContain(
      "import { openNewTask, resolveNewTaskOpenMode } from '@renderer/app/open-new-task';"
    );
    expect(source).toContain('const openMode = await resolveNewTaskOpenMode();');
    expect(fallback).toContain("openMode === 'modal' ||");
    expect(fallback).toContain('openNewTask(openMode, projectId);');
    expect(fallback).not.toContain("navigate('home'");
  });
});
