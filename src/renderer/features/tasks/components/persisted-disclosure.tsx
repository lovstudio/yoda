import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useProvisionedTaskOrNull } from '@renderer/features/tasks/task-view-context';

/**
 * Reads/writes runtime open state for an ad-hoc disclosure (a `<details>`,
 * a group toggle, …). The id must be stable across renders so the remembered
 * state reattaches during the current app session. `defaultOpen` is used until
 * the user has explicitly toggled this id. Outside a task view (no
 * ProvisionedTaskProvider, e.g. the composer popover) the state falls back to
 * plain component state.
 */
export function usePersistedDisclosure(
  id: string,
  defaultOpen = false
): [boolean, (open: boolean) => void] {
  const provisioned = useProvisionedTaskOrNull();
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  if (!provisioned) return [localOpen, setLocalOpen];
  const { taskView } = provisioned;
  return [
    taskView.isDisclosureOpen(id, defaultOpen),
    (next: boolean) => taskView.setDisclosureOpen(id, next),
  ];
}

/**
 * A `<details>` whose open state survives remounts for the current app session.
 * Drop-in for native `<details>` — same className/children, but controlled by a
 * stable `id`.
 */
export const PersistedDetails = observer(function PersistedDetails({
  id,
  defaultOpen = false,
  className,
  summary,
  children,
}: {
  id: string;
  defaultOpen?: boolean;
  className?: string;
  summary: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = usePersistedDisclosure(id, defaultOpen);
  return (
    <details
      className={className}
      open={open}
      onToggle={(event) => {
        const next = (event.currentTarget as HTMLDetailsElement).open;
        if (next !== open) setOpen(next);
      }}
    >
      {summary}
      {children}
    </details>
  );
});
