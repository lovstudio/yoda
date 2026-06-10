import { createRPCController } from '@shared/ipc/rpc';
import { archiveConversation } from './archiveConversation';
import { createConversation } from './createConversation';
import { deleteConversation } from './deleteConversation';
import {
  generateConversationTitle,
  getConversationNamingPreview,
  getConversationNamingSnapshot,
} from './generateConversationTitle';
import { getAllRuntimeStatuses } from './getAllRuntimeStatuses';
import { getArchivedConversationsForTask } from './getArchivedConversationsForTask';
import { getClaudeSessionContext } from './getClaudeSessionContext';
import { getClaudeSessionMetadata } from './getClaudeSessionMetadata';
import { getCodexSessionContext } from './getCodexSessionContext';
import { getConversationRuntimeStatuses } from './getConversationRuntimeStatuses';
import { getConversations } from './getConversations';
import { getConversationSessionInfo } from './getConversationSessionInfo';
import { getConversationsForTask } from './getConversationsForTask';
import { getSessionSummary } from './getSessionSummary';
import { interruptConversation } from './interruptConversation';
import { renameConversation } from './renameConversation';
import { restartConversation } from './restartConversation';
import { resumeConversation } from './resumeConversation';
import { touchConversation } from './touchConversation';
import { unarchiveConversation } from './unarchiveConversation';

export const conversationController = createRPCController({
  getConversations,
  createConversation,
  archiveConversation,
  unarchiveConversation,
  deleteConversation,
  generateConversationTitle,
  getConversationNamingPreview,
  getConversationNamingSnapshot,
  renameConversation,
  restartConversation,
  resumeConversation,
  interruptConversation,
  getConversationRuntimeStatuses,
  getAllRuntimeStatuses,
  getConversationsForTask,
  getArchivedConversationsForTask,
  touchConversation,
  getClaudeSessionMetadata,
  getClaudeSessionContext,
  getCodexSessionContext,
  getConversationSessionInfo,
  getSessionSummary,
});
