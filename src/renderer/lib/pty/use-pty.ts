import { type Terminal } from '@xterm/xterm';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { appPasteChannel } from '@shared/events/appEvents';
import { ptyDataChannel, ptyExitChannel, type PtyExitEvent } from '@shared/events/ptyEvents';
import { DEFAULT_TERMINAL_SCROLLBACK_LINES } from '@shared/terminal-settings';
import { imagePathMention, isImagePath } from '@renderer/lib/image-path-mention';
import { events, rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { usePaneSizingContext } from './pane-sizing-context';
import { buildTerminalFontFamily, FrontendPty, type SessionTheme } from './pty';
import {
  getCellMetrics,
  getTerminalFitScrollbarWidth,
  measureDimensions,
  resolveTerminalFitContainer,
  TERMINAL_FIT_GUARD_COLUMNS,
} from './pty-dimensions';
import { isRealTaskInput, SubmittedInputBuffer } from './pty-input-buffer';
import {
  CTRL_J_ASCII,
  CTRL_U_ASCII,
  getWordNavigationInputFromTerminal,
  shouldCopySelectionFromTerminal,
  shouldHandleInterruptFromTerminal,
  shouldKillLineFromTerminal,
  shouldMapShiftEnterToCtrlJ,
  shouldPasteToTerminal,
} from './pty-keybindings';
import { writeTextToClipboard } from './terminal-clipboard';
import type { TerminalFileLinkOptions } from './terminal-file-links';
import { transformTerminalPasteText } from './terminal-image-paste';
import { registerTerminalImeDiagnostics } from './terminal-ime-diagnostics';
import { registerTerminalImeNativePunctuation } from './terminal-ime-native-punctuation';
import { isTerminalLinkActivation } from './terminal-link-activation';
import {
  getTerminalLinkTargetAtCell,
  registerTerminalLinkProviders,
} from './terminal-link-resolver';
import type { TerminalLinkTarget } from './terminal-link-target';
import { TERMINAL_RELAYOUT_EVENT } from './terminal-relayout';
import { loadTerminalSettings } from './terminal-settings-cache';
import type { TerminalWebLinkOptions } from './terminal-web-links';

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

function isMeasureTargetReady(
  element: HTMLElement,
  cell: { width: number; height: number }
): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width >= cell.width * MIN_READY_TERMINAL_COLS && rect.height >= cell.height;
}

function hasEnterSubmit(data: string): boolean {
  return data.includes('\r') || /\x1b\[13(?:;[0-9]+)?u/.test(data);
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Clipboard image did not produce a data URL'));
        return;
      }
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read clipboard image'));
    reader.readAsDataURL(file);
  });
}

async function resolveClipboardImagePath(file: File): Promise<string | null> {
  try {
    const existingPath = window.electronAPI.getPathForFile(file).trim();
    if (existingPath) return existingPath;
  } catch {}

  if (!file.type.startsWith('image/')) return null;
  const base64 = await readFileAsBase64(file);
  const result = await rpc.fs.saveClipboardImage(base64, file.type);
  return result.success ? (result.data?.absPath ?? null) : null;
}

export interface UsePtyOptions {
  /** Deterministic PTY session ID: makePtySessionId(projectId, scopeId, leafId). */
  sessionId: string;
  /** Prepared FrontendPty instance owned by the entity's PtySession store. */
  pty: FrontendPty;
  theme?: SessionTheme;
  mapShiftEnterToCtrlJ?: boolean;
  onActivity?: () => void;
  onExit?: (info: PtyExitEvent) => void;
  onFirstMessage?: (message: string) => void;
  onEnterPress?: (message: string) => void;
  onSubmittedInput?: (message: string, isTaskInput: boolean) => void;
  onInterruptPress?: () => void;
  /** Turn pasted image files/paths into backtick-wrapped textual @mentions. */
  pasteImagesAsPaths?: boolean;
  fileLinks?: TerminalFileLinkOptions | null;
  /** Overrides URL link activation (smart web links + OSC 8 hyperlinks); defaults to the system browser. */
  webLinks?: TerminalWebLinkOptions | null;
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
 * When inside a PaneSizingProvider the terminal is pre-resized to the pane's
 * current dimensions BEFORE being appended to the visible DOM, eliminating
 * the flash caused by a post-mount resize. The PTY output subscription begins
 * only after live measurement opens the flush gate.
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
    pasteImagesAsPaths,
    fileLinks,
    webLinks,
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
  const pasteImagesAsPathsRef = useRef(pasteImagesAsPaths ?? false);
  pasteImagesAsPathsRef.current = pasteImagesAsPaths ?? false;
  const fileLinksRef = useRef(fileLinks ?? null);
  fileLinksRef.current = fileLinks ?? null;
  const webLinksRef = useRef(webLinks ?? null);
  webLinksRef.current = webLinks ?? null;
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // When inside a PaneSizingProvider, only the pane's active session is resized.
  // Background PTYs keep the size that matches their off-screen xterm grid until
  // they mount and measure as the active session.
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
  const retryMeasureAndResize = useCallback((retries: number) => {
    if (retries >= MAX_LAYOUT_READY_RETRIES) return false;
    requestAnimationFrame(() => measureAndResizeRef.current(retries + 1));
    return true;
  }, []);

