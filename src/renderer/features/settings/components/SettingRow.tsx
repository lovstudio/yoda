import React from 'react';

interface SettingRowProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  control: React.ReactNode;
}

/**
 * Standard settings row, iOS-style: the label and its interactive control share
 * the first line; the description (if any) drops to a full-width second line
 * beneath both. The control never stacks under the label — only the label cell
 * flex-shrinks — so every row reads consistently across the settings surface.
 */
export function SettingRow({ title, description, control }: SettingRowProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1 basis-64 break-words text-sm text-foreground">{title}</div>
        <div className="ml-auto flex shrink-0 items-center gap-1">{control}</div>
      </div>
      {description && (
        <div className="break-words text-xs text-foreground-passive">{description}</div>
      )}
    </div>
  );
}
