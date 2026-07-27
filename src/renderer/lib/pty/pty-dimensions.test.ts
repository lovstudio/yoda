import { describe, expect, it } from 'vitest';
import { getCellMetrics, getTerminalFitScrollbarWidth } from './pty-dimensions';

function asTerminal(value: unknown): Parameters<typeof getCellMetrics>[0] {
  return value as Parameters<typeof getCellMetrics>[0];
}

describe('getCellMetrics', () => {
  it('reads xterm 5 proposed dimensions', () => {
    const terminal = asTerminal({
      dimensions: { css: { cell: { width: 8, height: 16 } } },
    });

    expect(getCellMetrics(terminal)).toEqual({ width: 8, height: 16 });
  });

  it('reads xterm 6 render service dimensions', () => {
    const terminal = asTerminal({
      _core: {
        _renderService: { dimensions: { css: { cell: { width: 9, height: 18 } } } },
      },
    });

    expect(getCellMetrics(terminal)).toEqual({ width: 9, height: 18 });
  });

  it('falls back when the primary xterm 6 dimensions getter is not ready', () => {
    const terminal = asTerminal({
      _core: {
        _renderService: {
          get dimensions() {
            throw new TypeError("Cannot read properties of undefined (reading 'dimensions')");
          },
        },
        renderService: { dimensions: { css: { cell: { width: 10, height: 20 } } } },
      },
    });

    expect(getCellMetrics(terminal)).toEqual({ width: 10, height: 20 });
  });

  it('returns null when xterm render dimensions are not ready', () => {
    const terminal = asTerminal({
      _core: {
        _renderService: {
          get dimensions() {
            throw new TypeError("Cannot read properties of undefined (reading 'dimensions')");
          },
        },
      },
    });

    expect(getCellMetrics(terminal)).toBeNull();
  });
});

describe('getTerminalFitScrollbarWidth', () => {
  it('returns 0 when scrollback is disabled', () => {
    const terminal = asTerminal({
      options: { scrollback: 0 },
    });

    expect(getTerminalFitScrollbarWidth(terminal)).toBe(0);
  });

  it('uses the embedded terminal default width when scrollback is enabled', () => {
    const terminal = asTerminal({
      options: { scrollback: 1000 },
    });

    expect(getTerminalFitScrollbarWidth(terminal)).toBe(0);
  });

  it('uses the configured overview ruler width when available', () => {
    const terminal = asTerminal({
      options: { scrollback: 1000, overviewRuler: { width: 8 } },
    });

    expect(getTerminalFitScrollbarWidth(terminal)).toBe(8);
  });

  it('uses the xterm 6.1 scrollbar width when available', () => {
    const terminal = asTerminal({
      options: { scrollback: 1000, scrollbar: { width: 9 } },
    });

    expect(getTerminalFitScrollbarWidth(terminal)).toBe(9);
  });
});
