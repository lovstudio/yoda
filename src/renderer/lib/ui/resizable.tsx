import { useRef } from 'react';
import * as ResizablePrimitive from 'react-resizable-panels';
import { cn } from '@renderer/utils/utils';

function ResizablePanelGroup({ className, ...props }: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn('flex h-full w-full aria-[orientation=vertical]:flex-col', className)}
      {...props}
    />
  );
}

function ResizablePanel({ className, style, ...props }: ResizablePrimitive.PanelProps) {
  // react-resizable-panels v4 applies `overflow: auto` inline to its nested
  // content element. That wins over Tailwind's `overflow-hidden` class and can
  // turn a layout-only panel into a remembered scroll owner. In task views,
  // restoring that scroll position moves the session titlebar out of view.
  //
  // Preserve the existing overflow-hidden contract at the primitive boundary.
  // `clip` is intentional: unlike `hidden`, it also prevents focus/scroll
  // restoration from changing scrollTop programmatically.
  const clipsOverflow = className?.split(/\s+/).includes('overflow-hidden') ?? false;

  return (
    <ResizablePrimitive.Panel
      data-slot="resizable-panel"
      className={className}
      style={clipsOverflow ? { overflow: 'clip', ...style } : style}
      {...props}
    />
  );
}

function ResizableHandle({
  className,
  onFocus,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean;
}) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const restoreFocus = () => {
    previousFocusRef.current?.focus();
    previousFocusRef.current = null;
  };

  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        'relative flex w-px cursor-col-resize items-center justify-center bg-border ring-offset-background after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2  focus-visible:outline-hidden aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:cursor-row-resize aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90 aria-disabled:cursor-default!',
        className
      )}
      onFocus={(e) => {
        // `document.activeElement` is already the separator on pointerdown; use
        // relatedTarget to capture the element that was focused before the handle.
        if (e.relatedTarget instanceof HTMLElement) {
          previousFocusRef.current = e.relatedTarget;
        }
        onFocus?.(e);
      }}
      onPointerUp={(e) => {
        restoreFocus();
        onPointerUp?.(e);
      }}
      onPointerCancel={(e) => {
        restoreFocus();
        onPointerCancel?.(e);
      }}
      onPointerDown={onPointerDown}
      {...props}
    ></ResizablePrimitive.Separator>
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
