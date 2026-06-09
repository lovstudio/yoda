import { createRPCController } from '@shared/ipc/rpc';
import { archiveConversation } from './archiveConversation';
import { createConversation } from './createConversation';
import { deleteConversation } from './deleteConversation';
import { getAllRuntimeStatuses } from './getAllRuntimeStatuses';
import { getClaudeSessionContext } from './getClaudeSessionContext';
import { getClaudeSessionMetadata } from './getClaudeSessionMetadata';
import { getCodexSessionContext } from './getCodexSessionContext';
import { getConversationRuntimeStatuses } from './getConversationRuntimeStatuses';
import { getConversations } from './getConversations';
import { getConversationSessionInfo } from './getConversationSessionInfo';
import { getConversationsForTask } from './getConversationsForTask';
import { getSessionSummary } from './getSessionSummary';
import { renameConversation } from './renameConversation';
import { restartConversation } from './restartConversation';
import { resumeConversation } from './resumeConversation';
import { touchConversation } from './touchConversation';

export const conversationController = createRPCController({
  getConversations,
  createConversation,
  archiveConversation,
  deleteConversation,
  renameConversation,
  restartConversation,
  resumeConversation,
  getConversationRuntimeStatuses,
  getAllRuntimeStatuses,
  getConversationsForTask,
  touchConversation,
  getClaudeSessionMetadata,
  getClaudeSessionContext,
  getCodexSessionContext,
  getConversationSessionInfo,
  getSessionSummary,
});
