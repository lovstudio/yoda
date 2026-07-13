import React from 'react';
import type { DependencyState } from '@shared/dependencies';
import { type UiAgent } from '@renderer/lib/providers/meta';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { AgentInfoCard } from './agent-info-card';

interface AgentTooltipRowProps {
  id: UiAgent;
  children: React.ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  dependency?: DependencyState;
  model?: string | null;
  connectionId?: string;
}

export const AgentTooltipRow: React.FC<AgentTooltipRowProps> = ({
  id,
  children,
  side = 'right',
  align = 'start',
  dependency,
  model,
  connectionId,
}) => {
  return (
    <Popover>
      <PopoverTrigger openOnHover nativeButton={false} delay={0} closeDelay={0} render={children} />
      <PopoverContent
        side={side}
        align={align}
        sideOffset={8}
        className="w-auto border border-border bg-background p-0 text-foreground shadow-lg"
      >
        <AgentInfoCard
          id={id}
          dependency={dependency}
          selectedModel={model}
          connectionId={connectionId}
        />
      </PopoverContent>
    </Popover>
  );
};
