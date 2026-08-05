import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('LeftSidebar app placement', () => {
  it('renders pinned Apps beneath Marketplace instead of Library', () => {
    const source = readFileSync(new URL('./left-sidebar.tsx', import.meta.url), 'utf8');
    const libraryIndex = source.indexOf(
      '<GlobalSidePaneTarget viewId="library" params={libraryParams}'
    );
    const marketplaceIndex = source.indexOf(
      '<GlobalSidePaneTarget viewId="marketplace" params={marketplaceParams}'
    );
    const pinnedAppsIndex = source.indexOf('{pinnedApps.map((app) => (');

    expect(libraryIndex).toBeGreaterThan(-1);
    expect(marketplaceIndex).toBeGreaterThan(libraryIndex);
    expect(pinnedAppsIndex).toBeGreaterThan(marketplaceIndex);
    expect(source.slice(pinnedAppsIndex)).toContain('viewId="marketplace"');
  });

  it('does not mix view options into the fixed navigation list', () => {
    const source = readFileSync(new URL('./left-sidebar.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('ProjectsSettingsMenu');
  });

  it('keeps the primary creation entry as a new task in every view', () => {
    const source = readFileSync(new URL('./left-sidebar.tsx', import.meta.url), 'utf8');

    expect(source).toContain(
      "import { openNewTaskFromPreference } from '@renderer/app/open-new-task';"
    );
    expect(source).toContain('void openNewTaskFromPreference(currentProjectId);');
    expect(source).toContain("aria-label={t('sidebar.newTask')}");
    expect(source).toContain("{t('sidebar.newTask')}</span>");
    expect(source).not.toContain('openNewTaskFromCurrentContext');
    expect(source).not.toContain('createSubtaskAndRun');
  });
});
