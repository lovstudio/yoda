import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('workspace route snapshot', () => {
  it('renders the wrapper and route slots from one navigation snapshot', () => {
    const workspaceSource = readFileSync(new URL('./workspace.tsx', import.meta.url), 'utf8');
    const navigationSource = readFileSync(
      new URL('../lib/layout/navigation-provider.tsx', import.meta.url),
      'utf8'
    );

    expect(workspaceSource.match(/useWorkspaceRouteSnapshot\(\)/g)).toHaveLength(1);
    expect(workspaceSource).not.toContain('useWorkspaceSlots');
    expect(workspaceSource).not.toContain('useWorkspaceWrapParams');
    expect(workspaceSource).toContain(
      'const { WrapView, TitlebarSlot, MainPanel, currentView, wrapParams } =\n    useWorkspaceRouteSnapshot();'
    );
    expect(workspaceSource).toContain('TitlebarSlot={TitlebarSlot}');
    expect(workspaceSource).toContain('MainPanel={MainPanel}');
    expect(navigationSource).toContain(
      'wrapParams: (appState.navigation.viewParamsStore[viewId] ?? {})'
    );
  });
});
