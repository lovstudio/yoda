import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { WorkspaceSyncPopover } from '@renderer/app/workspace-sync-popover';
import { RUNTIME_BAR_ACTION_CLASS, RUNTIME_BAR_ACTION_LABEL_CLASS } from '../bar-chrome';

/** Cloud sync state for the workspace. */
export const RuntimeBarSyncItem = observer(function RuntimeBarSyncItem() {
  const [isSyncPopoverOpen, setIsSyncPopoverOpen] = useState(false);
  return (
    <WorkspaceSyncPopover
      open={isSyncPopoverOpen}
      onOpenChange={setIsSyncPopoverOpen}
      triggerClassName={RUNTIME_BAR_ACTION_CLASS}
      labelClassName={RUNTIME_BAR_ACTION_LABEL_CLASS}
    />
  );
});
