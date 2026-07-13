import { Copy, ExternalLink, FileText } from 'lucide-react';
import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FilePathMenuItems } from '@renderer/lib/components/file-path-actions';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { cn } from '@renderer/utils/utils';
import type { TerminalFileLinkOptions, TerminalFileLinkTarget } from './terminal-file-links';
import type { TerminalLinkTarget } from './terminal-link-target';

export interface TerminalLinkMenuState {
  target: TerminalLinkTarget;
  /** Viewport coordinates of the right-click. */
  x: number;
  y: number;
}

interface Props {
  state: TerminalLinkMenuState | null;
  fileLinks: TerminalFileLinkOptions | null;
  onClose: () => void;
}

export function TerminalLinkMenu({ state, fileLinks, onClose }: Props) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!state) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      onClose();
    };
    const handleContextMenu = (event: MouseEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('contextmenu', handleContextMenu, true);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('contextmenu', handleContextMenu, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose, state]);

  if (!state || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 max-h-[min(24rem,calc(100vh-16px))] w-52 overflow-x-hidden overflow-y-auto rounded-md bg-background-quaternary p-1 text-foreground shadow-md ring-1 ring-foreground/10 outline-none"
      style={{ left: state.x, top: state.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      {state?.target.kind === 'file' ? (
        <FileMenuItems
          target={state.target.target}
          fileLinks={fileLinks}
          onAfterAction={onClose}
          t={t}
        />
      ) : null}
      {state?.target.kind === 'url' ? (
        <UrlMenuItems url={state.target.url} onAfterAction={onClose} t={t} />
      ) : null}
    </div>,
    document.body
  );
}

function MenuItem({
  children,
  disabled = false,
  onSelect,
  onClick,
  className,
}: {
  children?: ReactNode;
  disabled?: boolean;
  onSelect?: () => void;
  onClick?: (event: ReactMouseEvent) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 overflow-hidden rounded-sm px-2 py-1.5 text-left text-sm outline-hidden transition-colors select-none before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-transparent before:transition-colors before:content-[''] hover:bg-background-quaternary-2 hover:text-foreground hover:before:bg-foreground/70 hover:**:text-foreground focus:bg-background-quaternary-2 focus:text-foreground focus:before:bg-foreground/70 not-data-[variant=destructive]:focus:**:text-foreground active:bg-background-quaternary-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
        disabled && 'pointer-events-none opacity-50'
      )}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (disabled) return;
        onClick?.(event);
        onSelect?.();
      }}
    >
      {children}
    </button>
  );
}

function MenuSeparator() {
  return <div role="separator" className="-mx-1 my-1 h-px bg-border" />;
}

function FileMenuItems({
  target,
  fileLinks,
  onAfterAction,
  t,
}: {
  target: TerminalFileLinkTarget;
  fileLinks: TerminalFileLinkOptions | null;
  onAfterAction: () => void;
  t: (key: string) => string;
}) {
  const canOpenInEditor = Boolean(fileLinks && target.filePath);
  const absolutePath = target.absolutePath ?? null;

  return (
    <>
      {canOpenInEditor ? (
        <MenuItem
          onSelect={() => {
            fileLinks?.onOpen(target);
            onAfterAction();
          }}
        >
          <FileText className="size-4" />
          {t('fileActions.openInMainArea')}
        </MenuItem>
      ) : null}
      {canOpenInEditor && absolutePath ? <MenuSeparator /> : null}
      {absolutePath ? (
        <FilePathMenuItems
          target={{
            absolutePath,
            relativePath: target.filePath ?? null,
            kind: target.isDirectory ? 'directory' : 'file',
            sshConnectionId: fileLinks?.sshConnectionId ?? null,
            line: target.line,
            column: target.column,
          }}
          components={{ Item: MenuItem, Separator: MenuSeparator }}
          onAfterAction={onAfterAction}
        />
      ) : null}
    </>
  );
}

function UrlMenuItems({
  url,
  onAfterAction,
  t,
}: {
  url: string;
  onAfterAction: () => void;
  t: (key: string) => string;
}) {
  return (
    <>
      <MenuItem
        onSelect={() => {
          void rpc.app.openExternal(url).catch(() => {});
          onAfterAction();
        }}
      >
        <ExternalLink className="size-4" />
        {t('terminal.linkMenu.openUrl')}
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        onSelect={() => {
          void copyText(url, t('terminal.linkMenu.urlCopied'), t);
          onAfterAction();
        }}
      >
        <Copy className="size-4" />
        {t('terminal.linkMenu.copyUrl')}
      </MenuItem>
    </>
  );
}

async function copyText(
  text: string,
  successTitle: string,
  t: (key: string) => string
): Promise<void> {
  try {
    const res = await rpc.app.clipboardWriteText(text);
    if (res?.success) {
      toast({ title: successTitle });
      return;
    }
  } catch {
    // handled below
  }
  toast({
    title: t('common.copyFailed'),
    description: t('tasks.panel.copyFilePathFailed'),
    variant: 'destructive',
  });
}