  // measureAndResize is the single entry point for all DOM measurement + PTY
  // resize work. ResizeObserver callers schedule it after layout, then this
  // commits the xterm grid and PTY dimensions as one canonical transition.
  const measureAndResize = useCallback(
    (retries = 0) => {
      if (!termRef.current) return;
      try {
        const term = termRef.current;
        const pane = paneSizingRef.current;

        const cell = getCellMetrics(term);
        if (!cell) {
          retryMeasureAndResize(retries);
          return;
        }

        // Fit the box that actually clips xterm's rows. A pane wrapper can be
        // wider than the nested terminal host, which makes the final CJK cells
        // exist in the buffer but render beyond the visible right edge.
        const termParent = (term as unknown as { element?: HTMLElement }).element?.parentElement;
        const measureTarget = resolveTerminalFitContainer(
          termParent ?? null,
          containerRef.current as HTMLElement | null,
          pane?.containerRef.current ?? null
        );
        if (!measureTarget) return;
        const scrollbarWidth = getTerminalFitScrollbarWidth(term);

        if (!isMeasureTargetReady(measureTarget, cell) && retryMeasureAndResize(retries)) {
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
          retryMeasureAndResize(retries);
          return;
        }
        const { cols: targetCols, rows: targetRows } = dims;

        if (term.cols !== targetCols || term.rows !== targetRows) {
          pty.commitResize(targetCols, targetRows);
        }

        // Open the parser flush gate only after xterm has the real pane grid.
        // PtySession prepares xterm but deliberately does not subscribe; doing
        // so earlier would register a flow-control consumer that cannot ACK.
        pty.flushPendingWrites();

        // PTY resize goes out in the same tick as the grid commit, so the
        // app's SIGWINCH repaint corresponds to exactly this grid size.
        if (pane) {
          pane.reportDimensions(sessionId, targetCols, targetRows);
        } else {
          sendPtyResizeRef.current(targetCols, targetRows);
        }

        // Listener-first subscription starts only after mount + measurement +
        // flush-gate activation. FrontendPty keeps a successful subscription
        // alive while off-screen and single-flights repeated resize reports.
        void pty.connect().catch((error) => {
          log.warn('useTerminal: failed to subscribe PTY output', { sessionId, error });
        });
      } catch (e) {
        log.warn('useTerminal: measureAndResize failed', { sessionId, error: e });
      }
    },
    [sessionId, containerRef, pty, retryMeasureAndResize]
  );

  // Stable ref so a scheduled/retried measurement always calls
  // the latest version without creating a circular useCallback dependency.
  const measureAndResizeRef = useRef(measureAndResize);
  measureAndResizeRef.current = measureAndResize;

  // Exactly one commit per browser frame. ResizeObserver only marks the grid
  // dirty; the next rAF reads the final post-layout size. This mirrors Warp's
  // after-layout sizing model and avoids a delayed terminal lagging behind its
  // pane during a drag.
  const pendingCommitFrameRef = useRef<number | null>(null);
  const scheduleCommit = useCallback(() => {
    if (pendingCommitFrameRef.current !== null) return;
    pendingCommitFrameRef.current = requestAnimationFrame(() => {
      pendingCommitFrameRef.current = null;
      if (!termRef.current) return;
      measureAndResizeRef.current();
    });
  }, []);

