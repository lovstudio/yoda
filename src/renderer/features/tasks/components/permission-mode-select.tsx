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
}: {
  runtimeId: RuntimeId | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  const permissionModes = useRuntimePermissionModes();

  if (!runtimeId) return null;

  const modes = permissionModes.getModes(runtimeId);
  const current = permissionModes.getMode(runtimeId);
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
      <SelectContent>
        {modes.map((mode) => (
          <SelectItem
            key={mode.id}
            value={mode.id}
            className={cn(mode.danger && 'text-destructive')}
          >
            {t(mode.labelKey)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
