import { createRPCController } from '@shared/ipc/rpc';
import { generateTaskName } from './name-generation/generateTaskName';
import {
  getTaskNamingContextPreview,
  getTaskNamingSnapshot,
} from './name-generation/task-naming-service';
import { archiveTask } from './operations/archiveTask';
import { createTask, retryTaskSetup } from './operations/createTask';
import { deleteTask } from './operations/deleteTask';
import { generateTaskCommitMessage } from './operations/generateTaskCommitMessage';
import { getTaskPreview } from './operations/getTaskPreview';
import { getTasks } from './operations/getTasks';
import { getWorkspaceSettings } from './operations/getWorkspaceSettings';
import { mergeTaskBranch } from './operations/mergeTaskBranch';
import { moveTaskStatus } from './operations/moveTaskStatus';
import { regenerateTaskName } from './operations/regenerateTaskName';
import { renameTask } from './operations/renameTask';
import { restoreTask } from './operations/restoreTask';
import { setTaskNeedsReview } from './operations/setTaskNeedsReview';
import { setTaskParent } from './operations/setTaskParent';
import { setTaskPinned } from './operations/setTaskPinned';
import { teardownTask } from './operations/teardownTask';
import { updateLinkedIssue, updateLinkedIssues } from './operations/updateLinkedIssue';
import { updateTaskStatus } from './operations/updateTaskStatus';
import { provisionTask } from './provisionTask';

export const taskController = createRPCController({
  createTask,
  retryTaskSetup,
  getTasks,
  getTaskPreview,
  deleteTask,
  generateTaskName,
  regenerateTaskName,
  getTaskNamingContextPreview,
  getTaskNamingSnapshot,
  archiveTask,
  restoreTask,
  renameTask,
  mergeTaskBranch,
  generateTaskCommitMessage,
  provisionTask,
  teardownTask,
  getWorkspaceSettings,
  updateLinkedIssue,
  updateLinkedIssues,
  updateTaskStatus,
  moveTaskStatus,
  setTaskPinned,
  setTaskNeedsReview,
  setTaskParent,
});
