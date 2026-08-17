/**
 * PaneSizingContext — owns PTY resize for the active session in a pane.
 *
 * The active TerminalPane calls reportDimensions(sessionId, cols, rows) whenever its
 * terminal resizes. The provider forwards that resize only when the reporting
 * session is still active. Background PTYs keep the dimensions that match their
 * off-screen xterm grid; when one becomes active, the existing mount/measure
 * path resizes its xterm and backend together. Pacing is owned by the caller
 * (use-pty throttles measure+resize).
 *
 * Each provider renders a wrapper <div> that fills its parent and registers
 * itself in the module-level paneRegistry under its paneId.  This lets any
 * code outside the React tree (e.g. hover pre-warm, cross-pane coordination)
 * call getPaneContainer(paneId) to measure the pane's pixel dimensions without
 * needing a mounted terminal.
 *
 * Usage:
 *   <PaneSizingProvider
 *     paneId="conversations"
 *     sessionIds={allConversationSessionIds}
 *     activeSessionId={activeSessionId}
 *   >
 *     ...
 *     <TerminalPane sessionId={activeSessionId} />
 *   </PaneSizingProvider>
 *
 * For split panes (e.g. conversation pane + right-panel terminal pane), each
 * pane gets its own <PaneSizingProvider> with a distinct paneId.  No other
 * changes required.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { FrontendPty } from './pty';
import { measureDimensions, type TerminalDimensions } from './pty-dimensions';
import { resizeBackendPty } from './pty-resize-authority';

const MIN_TERMINAL_COLS = 2;
const MIN_TERMINAL_ROWS = 1;

// ── Module-level pane registry ────────────────────────────────────────────────
// Maps paneId → the provider's container HTMLDivElement.  Survives renders and
// is accessible from anywhere in the renderer process (e.g. sidebar hover
// handlers, cross-pane coordinators).
const paneRegistry = new Map<string, HTMLDivElement>();

/**
 * Returns the container element for the given pane, or null if the pane is not
 * currently mounted.  Use this to measure pane pixel dimensions from outside
 * the React tree.
 */
export function getPaneContainer(paneId: string): HTMLDivElement | null {
  return paneRegistry.get(paneId) ?? null;
}

// ── Context interface ─────────────────────────────────────────────────────────

export interface PaneSizingContextValue {
  /**
   * The session that currently owns this pane's backend resize authority.
   *
   * A terminal can mount and measure while task-open staging deliberately keeps
   * this null. Consumers must observe the later ownership handoff even when the
   * pane's pixel geometry did not change, otherwise xterm and the backend TUI
   * can remain on different row counts until an unrelated layout resize.
   */
  activeSessionId: string | null;
  /**
   * Called by a terminal after every resize. The report is forwarded only when
   * reportSessionId is the pane's current active session; stale reports from a
   * terminal being unmounted are ignored.
   */
  reportDimensions: (reportSessionId: string, cols: number, rows: number) => void;
  /**
   * Returns the last dimensions reported to this pane, or null if no terminal
   * has reported dimensions yet.  Used as a fallback when cell metrics are
   * unavailable (very first mount).
   */
  getCurrentDimensions: () => { cols: number; rows: number } | null;
  /**
   * Ref to the provider's own wrapper div.  Always reflects the pane's current
   * pixel size; suitable as the container argument to measureDimensions().
   */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /**
   * Measures the pane container using the provided cell metrics and returns
   * cols/rows, or null if the container is not yet sized.  More accurate than
   * getCurrentDimensions() when cell metrics are available because it reads the
   * live DOM instead of a cached value.
   */
  measureCurrentDimensions: (
    cellWidth: number,
    cellHeight: number,
    scrollbarWidth?: number,
    guardColumns?: number
  ) => TerminalDimensions | null;
}

const PaneSizingContext = createContext<PaneSizingContextValue | null>(null);

/**
 * Returns the nearest PaneSizingContext value, or null when the terminal is
 * not inside a PaneSizingProvider (e.g. standalone chat terminals).
 */
export function usePaneSizingContext(): PaneSizingContextValue | null {
  return useContext(PaneSizingContext);
}

// ── Provider ──────────────────────────────────────────────────────────────────

interface PaneSizingProviderProps {
  /** Stable identifier for this pane.  Used to register in the module-level
   *  paneRegistry so code outside the React tree can measure this pane. */
  paneId: string;
  /** All session IDs that belong to this pane. Used to validate activeSessionId. */
  sessionIds: string[];
  /** The only session whose xterm and backend PTY may be resized by this pane. */
  activeSessionId: string | null;
  /** Delay external measurement until layout-affecting settings are authoritative. */
  registrationEnabled?: boolean;
  children: ReactNode;
}

export function PaneSizingProvider({
  paneId,
  sessionIds,
  activeSessionId,
  registrationEnabled = true,
  children,
}: PaneSizingProviderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastDimensionsRef = useRef<{ cols: number; rows: number } | null>(null);
  const validActiveSessionId =
    activeSessionId && sessionIds.includes(activeSessionId) ? activeSessionId : null;

  // Register/unregister this pane in the module-level registry.
  useEffect(() => {
    if (!registrationEnabled) return;
    const el = containerRef.current;
    if (!el) return;
    paneRegistry.set(paneId, el);
    return () => {
      paneRegistry.delete(paneId);
    };
  }, [paneId, registrationEnabled]);

  const reportDimensions = useCallback(
    (reportSessionId: string, cols: number, rows: number) => {
      if (!validActiveSessionId || reportSessionId !== validActiveSessionId) return;

      const dims = {
        cols: Math.max(MIN_TERMINAL_COLS, cols),
        rows: Math.max(MIN_TERMINAL_ROWS, rows),
      };
      lastDimensionsRef.current = dims;
      // Keep dedup per session: pin/unpin can move the active session between
      // panes, and a restarted session gets a new FrontendPty with no prior dims.
      // When activeSessionId is explicitly null (standalone board observer panes),
      // xterm still resizes locally but the backend PTY is not touched — only
      // the pane that owns the session can resize its backend dimensions.
      if (FrontendPty.noteResize(validActiveSessionId, dims.cols, dims.rows)) {
        resizeBackendPty(validActiveSessionId, dims.cols, dims.rows);
      }
    },
    [validActiveSessionId]
  );

  const getCurrentDimensions = useCallback(
    (): { cols: number; rows: number } | null => lastDimensionsRef.current,
    []
  );

  const measureCurrentDimensions = useCallback(
    (
      cellWidth: number,
      cellHeight: number,
      scrollbarWidth = 0,
      guardColumns = 0
    ): TerminalDimensions | null => {
      const el = containerRef.current;
      if (!el) return null;
      return measureDimensions(el, cellWidth, cellHeight, scrollbarWidth, guardColumns);
    },
    []
  );

  const value = useMemo(
    () => ({
      activeSessionId: validActiveSessionId,
      reportDimensions,
      getCurrentDimensions,
      containerRef,
      measureCurrentDimensions,
    }),
    [validActiveSessionId, reportDimensions, getCurrentDimensions, measureCurrentDimensions]
  );

  return (
    <PaneSizingContext.Provider value={value}>
      <div
        ref={containerRef}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden w-full max-w-full"
      >
        {children}
      </div>
    </PaneSizingContext.Provider>
  );
}
