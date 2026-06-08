import { observer } from 'mobx-react-lite';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';

/**
 * Reads/writes a persisted open state for an ad-hoc disclosure (a `<details>`,
 * a group toggle, …). The id must be stable across renders so the remembered
 * state reattaches after a remount. `defaultOpen` is used until the user has
 * explicitly toggled this id.
 */
export function usePersistedDisclosure(
  id: string,
  defaultOpen = false
): [boolean, (open: boolean) => void] {
  const { taskView } = useProvisionedTask();
  const open = taskView.isDisclosureOpen(id, defaultOpen);
  return [open, (next: boolean) => taskView.setDisclosureOpen(id, next)];
}

/**
 * A `<details>` whose open state persists across remounts via the task sidebar
 * view-state. Drop-in for native `<details>` — same className/children, but
 * controlled by a stable `id`.
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
