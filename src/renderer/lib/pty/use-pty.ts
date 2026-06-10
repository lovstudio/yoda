import { type Terminal } from '@xterm/xterm';
import { useCallback, useEffect, useRef } from 'react';
import type { AppSettings } from '@shared/app-settings';
import { appPasteChannel } from '@shared/events/appEvents';
import { ptyDataChannel, ptyExitChannel } from '@shared/events/ptyEvents';
import { DEFAULT_TERMINAL_SCROLLBACK_LINES } from '@shared/terminal-settings';
import { events, rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { usePaneSizingContext } from './pane-sizing-context';
import { buildTerminalFontFamily, buildTheme, FrontendPty, type SessionTheme } from './pty';
import {
  getCellMetrics,
  getTerminalFitScrollbarWidth,
  measureDimensions,
  TERMINAL_FIT_GUARD_COLUMNS,
} from './pty-dimensions';
import { isRealTaskInput, SubmittedInputBuffer } from './pty-input-buffer';
import {
  CTRL_J_ASCII,
  CTRL_U_ASCII,
  shouldCopySelectionFromTerminal,
  shouldHandleInterruptFromTerminal,
  shouldKillLineFromTerminal,
  shouldMapShiftEnterToCtrlJ,
  shouldPasteToTerminal,
} from './pty-keybindings';
import {
  getTerminalFileLinkAtCell,
  registerTerminalFileLinkProvider,
  type TerminalFileLinkOptions,
} from './terminal-file-links';
import { registerTerminalImeDiagnostics } from './terminal-ime-diagnostics';
import { registerTerminalImeNativePunctuation } from './terminal-ime-native-punctuation';
import { isTerminalLinkActivation } from './terminal-link-activation';
import type { TerminalLinkTarget } from './terminal-link-target';
import { TERMINAL_RELAYOUT_EVENT } from './terminal-relayout';
import { getTerminalWebLinkAtCell, registerTerminalWebLinkProvider } from './terminal-web-links';

/**
 * Minimum spacing between terminal commits during a continuous resize
 * stream.  A commit (snapshot + grid reflow + PTY broadcast) costs 10-25ms
 * of main-thread time; committing on every RO event during a fast drag
 * saturated the thread and starved pointer handling — the panels themselves
 * lagged behind the mouse (measured: input 3000px/s, panel tracking
 * ~1500px/s with 70ms frame gaps).  Column crossings during normal-speed
 * drags stay under this rate and commit immediately; only fast bursts are
 * spaced out.  Enforced via an rAF chain — no timers, and the trailing
 * commit always lands on the final size.
 */
const TERMINAL_COMMIT_MIN_INTERVAL_MS = 64;
const MIN_TERMINAL_COLS = 2;
const MIN_TERMINAL_ROWS = 1;
/** Layout-not-ready retries advance one frame at a time (~400ms at 60fps). */
const MAX_LAYOUT_READY_RETRIES = 24;
const MIN_READY_TERMINAL_COLS = 10;
const FORCE_SELECTION_DRAG_THRESHOLD_PX = 2;
const IS_MAC_PLATFORM =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

type BufferCellPosition = {
  col: number;
  row: number;
  linear: number;
};

function getTerminalScreenElement(terminalElement: HTMLElement): HTMLElement {
  return terminalElement.querySelector<HTMLElement>('.xterm-screen') ?? terminalElement;
}

function getBufferCellFromMouseEvent(
  terminal: Terminal,
  terminalElement: HTMLElement,
  event: MouseEvent
): BufferCellPosition | null {
  const cell = getCellMetrics(terminal);
  if (!cell) return null;

  const screen = getTerminalScreenElement(terminalElement);
  const rect = screen.getBoundingClientRect();
  const col = Math.max(
    0,
    Math.min(terminal.cols - 1, Math.floor((event.clientX - rect.left) / cell.width))
  );
  const viewportRow = Math.max(
    0,
    Math.min(terminal.rows - 1, Math.floor((event.clientY - rect.top) / cell.height))
  );
  const row = terminal.buffer.active.viewportY + viewportRow;
  return {
    col,
    row,
    linear: row * terminal.cols + col,
  };
}

function selectBetweenBufferCells(
  terminal: Terminal,
  anchor: BufferCellPosition,
  focus: BufferCellPosition
): void {
  const start = Math.min(anchor.linear, focus.linear);
  const end = Math.max(anchor.linear, focus.linear) + 1;
  const length = end - start;
  if (length <= 0) return;
  terminal.select(start % terminal.cols, Math.floor(start / terminal.cols), length);
}

interface MeasureAndResizeOptions {
  forceRefresh?: boolean;
  resetResizeDedup?: boolean;
}

function isMeasureTargetReady(
  element: HTMLElement,
  cell: { width: number; height: number }
): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width >= cell.width * MIN_READY_TERMINAL_COLS && rect.height >= cell.height;
}