  const applyTheme = useCallback(
    (t?: SessionTheme) => {
      if (!termRef.current) return;
      pty.setTheme(t);
    },
    [pty]
  );

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
    writeTextToClipboard(selection);
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
      void rpc.pty
        .sendInput(sessionId, data)
        .then((result) => {
          if (!result.success) {
            log.warn('Terminal input queue is full', {
              sessionId,
              error: result.error,
            });
          }
        })
        .catch((error) => {
          log.warn('Failed to send terminal input', { sessionId, error });
        });
    },
    [sessionId]
  );

  // URL activation funnel (smart web links, OSC 8 hyperlinks, link gestures):
  // the injected webLinks handler wins, otherwise the system browser.
  const openUrl = useCallback((url: string) => {
    const handler = webLinksRef.current?.onOpen;
    if (handler) {
      handler(url);
      return;
    }
    rpc.app.openExternal(url).catch((error) => {
      log.warn('Failed to open URL from terminal', { url, error });
    });
  }, []);

  const getLinkTargetAtEvent = useCallback((event: MouseEvent): TerminalLinkTarget | null => {
    const terminal = termRef.current;
    const terminalElement = (terminal as unknown as { element?: HTMLElement } | null)?.element;
    if (!terminal || !terminalElement) return null;

    const cell = getBufferCellFromMouseEvent(terminal, terminalElement, event);
    if (!cell) return null;

    const position = { x: cell.col + 1, y: cell.row + 1 };
    return getTerminalLinkTargetAtCell(terminal, cell.row + 1, position, fileLinksRef.current);
  }, []);

  const pasteFromClipboard = useCallback(() => {
    const target = termRef.current;
    navigator.clipboard
      .readText()
      .then((text) => {
        if (text && target && termRef.current === target) {
          target.paste(transformTerminalPasteText(text, pasteImagesAsPathsRef.current));
        }
      })
      .catch(() => {});
  }, []);

  // ─── Main effect: mount terminal once per sessionId ────────────────────────

  // Reparent the prepared xterm during React's commit, before Chromium paints
  // the new route. A passive effect leaves one frame containing only the empty
  // terminal host even when the historical buffer was already hydrated.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── Compute targetDims synchronously ─────────────────────────────────────
    // Measure with the destination terminal's own cell metrics. A keyed task
    // route has no previous termRef, and using another session's metrics makes
    // the prepared frame reflow immediately after it becomes visible.
    const pane = paneSizingRef.current;
    const destinationTerm = pty.terminal;
    const destinationCell = getCellMetrics(destinationTerm);
    let targetDims: { cols: number; rows: number } | undefined;

    if (pane?.containerRef.current && destinationCell) {
      const measured = measureDimensions(
        pane.containerRef.current,
        destinationCell.width,
        destinationCell.height,
        getTerminalFitScrollbarWidth(destinationTerm),
        TERMINAL_FIT_GUARD_COLUMNS
      );
      if (measured) targetDims = measured;
    }

    if (!targetDims && pane) {
      targetDims = pane.getCurrentDimensions() ?? undefined;
    }

    // ── Mount ─────────────────────────────────────────────────────────────────
    // PtySession has synchronously prepared xterm; output subscription waits
    // for the first successful live measurement below.
    const cleanups: (() => void)[] = [];
    let mountLease: number | undefined;
    let mounted = true;
    cleanups.push(() => {
      mounted = false;
    });

    {
      const frontendPty = pty;
      termRef.current = frontendPty.terminal;

      // Apply current theme before mounting (in case it differs from the
      // theme the terminal was constructed with).
      frontendPty.setTheme(themeRef.current);
      frontendPty.terminal.options.macOptionClickForcesSelection = true;

      // Mount: pre-resize then appendChild (flash-free).
      const activeMountLease = frontendPty.mount(container as HTMLElement, targetDims);
      mountLease = activeMountLease;

      // Always sync after mounting — targetDims may be stale if the pane was
      // resized while this session was off-screen. Read the live post-layout
      // DOM in the next frame.
      scheduleCommit();

      // ── Load settings ──────────────────────────────────────────────────────
      let customFontFamily = '';
      void loadTerminalSettings()
        .then((terminalSettings) => {
          if (terminalSettings?.fontFamily) {
            customFontFamily = terminalSettings.fontFamily.trim();
            if (customFontFamily) {
              const fontFamily = buildTerminalFontFamily(customFontFamily);
              if (frontendPty.terminal.options.fontFamily !== fontFamily) {
                frontendPty.terminal.options.fontFamily = fontFamily;
                const remeasureAfterFontLoad = () => {
                  if (mounted) scheduleCommit();
                };
                scheduleCommit();
                void document.fonts?.ready.then(remeasureAfterFontLoad);
              }
            }
          }
          frontendPty.setScrollbackLines(
            terminalSettings?.scrollbackLines ?? DEFAULT_TERMINAL_SCROLLBACK_LINES
          );
          autoCopyOnSelectionRef.current = terminalSettings?.autoCopyOnSelection ?? true;
        })
        .catch((error: unknown) => {
          log.warn('useTerminal: terminal settings unavailable, keeping defaults', {
            sessionId,
            error,
          });
        });

      const terminal = frontendPty.terminal;

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

        const wordNavigationInput = getWordNavigationInputFromTerminal(event, IS_MAC_PLATFORM);
        if (wordNavigationInput !== null) {
          event.preventDefault();
          event.stopImmediatePropagation();
          event.stopPropagation();
          sendInput(wordNavigationInput);
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

        // xterm-generated terminal replies (DA/DECRQM/bracketed paste) are part
        // of the PTY protocol, not keyboard noise. Forward them intact. xterm 6
        // already answers DECRQM with its real mode state; overriding or
        // stripping those replies leaves TUIs with incorrect terminal modes.
        let filtered = data;
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

      const terminalLinkProvidersDisposable = registerTerminalLinkProviders(
        terminal,
        () => fileLinksRef.current,
        () => ({ onOpen: openUrl })
      );
      cleanups.push(() => terminalLinkProvidersDisposable.dispose());

      // OSC 8 hyperlinks go through the FrontendPty's link handler — route them
      // through the same funnel while this pane hosts the terminal.
      pty.setLinkOpener(openUrl, activeMountLease);
      cleanups.push(() => pty.setLinkOpener(null, activeMountLease));

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
        const handleTerminalPaste = (event: ClipboardEvent) => {
          if (!pasteImagesAsPathsRef.current || !event.clipboardData) return;

          const clipboardFiles = Array.from(event.clipboardData.files);
          const imageFiles = clipboardFiles.filter((file) => {
            if (file.type.startsWith('image/')) return true;
            try {
              return isImagePath(window.electronAPI.getPathForFile(file).trim());
            } catch {
              return false;
            }
          });
          const text = event.clipboardData.getData('text/plain');
          const transformedText = transformTerminalPasteText(text, true);
          if (imageFiles.length === 0 && transformedText === text) return;

          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();

          if (imageFiles.length === 0) {
            terminal.paste(transformedText);
            return;
          }

          void Promise.all(imageFiles.map((file) => resolveClipboardImagePath(file)))
            .then((paths) => {
              if (termRef.current !== terminal) return;
              const mentions = paths
                .filter((path): path is string => Boolean(path))
                .map(imagePathMention);
              if (mentions.length > 0) terminal.paste(mentions.join(' '));
            })
            .catch((error) => {
              log.warn('Failed to paste terminal images as paths', { sessionId, error });
            });
        };
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

          openUrl(target.url);
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

        terminalElement.addEventListener('paste', handleTerminalPaste, true);
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
          terminalElement.removeEventListener('paste', handleTerminalPaste, true);
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
          onExitRef.current?.(info);
        },
        sessionId
      );
      cleanups.push(offExit);

      // ── Font / setting change events ───────────────────────────────────────
      const handleFontChange = (e: Event) => {
        const detail = (e as CustomEvent<{ fontFamily?: string }>).detail;
        customFontFamily = detail?.fontFamily?.trim() ?? '';
        terminal.options.fontFamily = buildTerminalFontFamily(customFontFamily);
        scheduleCommit();
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
      // Host position changes (tab pin/unpin/reclaim between panes) only need a
      // measurement pass. FrontendPty.mount() owns the one canonical repaint;
      // sending another same-size SIGWINCH makes the TUI redraw its content.
      const handleRelayout = () => {
        scheduleCommit();
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
      // Frame-coalesced, post-layout sizing: RO only marks dirty and the next
      // animation frame commits the latest grid once. The DOM renderer then
      // repaints directly from xterm's canonical buffer.
      const resizeObserver = new ResizeObserver(() => {
        scheduleCommit();
      });
      resizeObserver.observe(container);
      cleanups.push(() => resizeObserver.disconnect());

      // ── HMR: re-measure after every Vite update ────────────────────────────
      // CSS/font changes can alter cell metrics without resizing the host. Only
      // commit when the resulting grid dimensions actually changed; refreshing
      // identical rows after every edit is both wasteful and a source of stale
      // dev-only frames.
      if (import.meta.hot) {
        const onHmrUpdate = () => scheduleCommit();
        import.meta.hot.on('vite:afterUpdate', onHmrUpdate);
        cleanups.push(() => import.meta.hot?.off('vite:afterUpdate', onHmrUpdate));
      }
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────
    return () => {
      if (pendingCommitFrameRef.current !== null) {
        cancelAnimationFrame(pendingCommitFrameRef.current);
        pendingCommitFrameRef.current = null;
      }
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
      pty.unmount(mountLease);
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
