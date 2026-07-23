import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ViewId } from '@renderer/app/view-registry';
import { appState } from '@renderer/lib/stores/app-state';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

/**
 * Shared navigation affordance for views that can either replace the main
 * surface or be pinned into the global side pane with Alt/right-click.
 */
export const GlobalSidePaneTarget = observer(function GlobalSidePaneTarget({
  viewId,
  params,
  altHeld,
  tooltipSide = 'right',
  tooltipLabel,
  children,
}: {
  viewId: ViewId;
  params?: Record<string, unknown>;
  altHeld: boolean;
  tooltipSide?: 'top' | 'right';
  tooltipLabel?: string;
  children: React.ReactElement;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = React.useState(false);
  const targetParams = params ?? {};
  const isPinned = appState.sidePane.findViewPin(viewId, targetParams) !== undefined;
  const label = t(isPinned ? 'appTabs.unpinFromGlobalSidePane' : 'appTabs.openInGlobalSidePane');
  const visibleTooltip = altHeld ? label : tooltipLabel;

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className="shrink-0"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {visibleTooltip ? (
          <Tooltip open={altHeld ? hovered : undefined}>
            <TooltipTrigger render={children} />
            <TooltipContent side={tooltipSide}>{visibleTooltip}</TooltipContent>
          </Tooltip>
        ) : (
          children
        )}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          className="whitespace-nowrap"
          onClick={() => appState.sidePane.toggleView(viewId, targetParams)}
        >
          {isPinned ? (
            <PanelRightClose className="size-4" />
          ) : (
            <PanelRightOpen className="size-4" />
          )}
          {label}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
