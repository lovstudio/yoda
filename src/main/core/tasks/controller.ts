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
import {
  getActiveTasks,
  getArchivedTasks,
  getTask,
  getTaskCounts,
  getTasks,
  getTasksByIds,
} from './operations/getTasks';
import { getWorkspaceSettings } from './operations/getWorkspaceSettings';
import { mergeTaskBranch } from './operations/mergeTaskBranch';
import { moveTaskStatus } from './operations/moveTaskStatus';
import { moveTaskToProject } from './operations/moveTaskToProject';
import { regenerateTaskName } from './operations/regenerateTaskName';
import { renameTask } from './operations/renameTask';
import { restoreTask } from './operations/restoreTask';
import { setTaskFavorite } from './operations/setTaskFavorite';
import { setTaskLongTerm } from './operations/setTaskLongTerm';
import { setTaskNeedsReview } from './operations/setTaskNeedsReview';
import { setTaskParent } from './operations/setTaskParent';
import { setTaskPinned } from './operations/setTaskPinned';
import { suggestTaskName } from './operations/suggestTaskName';
import { teardownTask } from './operations/teardownTask';
import { updateLinkedIssue, updateLinkedIssues } from './operations/updateLinkedIssue';
import { updateTaskStatus } from './operations/updateTaskStatus';
import { provisionTask } from './provisionTask';

export const taskController = createRPCController({
  createTask,
  retryTaskSetup,
  getTasks,
  getActiveTasks,
  getArchivedTasks,
  getTask,
  getTasksByIds,
  getTaskCounts,
  getTaskPreview,
  deleteTask,
  generateTaskName,
  regenerateTaskName,
  suggestTaskName,
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
  setTaskFavorite,
  setTaskLongTerm,
  setTaskNeedsReview,
  setTaskParent,
  moveTaskToProject,
});
