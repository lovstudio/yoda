import type { Terminal } from '@xterm/xterm';

export function isTerminalLinkActivation(event: MouseEvent): boolean {
  return event.button === 0;
}

/** Smart file paths behave like ordinary links; no keyboard modifier is required. */
export function isTerminalFileLinkActivation(event: MouseEvent): boolean {
  return event.button === 0;
}

export function getTerminalLinkActivationHint(): string {
  return 'Click to open';
}

const HOVER_TOOLTIP_DELAY_MS = 2000;

export function createTerminalLinkHoverHandlers(
  terminal: Terminal,
  hint: string = getTerminalLinkActivationHint()
): {
  hover: (event: MouseEvent) => void;
  leave: () => void;
  dispose: () => void;
} {
  let tooltip: HTMLDivElement | null = null;
  let showTimer: ReturnType<typeof setTimeout> | null = null;

  const removeTooltip = () => {
    if (showTimer !== null) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    tooltip?.remove();
    tooltip = null;
  };

  const showTooltip = (event: MouseEvent) => {
    const terminalElement = terminal.element;
    if (!terminalElement) return;

    tooltip = document.createElement('div');
    tooltip.className =
      'xterm-hover pointer-events-none absolute z-50 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[11px] leading-4 text-background shadow-md';
    tooltip.textContent = hint;
    tooltip.style.opacity = '0.95';

    const terminalRect = terminalElement.getBoundingClientRect();
    terminalElement.appendChild(tooltip);

    const tooltipRect = tooltip.getBoundingClientRect();
    const padding = 4;
    const preferredLeft = event.clientX - terminalRect.left + 8;
    const preferredTop = event.clientY - terminalRect.top - tooltipRect.height - 8;
    const fallbackTop = event.clientY - terminalRect.top + 12;
    const maxLeft = Math.max(padding, terminalRect.width - tooltipRect.width - padding);
    const maxTop = Math.max(padding, terminalRect.height - tooltipRect.height - padding);
    const left = Math.min(Math.max(padding, preferredLeft), maxLeft);
    const top = Math.min(
      Math.max(padding, preferredTop >= padding ? preferredTop : fallbackTop),
      maxTop
    );

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  return {
    hover: (event) => {
      removeTooltip();
      showTimer = setTimeout(() => {
        showTimer = null;
        showTooltip(event);
      }, HOVER_TOOLTIP_DELAY_MS);
    },
    leave: removeTooltip,
    dispose: removeTooltip,
  };
}
