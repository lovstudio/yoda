import { useTranslation } from 'react-i18next';
import type { RuntimeId } from '@shared/runtime-registry';
import { useRuntimePermissionModes } from '@renderer/features/tasks/hooks/useRuntimePermissionModes';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { cn } from '@renderer/utils/utils';

/**
 * Per-runtime permission-mode picker. Writes the selection to the
 * `runtimePermissionModes` app setting; conversation spawn resolves it into the
 * matching CLI flags (see runtime-registry permissionModes). Shared by the
 * composer settings popover and the create-task modal so both surfaces stay
 * consistent.
 */
export function PermissionModeSelect({
  runtimeId,
  className,
  contentPortaled = true,
  alignContentWithTrigger = true,
  contentClassName,
}: {
  runtimeId: RuntimeId | null | undefined;
  className?: string;
  contentPortaled?: boolean;
  alignContentWithTrigger?: boolean;
  contentClassName?: string;
}) {
  const { t } = useTranslation();
  const permissionModes = useRuntimePermissionModes();

  if (!runtimeId) return null;

  const modes = permissionModes.getModes(runtimeId);
  const current = permissionModes.getMode(runtimeId);
  const hasDescriptions = modes.some((mode) => mode.descriptionKey);
  const labelFor = (modeId: string | null) =>
    t(modes.find((m) => m.id === modeId)?.labelKey ?? 'permissionMode.default');

  return (
    <Select
      // Non-modal so the dropdown doesn't trap focus / install a dismiss guard
      // when nested inside the composer settings Popover — otherwise closing the
      // select swallows the popover's next outside-press (needing two clicks).
      modal={false}
      value={current}
      onValueChange={(value) => {
        if (value) permissionModes.setMode(runtimeId, value as string);
      }}
    >
      <SelectTrigger
        size="sm"
        disabled={permissionModes.loading || permissionModes.saving}
        className={cn('w-44', className)}
      >
        <SelectValue>{(value: string | null) => labelFor(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent
        portaled={contentPortaled}
        alignItemWithTrigger={alignContentWithTrigger}
        className={cn(hasDescriptions && 'w-80 max-w-[calc(100vw-2rem)]', contentClassName)}
      >
        {modes.map((mode) => (
          <SelectItem
            key={mode.id}
            value={mode.id}
            className={cn(
              mode.descriptionKey && 'items-start py-2.5',
              mode.danger && 'text-destructive'
            )}
          >
            {mode.descriptionKey ? (
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate">{t(mode.labelKey)}</span>
                <span
                  className={cn(
                    'whitespace-normal text-xs leading-snug text-foreground-passive',
                    mode.danger && 'text-destructive/75'
                  )}
                >
                  {t(mode.descriptionKey)}
                </span>
              </span>
            ) : (
              t(mode.labelKey)
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
