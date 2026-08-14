import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { PtyExitEvent } from '@shared/events/ptyEvents';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { cn } from '@renderer/utils/utils';
import type { FrontendPty, SessionTheme } from './pty';
import type { TerminalFileLinkOptions } from './terminal-file-links';
import { TerminalLinkMenu, type TerminalLinkMenuState } from './terminal-link-menu';
import type { TerminalWebLinkOptions } from './terminal-web-links';
import { usePty } from './use-pty';

type Props = {
  /**
   * Deterministic PTY session ID: `makePtySessionId(projectId, scopeId, leafId)`.
   */
  sessionId: string;
  /** Prepared FrontendPty owned by the entity's PtySession store. */
  pty: FrontendPty;
  className?: string;
  contentFilter?: string;
  mapShiftEnterToCtrlJ?: boolean;
  /** SSH connection ID — used for remote file drag-and-drop only. */
  remoteConnectionId?: string;
  themeOverride?: SessionTheme['override'];
  onActivity?: () => void;
  onExit?: (info: PtyExitEvent) => void;
  onFirstMessage?: (message: string) => void;
  onEnterPress?: (message: string) => void;
  onSubmittedInput?: (message: string, isTaskInput: boolean) => void;
  onInterruptPress?: () => void;
  /** Turn pasted image files/paths into backtick-wrapped textual @mentions. */
  pasteImagesAsPaths?: boolean;
  fileLinks?: TerminalFileLinkOptions | null;
  webLinks?: TerminalWebLinkOptions | null;
  /** Disable autonomous frame ACK while an outer task-opening surface is opaque. */
  autoAcknowledgeFrame?: boolean;
  /** Allow a provider-confirmed working session to reveal its latest complete atomic frame. */
  allowAtomicLiveFrame?: boolean;
  /** Keep the terminal readable/selectable without forwarding input. */
  inputEnabled?: boolean;
};

const PtyPaneComponent = forwardRef<{ focus: () => void }, Props>(
  (
    {
      sessionId,
      pty,
      className,
      contentFilter,
      mapShiftEnterToCtrlJ,
      remoteConnectionId,
      themeOverride,
      onActivity,
      onExit,
      onFirstMessage,
      onEnterPress,
      onSubmittedInput,
      onInterruptPress,
      pasteImagesAsPaths,
      fileLinks,
      webLinks,
      autoAcknowledgeFrame,
      allowAtomicLiveFrame,
      inputEnabled,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [linkMenu, setLinkMenu] = useState<TerminalLinkMenuState | null>(null);

    const theme: SessionTheme = { override: themeOverride };

    const { focus, sendInput, getLinkTargetAtEvent, activateLinkTargetAtEvent } = usePty(
      {
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
        autoAcknowledgeFrame,
        allowAtomicLiveFrame,
        inputEnabled,
      },
      containerRef
    );

    useImperativeHandle(ref, () => ({ focus }), [focus]);

    // xterm normally focuses its own helper textarea from its mousedown handler.
    // Keep this as a fallback for clicks on the surrounding empty host, but do
    // not also focus on `click`: the latter runs after xterm's native focus and
    // can recreate the helper textarea's focus state immediately after an
    // image clipboard paste.
    const handleMouseDown: React.MouseEventHandler<HTMLDivElement> = (event) => {
      if (event.button !== 0) return;
      focus();
    };

    // tmux binds secondary-button presses to its internal pane menu. That menu
    // is rendered into the terminal character grid, bypasses Yoda's UI, and can
    // snap a scrolled-back transcript to the tail when it closes. Consume both
    // halves of the secondary click before xterm's mouse protocol sees them;
    // handleContextMenu still opens Yoda's menu for recognized links.
    const handleSecondaryMouseEvent: React.MouseEventHandler<HTMLDivElement> = (event) => {
      if (event.button !== 2) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const handleMouseDownCapture: React.MouseEventHandler<HTMLDivElement> = (event) => {
      if (event.button === 2) {
        handleSecondaryMouseEvent(event);
        return;
      }
      if (!activateLinkTargetAtEvent(event.nativeEvent)) return;

      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
    };

    const handleDrop: React.DragEventHandler<HTMLDivElement> = (event) => {
      try {
        event.preventDefault();
        const dt = event.dataTransfer;
        if (!dt?.files?.length) return;

        const paths: string[] = [];
        for (const file of Array.from(dt.files)) {
          const path = window.electronAPI.getPathForFile(file).trim();
          if (path) paths.push(path);
        }
        if (paths.length === 0) return;

        void (async () => {
          try {
            if (remoteConnectionId) {
              try {
                const result = await rpc.pty.uploadFiles({ sessionId, localPaths: paths });
                if (result.success && result.data?.remotePaths) {
                  const escaped = result.data.remotePaths
                    .map((p: string) => `'${p.replace(/'/g, "'\\''")}'`)
                    .join(' ');
                  sendInput(`${escaped} `);
                }
              } catch (error) {
                log.warn('SSH file transfer failed', { error });
              }
            } else {
              const escaped = paths.map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(' ');
              sendInput(`${escaped} `);
            }
            focus();
          } catch (error) {
            log.warn('Terminal drop failed', { error });
          }
        })();
      } catch (error) {
        log.warn('Terminal drop failed', { error });
      }
    };

    const handleContextMenu: React.MouseEventHandler<HTMLDivElement> = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const target = getLinkTargetAtEvent(event.nativeEvent);
      if (!target) return;
      const { clientX: x, clientY: y } = event;
      // Defer the open until after the right-click mouseup so the release
      // cannot be treated as an outside interaction by the menu.
      const open = () => setLinkMenu({ target, x, y });
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => {
        document.removeEventListener('mouseup', onceMouseUp, true);
        if (timeoutId !== null) clearTimeout(timeoutId);
      };
      const onceMouseUp = () => {
        cleanup();
        open();
      };
      document.addEventListener('mouseup', onceMouseUp, true);
      // Fallback in case mouseup never fires (e.g. focus stolen, keyboard-driven).
      timeoutId = setTimeout(() => {
        cleanup();
        open();
      }, 100);
    };

    return (
      <div
        className={cn('terminal-pane flex h-full w-full min-w-0 bg', className)}
        style={{
          width: '100%',
          height: '100%',
          minHeight: 0,
          boxSizing: 'border-box',
          backgroundColor: themeOverride?.background ?? 'var(--xterm-bg)',
        }}
      >
        <div
          ref={containerRef}
          data-terminal-container
          style={{
            width: '100%',
            height: '100%',
            minHeight: 0,
            overflow: 'hidden',
            filter: contentFilter || undefined,
          }}
          onMouseDownCapture={handleMouseDownCapture}
          onMouseDown={handleMouseDown}
          onMouseUpCapture={handleSecondaryMouseEvent}
          onContextMenuCapture={handleContextMenu}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        />
        <TerminalLinkMenu
          state={linkMenu}
          fileLinks={fileLinks ?? null}
          webLinks={webLinks ?? null}
          onClose={() => setLinkMenu(null)}
        />
      </div>
    );
  }
);

PtyPaneComponent.displayName = 'TerminalPane';

export const PtyPane = React.memo(PtyPaneComponent);
