import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('workspace route snapshot', () => {
  it('renders the wrapper and route slots from one navigation snapshot', () => {
    const workspaceSource = readFileSync(new URL('./workspace.tsx', import.meta.url), 'utf8');
    const navigationSource = readFileSync(
      new URL('../lib/layout/navigation-provider.tsx', import.meta.url),
      'utf8'
    );

    expect(workspaceSource.match(/workspaceRouteSnapshot\(\)/g)).toHaveLength(1);
    expect(workspaceSource).not.toContain('useWorkspaceSlots');
    expect(workspaceSource).not.toContain('useWorkspaceWrapParams');
    expect(workspaceSource).toContain('const routeSnapshot = workspaceRouteSnapshot();');
    expect(workspaceSource).toContain('<WorkspaceRouteCache snapshot={routeSnapshot} />');
    expect(workspaceSource).toContain('<WrapView key={routeBoundaryKey} {...wrapParams}>');
    expect(workspaceSource).not.toContain('TaskOpenTransitionOverlay');
    expect(workspaceSource).not.toContain('taskOpenTransitionStore');
    expect(workspaceSource).toContain('TitlebarSlot={TitlebarSlot}');
    expect(workspaceSource).toContain('MainPanel={MainPanel}');
    expect(navigationSource).toContain('export function workspaceRouteSnapshot()');
    expect(navigationSource).toContain(
      'wrapParams: (appState.navigation.viewParamsStore[viewId] ?? {})'
    );
  });

  it('keeps a bounded warm cache for recent task routes', () => {
    const workspaceSource = readFileSync(new URL('./workspace.tsx', import.meta.url), 'utf8');

    expect(workspaceSource).toContain('const TASK_ROUTE_CACHE_LIMIT = 2;');
    expect(workspaceSource).toContain(
      "mode={currentTaskKey === taskRoute.key ? 'visible' : 'hidden'}"
    );
    expect(workspaceSource).toContain(
      'while (taskRoutesRef.current.length > TASK_ROUTE_CACHE_LIMIT)'
    );
    expect(workspaceSource).toContain('taskRoutesRef.current.splice(oldestIndex, 1);');
  });
});
