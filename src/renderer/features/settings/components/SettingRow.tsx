import React from 'react';

interface SettingRowProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  control: React.ReactNode;
}

/**
 * Standard settings row, iOS-style: the label and its interactive control share
 * the first line; the description (if any) drops to a full-width second line
 * beneath both. The row never wraps — the label cell flex-shrinks (wrapping its
 * own text if needed) while the control stays inline on the right — so every row
 * reads consistently and compactly across the settings surface.
 */
export function SettingRow({ title, description, control }: SettingRowProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-x-4">
        <div className="min-w-0 flex-1 break-words text-sm text-foreground">{title}</div>
        <div className="flex shrink-0 items-center gap-1">{control}</div>
      </div>
      {description && (
        <div className="break-words text-xs text-foreground-passive">{description}</div>
      )}
    </div>
  );
}
