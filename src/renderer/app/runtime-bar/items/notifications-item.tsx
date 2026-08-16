import { observer } from 'mobx-react-lite';
import { openTaskTarget } from '@renderer/app/open-task-target';
import { WorkspaceNotificationCenter } from '@renderer/app/workspace-notification-center';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { RUNTIME_BAR_ACTION_CLASS, RUNTIME_BAR_ACTION_LABEL_CLASS } from '../bar-chrome';

/** Unread notifications, each one a link back to the task that raised it. */
export const RuntimeBarNotificationsItem = observer(function RuntimeBarNotificationsItem() {
  const { navigate } = useNavigate();
  return (
    <WorkspaceNotificationCenter
      triggerClassName={RUNTIME_BAR_ACTION_CLASS}
      triggerLabelClassName={RUNTIME_BAR_ACTION_LABEL_CLASS}
      onOpenTarget={(target) => openTaskTarget(target, navigate)}
    />
  );
});