function refreshTerminal(terminal: Terminal): void {
  try {
    terminal.refresh(0, Math.max(0, terminal.rows - 1));
  } catch {}
}

function hasEnterSubmit(data: string): boolean {
  return data.includes('\r') || /\x1b\[13(?:;[0-9]+)?u/.test(data);
}

export interface UsePtyOptions {
  /** Deterministic PTY session ID: makePtySessionId(projectId, scopeId, leafId). */
  sessionId: string;
  /** Pre-connected FrontendPty instance owned by the entity's PtySession store. */
  pty: FrontendPty;
  theme?: SessionTheme;
  mapShiftEnterToCtrlJ?: boolean;
  onActivity?: () => void;
  onExit?: (info: { exitCode: number | undefined; signal?: number }) => void;
  onFirstMessage?: (message: string) => void;
  onEnterPress?: (message: string) => void;
  onSubmittedInput?: (message: string, isTaskInput: boolean) => void;
  onInterruptPress?: () => void;
  fileLinks?: TerminalFileLinkOptions | null;
}

export interface UseTerminalReturn {
  focus: () => void;
  setTheme: (theme: SessionTheme) => void;
  sendInput: (data: string, options?: { track?: boolean }) => void;
  getLinkTargetAtEvent: (event: MouseEvent) => TerminalLinkTarget | null;
}

/**
 * React hook that manages a full xterm.js terminal instance attached to
 * `containerRef`, wired to a PTY session via the deterministic `sessionId`.
 *
 * Each session owns a persistent FrontendPty (terminal + renderer)
 * for its full lifetime.  On unmount the terminal's ownedContainer is
 * reparented to the off-screen xterm host rather than disposed, so scrollback
 * is preserved across tab switches.
 *
 * For sessions pre-registered via PtySessionProvider the mount is effectively
 * synchronous (no await needed).  Standalone sessions (not pre-registered)
 * are auto-registered inside an async IIFE, awaiting the historical buffer
 * fetch before mounting.
 *
 * When inside a PaneSizingProvider the terminal is pre-resized to the pane's
 * current dimensions BEFORE being appended to the visible DOM, eliminating
 * the flash caused by a post-mount resize.
 */
export function usePty(
  options: UsePtyOptions,
  containerRef: React.RefObject<HTMLElement | null>
): UseTerminalReturn {
  const {
    sessionId,
    pty,
    theme,
    mapShiftEnterToCtrlJ,
    onActivity,
    onExit,
    onFirstMessage,
    onEnterPress,
    onSubmittedInput,
    onInterruptPress,
    fileLinks,
  } = options;

  // Stable refs for callbacks so the effect doesn't re-run on every render.
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onFirstMessageRef = useRef(onFirstMessage);
  onFirstMessageRef.current = onFirstMessage;
  const onEnterPressRef = useRef(onEnterPress);
  onEnterPressRef.current = onEnterPress;
  const onSubmittedInputRef = useRef(onSubmittedInput);
  onSubmittedInputRef.current = onSubmittedInput;
  const onInterruptPressRef = useRef(onInterruptPress);
  onInterruptPressRef.current = onInterruptPress;
  const fileLinksRef = useRef(fileLinks ?? null);
  fileLinksRef.current = fileLinks ?? null;
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // When inside a PaneSizingProvider, PTY resizes are broadcast to ALL sessions
  // in the pane (including background ones).  Falls back to per-session resize
  // for standalone terminals (chat, task terminal panel, etc.).
  const paneSizing = usePaneSizingContext();
  // Ref so the main effect (which only re-runs on sessionId change) always
  // accesses the latest context value without needing it as a dependency.
  const paneSizingRef = useRef(paneSizing);
  paneSizingRef.current = paneSizing;

  // Core xterm.js reference, kept alive across renders.
  const termRef = useRef<Terminal | null>(null);

  // Resize dedup state.
  const lastSentResizeRef = useRef<{ cols: number; rows: number } | null>(null);

  // First-message capture state.
  const firstMessageSentRef = useRef(false);
  const inputBufferRef = useRef('');

  // Tracks submitted user input while filtering terminal control traffic.
  const submittedInputBufferRef = useRef(new SubmittedInputBuffer());

  // Track whether the PTY has started (to filter focus reporting escape sequences).
  const ptyStartedRef = useRef(false);

  // Auto-copy on selection
  const autoCopyOnSelectionRef = useRef(false);

  // ─── Helpers ───────────────────────────────────────────────────────────────

  // Sends the PTY resize immediately (deduped); called in the same tick as
  // the grid commit so the SIGWINCH corresponds to exactly that grid size.
  const sendPtyResize = useCallback(
    (newCols: number, newRows: number) => {
      const c = Math.max(MIN_TERMINAL_COLS, Math.floor(newCols));
      const r = Math.max(MIN_TERMINAL_ROWS, Math.floor(newRows));
      const last = lastSentResizeRef.current;
      if (last?.cols === c && last?.rows === r) return;
      lastSentResizeRef.current = { cols: c, rows: r };
      FrontendPty.noteResize(sessionId, c, r);
      void rpc.pty.resize(sessionId, c, r);
    },
    [sessionId]
  );

  // Stable ref so measureAndResize can always call the latest sendPtyResize
  // without needing it as a useCallback dependency.
  const sendPtyResizeRef = useRef(sendPtyResize);
  sendPtyResizeRef.current = sendPtyResize;

  // Layout not ready yet — try again next frame (event-driven: rAF is the
  // browser telling us a new layout pass has happened).
  const retryMeasureAndResize = useCallback(
    (retries: number, options?: MeasureAndResizeOptions) => {
      if (retries >= MAX_LAYOUT_READY_RETRIES) return false;
      requestAnimationFrame(() => measureAndResizeRef.current(retries + 1, options));
      return true;
    },
    []
  );

  // measureAndResize is the single entry point for all DOM measurement + PTY
  // resize work, and runs SYNCHRONOUSLY in the caller's tick: measure the
  // live DOM, commit the grid resize (FrontendPty.commitResize hides the
  // transition behind a snapshot overlay, so no frame-phase gymnastics are
  // needed here), then broadcast the PTY resize in the same tick.
  const measureAndResize = useCallback(
    (retries = 0, options: MeasureAndResizeOptions = {}) => {
      if (!termRef.current) return;
      if (options.resetResizeDedup) {
        lastSentResizeRef.current = null;
      }
      try {
        const term = termRef.current;
        const pane = paneSizingRef.current;

        const cell = getCellMetrics(term);
        if (!cell) {
          retryMeasureAndResize(retries, options);
          return;
        }

        // Prefer the pane wrapper: it is stable before the terminal's owned
        // container has fully settled after being reparented from the off-screen host.
        const termParent = (term as unknown as { element?: HTMLElement }).element?.parentElement;
        const measureTarget =
          pane?.containerRef.current ?? termParent ?? (containerRef.current as HTMLElement | null);
        if (!measureTarget) return;
        const scrollbarWidth = getTerminalFitScrollbarWidth(term);

        if (!isMeasureTargetReady(measureTarget, cell) && retryMeasureAndResize(retries, options)) {
          return;
        }

        const dims =
          pane?.measureCurrentDimensions(
            cell.width,
            cell.height,
            scrollbarWidth,
            TERMINAL_FIT_GUARD_COLUMNS
          ) ??
          measureDimensions(
            measureTarget,
            cell.width,
            cell.height,
            scrollbarWidth,
            TERMINAL_FIT_GUARD_COLUMNS
          );
        if (!dims) {
          retryMeasureAndResize(retries, options);
          return;
        }
        const { cols: targetCols, rows: targetRows } = dims;

        let didResize = false;
        if (term.cols !== targetCols || term.rows !== targetRows) {
          pty.commitResize(targetCols, targetRows);
          didResize = true;
        }

        if (options.forceRefresh && !didResize) {
          refreshTerminal(term);
        }

        // Now that the terminal is sized to the real pane width, drain any
        // output that was buffered while it was off-screen at default cols.
        pty.flushPendingWrites();

        // PTY resize goes out in the same tick as the grid commit, so the
        // app's SIGWINCH repaint corresponds to exactly this grid size.
        if (pane) {
          pane.reportDimensions(targetCols, targetRows);
        } else {
          sendPtyResizeRef.current(targetCols, targetRows);
        }
      } catch (e) {
        log.warn('useTerminal: measureAndResize failed', { sessionId, error: e });
      }
    },
    [sessionId, containerRef, pty, retryMeasureAndResize]
  );

  // Stable ref so the retry setTimeout inside measureAndResize always calls
  // the latest version without creating a circular useCallback dependency.
  const measureAndResizeRef = useRef(measureAndResize);
  measureAndResizeRef.current = measureAndResize;

  // Frame-coalesced commit scheduler for the ResizeObserver stream: one
  // pending commit at a time, executed on a rAF (latest layout wins), spaced
  // by TERMINAL_COMMIT_MIN_INTERVAL_MS during bursts.  Keeps the expensive
  // terminal work off the pointer-event hot path so panel drags stay glued
  // to the mouse.
  const pendingCommitRef = useRef(false);
  const lastCommitAtRef = useRef(0);
  const scheduleCommit = useCallback(() => {
    if (pendingCommitRef.current) return;
    pendingCommitRef.current = true;
    const tick = () => {
      if (!pendingCommitRef.current) return;
      if (!termRef.current) {
        pendingCommitRef.current = false;
        return;
      }
      if (performance.now() - lastCommitAtRef.current < TERMINAL_COMMIT_MIN_INTERVAL_MS) {
        requestAnimationFrame(tick);
        return;
      }
      pendingCommitRef.current = false;
      lastCommitAtRef.current = performance.now();
      measureAndResizeRef.current();
    };
    requestAnimationFrame(tick);
  }, []);

  const applyTheme = useCallback((t?: SessionTheme) => {
    if (!termRef.current) return;
    termRef.current.options.theme = buildTheme(t);
  }, []);

  const setTheme = useCallback(
    (t: SessionTheme) => {
      applyTheme(t);
    },
    [applyTheme]
  );

  const focus = useCallback(() => {
    if (document.activeElement?.closest('[role="dialog"]')) return;
    termRef.current?.focus();
  }, []);

  const copySelectionToClipboard = useCallback(() => {
    const selection = termRef.current?.getSelection();
    if (!selection) return;

    void rpc.app
      .clipboardWriteText(selection)
      .then((result) => {
        if (result?.success) return;
        return navigator.clipboard?.writeText(selection);
      })
      .catch(() => navigator.clipboard?.writeText(selection).catch(() => {}));
  }, []);

  const sendInput = useCallback(
    (data: string, options?: { track?: boolean }) => {
      const shouldTrack = options?.track ?? true;
      if (shouldTrack) {
        const submittedMessages = submittedInputBufferRef.current.feed(data);
        if (submittedMessages.length === 0 && hasEnterSubmit(data)) {
          onSubmittedInputRef.current?.('', false);
        }
        for (const message of submittedMessages) {
          const isTaskInput = isRealTaskInput(message);
          onSubmittedInputRef.current?.(message, isTaskInput);
          if (isTaskInput) {
            onEnterPressRef.current?.(message);
          }
        }
      }
      void rpc.pty.sendInput(sessionId, data);
    },
    [sessionId]
  );

  const getLinkTargetAtEvent = useCallback((event: MouseEvent): TerminalLinkTarget | null => {
    const terminal = termRef.current;
    const terminalElement = (terminal as unknown as { element?: HTMLElement } | null)?.element;
    if (!terminal || !terminalElement) return null;

    const cell = getBufferCellFromMouseEvent(terminal, terminalElement, event);
    if (!cell) return null;

    const position = { x: cell.col + 1, y: cell.row + 1 };
    const fileOptions = fileLinksRef.current;
    if (fileOptions) {
      const fileMatch = getTerminalFileLinkAtCell(terminal, cell.row + 1, position, fileOptions);
      if (fileMatch) return { kind: 'file', target: fileMatch.target };
    }

    const webMatch = getTerminalWebLinkAtCell(terminal, cell.row + 1, position);
    if (webMatch) return { kind: 'url', url: webMatch.url };

    return null;
  }, []);

  const pasteFromClipboard = useCallback(() => {
    navigator.clipboard
      .readText()
      .then((text) => {
        if (text) sendInput(text);
      })
      .catch(() => {});
  }, [sendInput]);

  // ─── Main effect: mount terminal once per sessionId ────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── Compute targetDims synchronously ─────────────────────────────────────
    // Reads the previous session's terminal cell metrics before overwriting
    // termRef. PaneSizingContext dimensions are also sampled here so the
    // pre-resize happens against the live pane dimensions.
    const pane = paneSizingRef.current;
    const previousTerm = termRef.current;
    const prevCell = previousTerm ? getCellMetrics(previousTerm) : null;
    let targetDims: { cols: number; rows: number } | undefined;

    if (pane?.containerRef.current && previousTerm && prevCell) {
      const measured = measureDimensions(
        pane.containerRef.current,
        prevCell.width,
        prevCell.height,
        getTerminalFitScrollbarWidth(previousTerm),
        TERMINAL_FIT_GUARD_COLUMNS
      );
      if (measured) targetDims = measured;
    }

    if (!targetDims && pane) {
      targetDims = pane.getCurrentDimensions() ?? undefined;
    }

    // ── Mount ─────────────────────────────────────────────────────────────────
    // pty is pre-connected by PtySession before TerminalPane renders, so no
    // async work is needed here.
    const cleanups: (() => void)[] = [];

    {
      const frontendPty = pty;
      termRef.current = frontendPty.terminal;

      // Apply current theme before mounting (in case it differs from the
      // theme the terminal was constructed with).
      frontendPty.terminal.options.theme = buildTheme(themeRef.current);
      frontendPty.terminal.options.macOptionClickForcesSelection = true;

      // Mount: pre-resize then appendChild (flash-free).
      frontendPty.mount(container as HTMLElement, targetDims);

      // Always sync after mounting — targetDims may be stale if the pane was
      // resized while this session was off-screen.  measureAndResize defers to
      // rAF so it reads the live DOM and only calls term.resize() when needed.
      measureAndResize();

      // ── Load settings ──────────────────────────────────────────────────────
      let customFontFamily = '';
      void (rpc.appSettings.get('terminal') as Promise<AppSettings['terminal']>).then(
        (terminalSettings) => {
          if (terminalSettings?.fontFamily) {
            customFontFamily = terminalSettings.fontFamily.trim();
            if (customFontFamily) {
              frontendPty.terminal.options.fontFamily = buildTerminalFontFamily(customFontFamily);
            }
          }
          frontendPty.setScrollbackLines(
            terminalSettings?.scrollbackLines ?? DEFAULT_TERMINAL_SCROLLBACK_LINES
          );
          autoCopyOnSelectionRef.current = terminalSettings?.autoCopyOnSelection ?? false;
        }
      );

      // ── DECRQM xterm.js 6.0 bug workaround ────────────────────────────────
      const terminal = frontendPty.terminal;
      try {
        const parser = (
          terminal as unknown as {
            parser?: { registerCsiHandler?: (...args: unknown[]) => { dispose(): void } };
          }
        ).parser;
        if (parser?.registerCsiHandler) {
          const ansiDisp = parser.registerCsiHandler(
            { intermediates: '$', final: 'p' },
            (params: (number | number[])[]) => {
              const mode = (params[0] as number) ?? 0;
              sendInput(`\x1b[${mode};0$y`, { track: false });
              return true;
            }
          );
          const decDisp = parser.registerCsiHandler(
            { prefix: '?', intermediates: '$', final: 'p' },
            (params: (number | number[])[]) => {
              const mode = (params[0] as number) ?? 0;
              sendInput(`\x1b[?${mode};0$y`, { track: false });
              return true;
            }
          );
          cleanups.push(
            () => ansiDisp.dispose(),
            () => decDisp.dispose()
          );
        }
      } catch (err) {
        log.warn('useTerminal: failed to register DECRQM workaround', { error: err });
      }

      // ── Keyboard shortcuts ─────────────────────────────────────────────────
      const imeNativePunctuationBridge = registerTerminalImeNativePunctuation(terminal);
      cleanups.push(() => imeNativePunctuationBridge.dispose());

      terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        if (document.querySelector('[role="dialog"]')) return false;

        if (imeNativePunctuationBridge.shouldDeferToNativeInput(event)) {
          return false;
        }

        if (shouldCopySelectionFromTerminal(event, IS_MAC_PLATFORM, terminal.hasSelection())) {
          event.preventDefault();
          event.stopImmediatePropagation();
          event.stopPropagation();
          copySelectionToClipboard();
          return false;
        }

        if (shouldPasteToTerminal(event, IS_MAC_PLATFORM)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          event.stopPropagation();
          pasteFromClipboard();
          return false;
        }

        if (mapShiftEnterToCtrlJ && shouldMapShiftEnterToCtrlJ(event)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          event.stopPropagation();
          sendInput(CTRL_J_ASCII);
          return false;
        }

        if (shouldKillLineFromTerminal(event, IS_MAC_PLATFORM)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          event.stopPropagation();
          sendInput(CTRL_U_ASCII);
          return false;
        }

        if (shouldHandleInterruptFromTerminal(event)) {
          onInterruptPressRef.current?.();
          return true;
        }

        if (
          IS_MAC_PLATFORM &&
          event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            event.stopImmediatePropagation();
            event.stopPropagation();
            sendInput('\x01');
            return false;
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            event.stopImmediatePropagation();
            event.stopPropagation();
            sendInput('\x05');
            return false;
          }
        }

        return true;
      });

      // ── Handle terminal input ──────────────────────────────────────────────
      const handleTerminalInput = (data: string) => {
        onActivityRef.current?.();

        // xterm.js auto-answers Device Attributes queries (`\x1b[c` / `\x1b[>c`)
        // by emitting the reply back through onData. Inside tmux the inner agent's
        // query is already answered by tmux's own emulation, so this outer reply is
        // a duplicate that tmux passes through to the pane as literal input — it
        // surfaces in the prompt box as stray text like `0;276;0c`. Drop the
        // Primary (`\x1b[?...c`) and Secondary (`\x1b[>...c`) DA replies; they are
        // never legitimate keystrokes.
        let filtered = data.replace(/\x1b\[[?>][0-9;]*c/g, '');
        if (!ptyStartedRef.current) {
          filtered = filtered.replace(/\x1b\[I|\x1b\[O/g, '');
        }
        if (!filtered) return;

        // First-message capture
        if (!firstMessageSentRef.current && onFirstMessageRef.current) {
          inputBufferRef.current += filtered;
          const newlineIndex = inputBufferRef.current.indexOf('\r');
          if (newlineIndex !== -1) {
            const message = inputBufferRef.current.slice(0, newlineIndex);
            onFirstMessageRef.current(message);
            firstMessageSentRef.current = true;
          }
        }

        sendInput(filtered);
      };

      const inputDisposable = terminal.onData((data) => handleTerminalInput(data));
      cleanups.push(() => inputDisposable.dispose());

      const imeDiagnosticsDisposable = registerTerminalImeDiagnostics(terminal);
      cleanups.push(() => imeDiagnosticsDisposable.dispose());

      const fileLinkProviderDisposable = registerTerminalFileLinkProvider(
        terminal,
        () => fileLinksRef.current
      );
      cleanups.push(() => fileLinkProviderDisposable.dispose());

      const webLinkProviderDisposable = registerTerminalWebLinkProvider(terminal, () => ({
        onOpen: (url) => {
          rpc.app.openExternal(url).catch((error) => {
            log.warn('Failed to open URL from terminal', { url, error });
          });
        },
      }));
      cleanups.push(() => webLinkProviderDisposable.dispose());

      // ── ptyStartedRef — detect first PTY output ────────────────────────────
      // FrontendPty owns the data subscription and writes directly to the
      // terminal.  We add a lightweight IPC listener here solely to flip the
      // ptyStartedRef flag, which is used to suppress focus-reporting escape
      // sequences before the PTY shell has initialised.
      const offPtyData = events.on(
        ptyDataChannel,
        () => {
          ptyStartedRef.current = true;
        },
        sessionId
      );
      cleanups.push(offPtyData);

      // ── Auto-copy on selection ─────────────────────────────────────────────
      let selectionCopyTimer: ReturnType<typeof setTimeout> | null = null;
      let selectionGestureStart: string | null = null;
      const queueSelectionCopy = (
        delay: number,
        shouldCopySelection: (selection: string) => boolean = () => true
      ) => {
        if (!autoCopyOnSelectionRef.current) return;
        if (selectionCopyTimer) clearTimeout(selectionCopyTimer);
        selectionCopyTimer = setTimeout(() => {
          selectionCopyTimer = null;
          const selection = terminal.getSelection();
          if (!selection || !shouldCopySelection(selection)) return;
          copySelectionToClipboard();
        }, delay);
      };
      const selectionDisposable = terminal.onSelectionChange(() => {
        if (!autoCopyOnSelectionRef.current) return;
        if (!terminal.hasSelection()) return;
        queueSelectionCopy(150);
      });
      cleanups.push(() => {
        selectionDisposable.dispose();
        if (selectionCopyTimer) clearTimeout(selectionCopyTimer);
      });

      const terminalElement = (terminal as unknown as { element?: HTMLElement }).element;
      if (terminalElement) {
        const terminalDocument = terminalElement.ownerDocument;
        let forcedSelection: {
          active: boolean;
          anchor: BufferCellPosition;
          startX: number;
          startY: number;
          viewportY: number;
        } | null = null;
        let viewportRestoreTimeout: ReturnType<typeof setTimeout> | null = null;

        const shouldCapturePlainDragSelection = (event: MouseEvent) => {
          return (
            autoCopyOnSelectionRef.current &&
            event.button === 0 &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.shiftKey
          );
        };

        const stopMouseModeEvent = (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
        };

        const restoreViewportAfterSelection = (viewportY: number) => {
          const restore = () => {
            try {
              if (terminal.buffer.active.viewportY !== viewportY) {
                terminal.scrollToLine(viewportY);
              }
            } catch {}
          };

          requestAnimationFrame(restore);
          if (viewportRestoreTimeout) clearTimeout(viewportRestoreTimeout);
          viewportRestoreTimeout = setTimeout(() => {
            viewportRestoreTimeout = null;
            restore();
          }, 50);
        };

        const openLinkTarget = (target: TerminalLinkTarget) => {
          if (target.kind === 'file') {
            fileLinksRef.current?.onOpen(target.target);
            return;
          }

          rpc.app.openExternal(target.url).catch((error) => {
            log.warn('Failed to open URL from terminal', { url: target.url, error });
          });
        };

        const handleSelectionGestureStart = (event: MouseEvent | TouchEvent) => {
          if (!(event.target instanceof Node)) return;
          if (!terminalElement.contains(event.target)) return;
          if (event instanceof MouseEvent && isTerminalLinkActivation(event)) {
            const linkTarget = getLinkTargetAtEvent(event);
            if (linkTarget) {
              terminal.clearSelection();
              stopMouseModeEvent(event);
              openLinkTarget(linkTarget);
              return;
            }
          }
          selectionGestureStart = terminal.getSelection();
          if (event instanceof MouseEvent && shouldCapturePlainDragSelection(event)) {
            const anchor = getBufferCellFromMouseEvent(terminal, terminalElement, event);
            if (!anchor) return;
            forcedSelection = {
              active: false,
              anchor,
              startX: event.clientX,
              startY: event.clientY,
              viewportY: terminal.buffer.active.viewportY,
            };
          }
        };
        const handleForcedSelectionMouseMove = (event: MouseEvent) => {
          if (!forcedSelection) return;

          if (!forcedSelection.active) {
            const movedX = Math.abs(event.clientX - forcedSelection.startX);
            const movedY = Math.abs(event.clientY - forcedSelection.startY);
            if (Math.max(movedX, movedY) < FORCE_SELECTION_DRAG_THRESHOLD_PX) return;

            forcedSelection.active = true;
          }

          const focus = getBufferCellFromMouseEvent(terminal, terminalElement, event);
          if (!focus) return;
          selectBetweenBufferCells(terminal, forcedSelection.anchor, focus);
          stopMouseModeEvent(event);
        };
        const handleForcedSelectionMouseUp = (event: MouseEvent) => {
          if (!forcedSelection) return;
          const wasActive = forcedSelection.active;
          const viewportY = forcedSelection.viewportY;
          forcedSelection = null;
          if (!wasActive) return;

          selectionGestureStart = null;
          stopMouseModeEvent(event);
          restoreViewportAfterSelection(viewportY);
          queueSelectionCopy(0);
        };
        const handleSelectionGestureEnd = () => {
          if (selectionGestureStart === null) return;
          const startedWithSelection = selectionGestureStart;
          selectionGestureStart = null;
          queueSelectionCopy(0, (selection) => selection !== startedWithSelection);
        };
        const handleSelectionGestureCancel = () => {
          selectionGestureStart = null;
        };

        terminalElement.addEventListener('mousedown', handleSelectionGestureStart, true);
        // passive: the touch path never calls preventDefault, so don't block scrolling.
        terminalElement.addEventListener('touchstart', handleSelectionGestureStart, {
          capture: true,
          passive: true,
        });
        terminalDocument.addEventListener('mousemove', handleForcedSelectionMouseMove, true);
        terminalDocument.addEventListener('mouseup', handleForcedSelectionMouseUp, true);
        terminalDocument.addEventListener('mouseup', handleSelectionGestureEnd, true);
        terminalDocument.addEventListener('touchend', handleSelectionGestureEnd, true);
        terminalDocument.addEventListener('touchcancel', handleSelectionGestureCancel, true);
        cleanups.push(() => {
          forcedSelection = null;
          if (viewportRestoreTimeout) clearTimeout(viewportRestoreTimeout);
          terminalElement.removeEventListener('mousedown', handleSelectionGestureStart, true);
          terminalElement.removeEventListener('touchstart', handleSelectionGestureStart, true);
          terminalDocument.removeEventListener('mousemove', handleForcedSelectionMouseMove, true);
          terminalDocument.removeEventListener('mouseup', handleForcedSelectionMouseUp, true);
          terminalDocument.removeEventListener('mouseup', handleSelectionGestureEnd, true);
          terminalDocument.removeEventListener('touchend', handleSelectionGestureEnd, true);
          terminalDocument.removeEventListener('touchcancel', handleSelectionGestureCancel, true);
        });
      }

      // ── Paste from app menu ────────────────────────────────────────────────
      const offPaste = events.on(appPasteChannel, () => {
        pasteFromClipboard();
      });
      cleanups.push(offPaste);

      // ── PTY exit subscription ──────────────────────────────────────────────
      const offExit = events.on(
        ptyExitChannel,
        (info) => {
          onExitRef.current?.(info as { exitCode: number | undefined; signal?: number });
        },
        sessionId
      );
      cleanups.push(offExit);

      // ── Font / setting change events ───────────────────────────────────────
      const handleFontChange = (e: Event) => {
        const detail = (e as CustomEvent<{ fontFamily?: string }>).detail;
        customFontFamily = detail?.fontFamily?.trim() ?? '';
        terminal.options.fontFamily = buildTerminalFontFamily(customFontFamily);
        measureAndResize();
      };
      const handleAutoCopyChange = (e: Event) => {
        const detail = (e as CustomEvent<{ autoCopyOnSelection?: boolean }>).detail;
        autoCopyOnSelectionRef.current = detail?.autoCopyOnSelection ?? false;
      };
      const handleScrollbackLinesChange = (e: Event) => {
        const detail = (e as CustomEvent<{ scrollbackLines?: number }>).detail;
        frontendPty.setScrollbackLines(
          detail?.scrollbackLines ?? DEFAULT_TERMINAL_SCROLLBACK_LINES
        );
      };
      // Host position changes (tab pin/unpin/reclaim between panes) re-host the
      // terminal without a container size change, so the ResizeObserver never
      // fires and a same-sessionId pane skips its mount measure. Same recipe as
      // the HMR re-fit: clear the dedup so the resize always lands.
      const handleRelayout = () => {
        measureAndResizeRef.current(0, { forceRefresh: true, resetResizeDedup: true });
      };
      window.addEventListener(TERMINAL_RELAYOUT_EVENT, handleRelayout);
      window.addEventListener('terminal-font-changed', handleFontChange);
      window.addEventListener('terminal-auto-copy-changed', handleAutoCopyChange);
      window.addEventListener('terminal-scrollback-lines-changed', handleScrollbackLinesChange);
      cleanups.push(
        () => window.removeEventListener(TERMINAL_RELAYOUT_EVENT, handleRelayout),
        () => window.removeEventListener('terminal-font-changed', handleFontChange),
        () => window.removeEventListener('terminal-auto-copy-changed', handleAutoCopyChange),
        () =>
          window.removeEventListener(
            'terminal-scrollback-lines-changed',
            handleScrollbackLinesChange
          )
      );

      // ── ResizeObserver (observes the mount-target, not the owned container) ─
      // Live per-column tracking (user-chosen), frame-coalesced: RO only
      // marks dirty; the commit runs on a rAF with burst spacing so pointer
      // handling never waits for terminal work.  commitResize dedupes until
      // an integer col/row boundary is crossed, and its freeze overlay makes
      // each commit flash-free regardless of execution phase.
      const resizeObserver = new ResizeObserver(() => {
        scheduleCommit();
      });
      resizeObserver.observe(container);
      cleanups.push(() => resizeObserver.disconnect());

      // ── HMR: re-fit after every Vite update ────────────────────────────────
      // Hot-reload can subtly change xterm cell metrics (font CSS reinjection,
      // padding tweaks) without changing the container's pixel size, so the
      // ResizeObserver never fires and the PTY keeps its stale cols/rows while
      // xterm's canvas re-renders with new cell widths — producing the visual
      // line-wrap glitch that the user has to fix by dragging a divider.
      // Clearing the dedup ref guarantees the broadcast goes through even when
      // measured dims round to the same integer cols/rows as before.
      if (import.meta.hot) {
        const onHmrUpdate = () =>
          measureAndResizeRef.current(0, { forceRefresh: true, resetResizeDedup: true });
        import.meta.hot.on('vite:afterUpdate', onHmrUpdate);
        cleanups.push(() => import.meta.hot?.off('vite:afterUpdate', onHmrUpdate));
      }

      // Chromium can resume a previously backgrounded canvas without changing
      // the observed element size, so redraw the visible terminal explicitly.
      const refreshVisibleTerminal = () => {
        measureAndResizeRef.current(0, { forceRefresh: true });
      };
      const refreshOnVisible = () => {
        if (document.visibilityState === 'visible') refreshVisibleTerminal();
      };
      window.addEventListener('focus', refreshVisibleTerminal);
      document.addEventListener('visibilitychange', refreshOnVisible);
      cleanups.push(
        () => window.removeEventListener('focus', refreshVisibleTerminal),
        () => document.removeEventListener('visibilitychange', refreshOnVisible)
      );
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────
    return () => {
      // Drop any scheduled commit (the rAF tick no-ops on this flag).
      pendingCommitRef.current = false;
      // Reset dedup so the next session always gets a resize on mount.
      lastSentResizeRef.current = null;
      // ResizeObserver.disconnect() and other cleanups run BEFORE unmount —
      // preserving the invariant that the ResizeObserver is torn down before
      // the ownedContainer is reparented off-screen.
      for (const fn of cleanups) {
        try {
          fn();
        } catch {}
      }
      // Return terminal's ownedContainer to the off-screen host.
      pty.unmount();
      termRef.current = null;
      ptyStartedRef.current = false;
      firstMessageSentRef.current = false;
      inputBufferRef.current = '';
      submittedInputBufferRef.current = new SubmittedInputBuffer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, pty]); // Re-run only when the session changes

  // ── Theme update (after initial mount) ──────────────────────────────────────
  useEffect(() => {
    applyTheme(theme);
  }, [theme, applyTheme]);

  return { focus, setTheme, sendInput, getLinkTargetAtEvent };
}
