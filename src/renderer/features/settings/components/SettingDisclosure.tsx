import { ChevronRight } from 'lucide-react';
import React, { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@renderer/lib/ui/collapsible';
import { SettingRow } from './SettingRow';

interface SettingDisclosureProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Optional inline control (a switch, a select) that stays reachable while collapsed. */
  control?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/**
 * A {@link SettingRow} whose detailed configuration is folded away behind the
 * label. The row keeps the standard grammar — label left, control right,
 * description underneath — so a collapsed disclosure reads as just another
 * setting; expanding it reveals the fields that would otherwise dominate the
 * page.
 */
export function SettingDisclosure({
  title,
  description,
  control,
  defaultOpen = false,
  children,
}: SettingDisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <SettingRow
        title={
          <CollapsibleTrigger
            type="button"
            className="group -mx-1 flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-foreground outline-none focus-visible:ring-1 focus-visible:ring-border"
          >
            <ChevronRight className="size-3.5 shrink-0 text-foreground-passive transition-transform duration-200 group-data-[panel-open]:rotate-90" />
            <span className="min-w-0 break-words">{title}</span>
          </CollapsibleTrigger>
        }
        description={description && <span className="block pl-5">{description}</span>}
        control={control}
      />
      <CollapsibleContent>
        <div className="mt-3 border-t border-border/50 pt-3 pl-5">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
