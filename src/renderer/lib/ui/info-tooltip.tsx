import { Info } from 'lucide-react';
import React from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';

/** Small info icon that reveals its content in a tooltip on hover. */
export function InfoTooltip({ label, content }: { label: string; content: React.ReactNode }) {
  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground"
              aria-label={label}
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          }
        />
        <TooltipContent side="top" className="max-w-xs text-xs">
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
