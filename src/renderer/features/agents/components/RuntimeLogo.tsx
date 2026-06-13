import { Sparkles } from 'lucide-react';
import React from 'react';
import type { RuntimeId } from '@shared/runtime-registry';
import { agentMeta } from '@renderer/lib/providers/meta';
import { cn } from '@renderer/utils/utils';

/**
 * Canonical runtime/provider logo. Single source for the icon/svg/img/fallback
 * rendering that used to be copy-pasted across the agents surfaces (the runtime
 * list rows, the detail header, the accordion). Sizing is driven by `className`
 * on the box; the fallback glyph follows `fallbackClassName`.
 */
export const RuntimeLogo: React.FC<{
  runtimeId: RuntimeId;
  name?: string;
  className?: string;
  fallbackClassName?: string;
}> = ({ runtimeId, name, className, fallbackClassName }) => {
  const meta = agentMeta[runtimeId];
  const icon = meta?.icon;

  return (
    <span
      className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded', className)}
    >
      {icon ? (
        meta?.isSvg ? (
          <span
            className={cn('h-full w-full', meta.invertInDark && 'dark:invert')}
            // SVGs are bundled raw — render inline.
            dangerouslySetInnerHTML={{ __html: icon }}
          />
        ) : (
          <img
            src={icon}
            alt={meta?.alt ?? name ?? runtimeId}
            className="h-full w-full object-contain"
          />
        )
      ) : (
        <Sparkles
          className={cn('text-muted-foreground', fallbackClassName ?? 'h-3.5 w-3.5')}
          aria-hidden="true"
        />
      )}
    </span>
  );
};
