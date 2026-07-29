import { type Terminal } from '@xterm/xterm';

/**
 * Standalone terminal dimension measurement utilities.
 *
 * Extracted from FitAddon.proposeDimensions() but decoupled from any specific
 * terminal instance — accepts a container element and cell metrics directly.
 * This lets callers measure any DOM element (e.g. PaneSizingProvider's
 * container) without first mounting a terminal inside it.
 */

// xterm's proposed API and internal fields are not in the public TypeScript
// types. Both code paths are necessary: the proposed `dimensions` API works in
// xterm 5.x, while xterm 6.x exposes cell metrics only via `_core`.
interface XtermCellDimensions {
  css?: { cell?: { width?: number; height?: number } };
}

interface XtermInternals {
  dimensions?: XtermCellDimensions;
  _core?: {
    _renderService?: { dimensions?: XtermCellDimensions };
    renderService?: { dimensions?: XtermCellDimensions };
  };
}

const MINIMUM_COLS = 2;
const MINIMUM_ROWS = 1;
// Embedded xterm viewport scrollbars are hidden in index.css, so subtracting
// xterm's addon-fit 14px fallback creates visible fake padding on the right.
export const DEFAULT_XTERM_SCROLLBAR_WIDTH = 0;
// Keep wide glyphs and TUI decoration away from the clipping edge. One column
// absorbs double-width/rounded-background overdraw; the second remains visibly
// blank so narrow panes do not still look clipped at the right edge.
export const TERMINAL_FIT_GUARD_COLUMNS = 2;

export interface TerminalDimensions {
  cols: number;
  rows: number;
}

/**
 * Resolve the box that actually clips xterm's rendered rows.
 *
 * Once mounted, xterm's direct parent is the same source of truth used by
 * FitAddon. Pane wrappers remain useful before the owned terminal scene has
 * been attached, but can be wider than a nested terminal host.
 */
export function resolveTerminalFitContainer(
  terminalParent: HTMLElement | null,
  mountTarget: HTMLElement | null,
  paneContainer: HTMLElement | null
): HTMLElement | null {
  return terminalParent ?? mountTarget ?? paneContainer;
}

function readDimensions(read: () => XtermCellDimensions | undefined): XtermCellDimensions | null {
  try {
    return read() ?? null;
  } catch {
    return null;
  }
}

function toCellMetrics(dims: XtermCellDimensions | null): { width: number; height: number } | null {
  const width = dims?.css?.cell?.width;
  const height = dims?.css?.cell?.height;
  if (typeof width !== 'number' || typeof height !== 'number') return null;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

function cssPixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getContentBox(container: HTMLElement): { width: number; height: number } {
  const rect = container.getBoundingClientRect();
  const style = window.getComputedStyle(container);
  const horizontalInsets =
    cssPixels(style.borderLeftWidth) +
    cssPixels(style.borderRightWidth) +
    cssPixels(style.paddingLeft) +
    cssPixels(style.paddingRight);
  const verticalInsets =
    cssPixels(style.borderTopWidth) +
    cssPixels(style.borderBottomWidth) +
    cssPixels(style.paddingTop) +
    cssPixels(style.paddingBottom);
  return {
    width: Math.max(0, rect.width - horizontalInsets),
    height: Math.max(0, rect.height - verticalInsets),
  };
}

export function getCellMetrics(terminal: Terminal): { width: number; height: number } | null {
  const t = terminal as unknown as XtermInternals;
  // Proposed API (xterm 5.x). Undefined on the public Terminal in xterm 6.x.
  const proposedMetrics = toCellMetrics(readDimensions(() => t.dimensions));
  if (proposedMetrics) return proposedMetrics;

  // xterm 6.x: the public Terminal delegates to `_core` (the internal Terminal instance).
  // FitAddon receives this same internal object via addon.activate(terminal).
  const core = t._core;
  return (
    toCellMetrics(readDimensions(() => core?._renderService?.dimensions)) ??
    toCellMetrics(readDimensions(() => core?.renderService?.dimensions))
  );
}

export function getTerminalFitScrollbarWidth(terminal: Terminal): number {
  if (terminal.options.scrollback === 0) return 0;
  // xterm 6.1 moved overviewRuler under scrollbar. Read both shapes so live
  // terminals survive HMR/version transitions without a fit regression.
  const options = terminal.options as typeof terminal.options & {
    overviewRuler?: { width?: number };
    scrollbar?: { width?: number };
  };
  const width = options.scrollbar?.width ?? options.overviewRuler?.width;
  return typeof width === 'number' && Number.isFinite(width) && width > 0
    ? width
    : DEFAULT_XTERM_SCROLLBAR_WIDTH;
}

/**
 * Compute terminal cols/rows from a container element's pixel dimensions and
 * the terminal's CSS cell size.
 *
 * @param container  The element whose CSS width/height defines the available area.
 * @param cellWidth  Terminal cell width in CSS pixels (terminal.dimensions.css.cell.width).
 * @param cellHeight Terminal cell height in CSS pixels (terminal.dimensions.css.cell.height).
 * @param scrollbarWidth Width in pixels to subtract for the scrollbar (0 when scrollback=0).
 * @param guardColumns Extra columns to reserve for glyph/font rounding at the right edge.
 */
export function measureDimensions(
  container: HTMLElement,
  cellWidth: number,
  cellHeight: number,
  scrollbarWidth = 0,
  guardColumns = 0
): TerminalDimensions | null {
  if (
    !Number.isFinite(cellWidth) ||
    !Number.isFinite(cellHeight) ||
    cellWidth <= 0 ||
    cellHeight <= 0
  ) {
    return null;
  }
  const { width, height } = getContentBox(container);
  if (width === 0 || height === 0) return null;
  const availableWidth = Math.max(0, width - Math.max(0, scrollbarWidth));
  const availableCols = Math.floor(availableWidth / cellWidth) - Math.max(0, guardColumns);
  return {
    cols: Math.max(MINIMUM_COLS, availableCols),
    rows: Math.max(MINIMUM_ROWS, Math.floor(height / cellHeight)),
  };
}
