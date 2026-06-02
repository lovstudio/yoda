import { observer } from 'mobx-react-lite';
import { useEffect, type ReactNode } from 'react';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import { INTERNAL_PROJECT_ID } from '@shared/projects';
import { type ViewDefinition } from '@renderer/app/view-registry';
import {
  getTaskManagerStore,
  getTaskStore,
  taskViewKind,
} from '@renderer/features/tasks/stores/task-selectors';
import {
  ProvisionedTaskProvider,
  TaskViewWrapper,
  useProvisionedTask,
} from '@renderer/features/tasks/task-view-context';
import { events } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { createTaskCommandProvider } from './commands';
import { EditorProvider } from './editor/editor-provider';
import { useIsActiveTask } from './hooks/use-is-active-task';
import { TaskMainPanel } from './main-panel';
import { TaskTitlebar } from './task-titlebar';

/**
 * Syncs TabManagerStore.isVisible with the active task state.
 * Controls telemetry conversation scope.
 */
const TabManagerVisibilitySync = observer(function TabManagerVisibilitySync({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const { taskView } = useProvisionedTask();
  const isActive = useIsActiveTask(taskId);
  const activeConversationId = taskView.tabManager.activeConversationId;
  const { navigate } = useNavigate();

  useEffect(() => {
    taskView.tabManager.setVisible(isActive);
    return () => {
      taskView.tabManager.setVisible(false);
    };
  }, [taskView.tabManager, isActive]);

  // Drafts tasks replace the old projectless view; when their active agent
  // process exits, return to home instead of leaving an empty task shell open.
  useEffect(() => {
    if (!isActive || projectId !== INTERNAL_PROJECT_ID || !activeConversationId) return;
    return events.on(agentSessionExitedChannel, (event) => {
      if (event.projectId !== projectId) return;
      if (event.taskId !== taskId) return;
      if (event.conversationId !== activeConversationId) return;
      navigate('home');
    });
  }, [activeConversationId, isActive, navigate, projectId, taskId]);

  return null;
});

const TaskViewWrapperWithProviders = observer(function TaskViewWrapperWithProviders({
  children,
  projectId,
  taskId,
}: {
  children: ReactNode;
  projectId: string;
  taskId: string;
}) {
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);

  // Auto-provision when the task view is rendered with an idle task — covers
  // session restore where the task wasn't in openTaskIds, direct navigation,
  // and any other path that lands on the task view before provisioning runs.
  useEffect(() => {
    if (kind !== 'idle') return;
    if (taskStore && 'archivedAt' in taskStore.data && taskStore.data.archivedAt) return;

    getTaskManagerStore(projectId)
      ?.provisionTask(taskId)
      .catch(() => {});
  }, [kind, projectId, taskId, taskStore]);

  if (kind !== 'ready') {
    return (
      <TaskViewWrapper projectId={projectId} taskId={taskId}>
        {children}
      </TaskViewWrapper>
    );
  }

  return (
    <TaskViewWrapper projectId={projectId} taskId={taskId}>
      <ProvisionedTaskProvider projectId={projectId} taskId={taskId}>
        <TabManagerVisibilitySync projectId={projectId} taskId={taskId} />
        <EditorProvider key={taskId} taskId={taskId} projectId={projectId}>
          {children}
        </EditorProvider>
      </ProvisionedTaskProvider>
    </TaskViewWrapper>
  );
});

export const taskView = {
  WrapView: TaskViewWrapperWithProviders,
  TitlebarSlot: TaskTitlebar,
  MainPanel: TaskMainPanel,
  commandProvider: ({ projectId, taskId }: { projectId: string; taskId: string }) =>
    createTaskCommandProvider(projectId, taskId),
} satisfies ViewDefinition<{ projectId: string; taskId: string }>;
