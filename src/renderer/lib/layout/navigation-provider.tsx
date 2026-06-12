import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  views,
  type ViewDefinition,
  type ViewId,
  type WrapParams,
} from '@renderer/app/view-registry';
import { useMobxValue } from '@renderer/lib/hooks/use-mobx-value';
import { appState } from '@renderer/lib/stores/app-state';

/**
 * NavArgs makes the params argument optional when all fields are optional,
 * and omits it entirely for views with no params (home, skills).
 */
export type NavArgs<TId extends ViewId> = keyof WrapParams<TId> extends never
  ? [viewId: TId]
  : Partial<WrapParams<TId>> extends WrapParams<TId>
    ? [viewId: TId, params?: WrapParams<TId>]
    : [viewId: TId, params: WrapParams<TId>];

/** Higher-rank navigate function — generic at the call site, not at the hook call site. */
export type NavigateFnTyped = <TId extends ViewId>(...args: NavArgs<TId>) => void;

export type UpdateViewParamsFn = <TId extends ViewId>(
  viewId: TId,
  update: Partial<WrapParams<TId>> | ((prev: WrapParams<TId>) => WrapParams<TId>)
) => void;

export type SlotsContextValue = {
  WrapView: ComponentType<{ children: ReactNode } & Record<string, unknown>>;
  TitlebarSlot: ComponentType;
  MainPanel: ComponentType;
  currentView: string;
};

export type WrapParamsContextValue = {
  wrapParams: Record<string, unknown>;
};

export type ViewParamsStoreContextValue = {
  viewParamsStore: Partial<{ [K in ViewId]: WrapParams<K> }>;
};

export function useNavigate(): { navigate: NavigateFnTyped } {
  const navigate = useCallback((...args: unknown[]) => {
    const [viewId, params] = args as [ViewId, WrapParams<ViewId> | undefined];
    appState.navigation.navigate(viewId, params);
  }, []) as NavigateFnTyped;
  return { navigate };
}

export function useWorkspaceSlots(): SlotsContextValue {
  return useMobxValue(() => {
    const viewId = appState.navigation.currentViewId;
    const def = (views as unknown as Record<string, ViewDefinition<Record<string, unknown>>>)[
      viewId
    ];
    return {
      WrapView: (def.WrapView ?? Fragment) as ComponentType<
        { children: ReactNode } & Record<string, unknown>
      >,
      TitlebarSlot: def.TitlebarSlot ?? (() => null),
      MainPanel: def.MainPanel,
      currentView: viewId,
    };
  });
}

export function useWorkspaceWrapParams(): WrapParamsContextValue {
  return useMobxValue(() => ({
    wrapParams: (appState.navigation.viewParamsStore[appState.navigation.currentViewId] ??
      {}) as Record<string, unknown>,
  }));
}

/**
 * Detaches a subtree's view params from the global navigation route. Hosts
 * that render a view outside the active route (the shell side pane's pinned
 * views) provide this so `useParams(viewId)` reads/writes the pin's own
 * params instead of the address bar's.
 */
export type ViewParamsOverride = {
  viewId: ViewId;
  getParams: () => Record<string, unknown>;
  setParams: (params: Record<string, unknown>) => void;
};

const ViewParamsOverrideContext = createContext<ViewParamsOverride | null>(null);

export const ViewParamsOverrideProvider = ViewParamsOverrideContext.Provider;

/**
 * Whether the subtree renders inside a pin host (shell side pane) rather than
 * the routed main area — lets views adapt chrome they'd otherwise duplicate
 * (e.g. settings hides its in-content tab picker; the pane header hosts one).
 */
export function useIsPinHosted(): boolean {
  return useContext(ViewParamsOverrideContext) !== null;
}

/**
 * Opens a view as a tab of the hosting surface: a side-pane pin when the
 * subtree renders inside a pin host, a top-level app tab otherwise. Use for
 * "open detail" actions (skill cards, …) so a pinned view adds a tab next to
 * itself instead of hijacking the main area's route.
 */
export function useOpenViewTab(): { openViewTab: NavigateFnTyped } {
  const isPinHosted = useIsPinHosted();
  const openViewTab = useCallback(
    (...args: unknown[]) => {
      const [viewId, params] = args as [ViewId, WrapParams<ViewId> | undefined];
      if (isPinHosted) {
        appState.sidePane.pinView(viewId, (params ?? {}) as Record<string, unknown>);
        return;
      }
      appState.appTabs.openTab(viewId, params);
    },
    [isPinHosted]
  ) as NavigateFnTyped;
  return { openViewTab };
}

export function useParams<TId extends ViewId>(
  viewId: TId
): {
  params: WrapParams<TId>;
  setParams: (
    update: Partial<WrapParams<TId>> | ((prev: WrapParams<TId>) => WrapParams<TId>)
  ) => void;
} {
  const override = useContext(ViewParamsOverrideContext);
  // Only the hosted view's own params detach; other viewIds (e.g. a pinned
  // project view's components asking about the task route) stay global.
  const active = override && override.viewId === viewId ? override : null;
  const setParams = useCallback(
    (update: Partial<WrapParams<TId>> | ((prev: WrapParams<TId>) => WrapParams<TId>)) => {
      if (active) {
        const prev = active.getParams() as WrapParams<TId>;
        const next = typeof update === 'function' ? update(prev) : { ...prev, ...update };
        active.setParams(next as Record<string, unknown>);
        return;
      }
      appState.navigation.updateViewParams(viewId, update);
    },
    // viewId is a stable string literal
    [viewId, active]
  );
  return useMobxValue(() => ({
    params: (active
      ? active.getParams()
      : (appState.navigation.viewParamsStore[viewId] ?? {})) as WrapParams<TId>,
    setParams,
  }));
}

export function isCurrentView(currentView: string | null | undefined, target: string): boolean {
  return currentView === target;
}
