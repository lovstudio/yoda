import { ChevronsUpDownIcon, PencilIcon, PlusIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { appState } from '@renderer/lib/stores/app-state';
import { ComboboxTrigger, ComboboxValue } from '@renderer/lib/ui/combobox';
import { ComboboxPopover } from '@renderer/lib/ui/combobox-popover';

interface SshConnectionSelectorProps {
  connectionId?: string;
  onConnectionIdChange: (connectionId: string) => void;
  onAddConnection: () => void;
  onEditConnection?: (connectionId: string) => void;
}

export const SshConnectionSelector = observer(function SshConnectionSelector({
  connectionId,
  onConnectionIdChange,
  onAddConnection,
  onEditConnection,
}: SshConnectionSelectorProps) {
  const { t } = useTranslation();
  const { connections } = appState.sshConnections;

  const options = connections
    .filter((c): c is typeof c & { id: string } => c.id !== undefined)
    .map((connection) => ({
      value: connection.id,
      label: connection.name,
    }));

  const selectedOption = connectionId
    ? (options.find((o) => o.value === connectionId) ?? null)
    : null;

  const actions = [
    {
      id: 'add',
      label: t('ssh.addConnection'),
      icon: <PlusIcon className="size-4" />,
      onClick: onAddConnection,
    },
    ...(connectionId && onEditConnection
      ? [
          {
            id: 'edit',
            label: t('ssh.editConnection'),
            icon: <PencilIcon className="size-4" />,
            onClick: () => onEditConnection(connectionId),
          },
        ]
      : []),
  ];

  return (
    <ComboboxPopover
      items={options}
      value={selectedOption}
      onValueChange={(conn) => onConnectionIdChange(conn.value)}
      actions={actions}
      trigger={
        <ComboboxTrigger
          render={
            <button className="flex h-9 w-full min-w-0 items-center justify-between rounded-md border border-border px-2.5 py-1 text-left text-sm outline-none">
              <ComboboxValue
                placeholder={
                  <p className="text-muted-foreground">{t('ssh.selectOrAddConnection')}</p>
                }
              />
              <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
            </button>
          }
        />
      }
    />
  );
});
