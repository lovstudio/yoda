import { NewConversationModal } from '@renderer/app/new-conversation-modal';
import { NewSubtaskModal } from '@renderer/app/new-subtask-modal';
import { NewTaskModal } from '@renderer/app/new-task-modal';
import { AgentEditModal } from '@renderer/features/agents-config/agent-edit-modal';
import { CommandPaletteModal } from '@renderer/features/command-palette/command-palette-modal';
import { IntegrationSetupModal } from '@renderer/features/integrations/integration-setup-modal';
import { McpModal } from '@renderer/features/mcp/components/McpModal';
import { AddProjectModal } from '@renderer/features/projects/components/add-project-modal/add-project-modal';
import { ManageRunScriptsModal } from '@renderer/features/projects/components/manage-run-scripts-modal';
import { ManageQuickActionsModal } from '@renderer/features/projects/components/overview-view/manage-quick-actions-modal';
import { RenameProjectModal } from '@renderer/features/projects/components/rename-project-modal';
import { ShareProjectConfigModal } from '@renderer/features/projects/components/settings-view/share-project-config-modal';
import { CreateSkillModal } from '@renderer/features/skills/components/CreateSkillModal';
import { AddRemoteModal } from '@renderer/features/tasks/add-remote-modal';
import { ArchiveTaskWithNoteModal } from '@renderer/features/tasks/archive-task-with-note-modal';
import { ArchivedSessionTranscriptModal } from '@renderer/features/tasks/archived-session-transcript-modal';
import { CreateTaskModal } from '@renderer/features/tasks/create-task-modal/create-task-modal';
import { CreatePrModal } from '@renderer/features/tasks/diff-view/changes-panel/components/pr-entry/create-pr-modal';
import { ConflictDialog } from '@renderer/features/tasks/editor/conflict-dialog';
import { RenameConversationModal } from '@renderer/features/tasks/rename-conversation-modal';
import { RenameTaskModal } from '@renderer/features/tasks/rename-task-modal';
import { SessionPromptsModal } from '@renderer/features/tasks/session-prompts-modal';
import { SetParentTaskModal } from '@renderer/features/tasks/set-parent-task-modal';
import { CreateWorkspaceModal } from '@renderer/features/workspaces/create-workspace-modal';
import { ProjectWorkspaceConflictModal } from '@renderer/features/workspaces/project-workspace-conflict-modal';
import { AccountDeviceFlowModalOverlay } from '@renderer/lib/components/account-device-flow-modal';
import { AddSshConnModal } from '@renderer/lib/components/add-ssh-conn-modal';
import { ChangeProjectConnectionModal } from '@renderer/lib/components/change-project-connection-modal';
import { ConfirmActionDialog } from '@renderer/lib/components/confirm-action-dialog';
import { FeedbackModal } from '@renderer/lib/components/feedback-modal/feedback-modal';
import { GithubDeviceFlowModalOverlay } from '@renderer/lib/components/github-device-flow-modal';
import { QuitAgentSessionsModal } from '@renderer/lib/components/quit-agent-sessions-modal';
import { type ModalComponent } from '@renderer/lib/modal/modal-provider';

export type ModalSize = 'xs' | 'sm' | 'md' | 'lg';
export type ModalPosition = 'center' | 'top';

export type ModalRegistryEntry<TProps = unknown, TResult = unknown> = {
  component: ModalComponent<TProps, TResult>;
  size?: ModalSize;
  position?: ModalPosition;
};

export function createModal<TProps, TResult>(
  component: ModalComponent<TProps, TResult>,
  config: Omit<ModalRegistryEntry, 'component'> = {}
): ModalRegistryEntry<TProps, TResult> {
  return { component, ...config };
}

export const modalRegistry = {
  commandPaletteModal: createModal(CommandPaletteModal, { size: 'md' }),
  taskModal: createModal(CreateTaskModal),
  newTaskModal: createModal(NewTaskModal, { size: 'lg' }),
  newConversationModal: createModal(NewConversationModal, { size: 'lg' }),
  newSubtaskModal: createModal(NewSubtaskModal, { size: 'lg' }),
  addProjectModal: createModal(AddProjectModal),
  addSshConnModal: createModal(AddSshConnModal),
  changeProjectConnectionModal: createModal(ChangeProjectConnectionModal, { size: 'sm' }),
  githubDeviceFlowModal: createModal(GithubDeviceFlowModalOverlay, { size: 'sm' }),
  accountDeviceFlowModal: createModal(AccountDeviceFlowModalOverlay, { size: 'sm' }),
  confirmActionModal: createModal(ConfirmActionDialog, { size: 'xs' }),
  feedbackModal: createModal(FeedbackModal),
  mcpServerModal: createModal(McpModal),
  createSkillModal: createModal(CreateSkillModal),
  agentEditModal: createModal(AgentEditModal, { size: 'lg' }),
  conflictDialog: createModal(ConflictDialog, { size: 'sm' }),
  createPrModal: createModal(CreatePrModal, { size: 'md' }),
  renameTaskModal: createModal(RenameTaskModal, { size: 'xs' }),
  renameConversationModal: createModal(RenameConversationModal, { size: 'xs' }),
  setParentTaskModal: createModal(SetParentTaskModal, { size: 'sm' }),
  sessionPromptsModal: createModal(SessionPromptsModal, { size: 'lg' }),
  renameProjectModal: createModal(RenameProjectModal, { size: 'xs' }),
  createWorkspaceModal: createModal(CreateWorkspaceModal, { size: 'xs' }),
  projectWorkspaceConflictModal: createModal(ProjectWorkspaceConflictModal, { size: 'sm' }),
  archiveTaskWithNoteModal: createModal(ArchiveTaskWithNoteModal, { size: 'xs' }),
  archivedSessionTranscriptModal: createModal(ArchivedSessionTranscriptModal, { size: 'lg' }),
  shareProjectConfigModal: createModal(ShareProjectConfigModal, { size: 'md' }),
  manageRunScriptsModal: createModal(ManageRunScriptsModal, { size: 'md' }),
  manageQuickActionsModal: createModal(ManageQuickActionsModal, { size: 'md' }),
  integrationSetupModal: createModal(IntegrationSetupModal, { size: 'md' }),
  addRemoteModal: createModal(AddRemoteModal),
  quitAgentSessionsModal: createModal(QuitAgentSessionsModal, { size: 'md' }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<string, ModalRegistryEntry<any, any>>;
