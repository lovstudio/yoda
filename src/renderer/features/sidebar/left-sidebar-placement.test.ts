import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('LeftSidebar app placement', () => {
  it('renders pinned Apps beneath Library and replaces Marketplace with Settings', () => {
    const source = readFileSync(new URL('./left-sidebar.tsx', import.meta.url), 'utf8');
    const libraryIndex = source.indexOf(
      '<GlobalSidePaneTarget viewId="library" params={libraryParams}'
    );
    const pinnedAppsIndex = source.indexOf('{pinnedApps.map((app) => (');
    const settingsIndex = source.indexOf('<GlobalSidePaneTarget viewId="settings"');

    expect(libraryIndex).toBeGreaterThan(-1);
    expect(pinnedAppsIndex).toBeGreaterThan(libraryIndex);
    expect(settingsIndex).toBeGreaterThan(pinnedAppsIndex);
    expect(source.slice(pinnedAppsIndex, settingsIndex)).toContain('viewId="library"');
    expect(source).not.toContain('viewId="marketplace"');
  });

  it('does not mix view options into the fixed navigation list', () => {
    const source = readFileSync(new URL('./left-sidebar.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('ProjectsSettingsMenu');
  });

  it('keeps the primary creation entry as a new task in every view', () => {
    const source = readFileSync(new URL('./left-sidebar.tsx', import.meta.url), 'utf8');
    const buttonSource = readFileSync(
      new URL('./new-task-menu-button.tsx', import.meta.url),
      'utf8'
    );

    expect(source).toContain("import { NewTaskMenuButton } from './new-task-menu-button';");
    expect(source).toContain('<NewTaskMenuButton');
    expect(buttonSource).toContain(
      'void openNewTaskFromPreference(currentProjectId, event.altKey)'
    );
    expect(buttonSource).toContain("t('sidebar.newTask')");
    expect(source).not.toContain('openNewTaskFromCurrentContext');
    expect(source).not.toContain('createSubtaskAndRun');
  });

  it('uses one virtual sidebar list inside the shared drag-and-drop provider', () => {
    const source = readFileSync(new URL('./left-sidebar.tsx', import.meta.url), 'utf8');
    const virtualListSource = readFileSync(
      new URL('./sidebar-virtual-list.tsx', import.meta.url),
      'utf8'
    );
    const providerStart = source.indexOf('<SidebarDndProvider>');
    const virtualList = source.indexOf('<SidebarVirtualList', providerStart);
    const providerEnd = source.indexOf('</SidebarDndProvider>', providerStart);

    expect(providerStart).toBeGreaterThan(-1);
    expect(virtualList).toBeGreaterThan(providerStart);
    expect(providerEnd).toBeGreaterThan(virtualList);
    expect(source).not.toContain('<SidebarPinnedTaskList');
    expect(virtualListSource).toContain("{ kind: 'pinned-header' }");
    expect(virtualListSource).toContain("{ kind: 'projects-header' }");
    expect(virtualListSource).not.toContain('scrollMargin');
    expect(virtualListSource).not.toContain('<DndContext');
  });
});
