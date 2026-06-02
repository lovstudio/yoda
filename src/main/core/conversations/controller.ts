import { createRPCController } from '@shared/ipc/rpc';
import { createConversation } from './createConversation';
import { deleteConversation } from './deleteConversation';
import { getClaudeSessionContext } from './getClaudeSessionContext';
import { getClaudeSessionMetadata } from './getClaudeSessionMetadata';
import { getCodexSessionContext } from './getCodexSessionContext';
import { getConversations } from './getConversations';
import { getConversationsForTask } from './getConversationsForTask';
import { renameConversation } from './renameConversation';
import { resumeConversation } from './resumeConversation';
import { touchConversation } from './touchConversation';

export const conversationController = createRPCController({
  getConversations,
  createConversation,
  deleteConversation,
  renameConversation,
  resumeConversation,
  getConversationsForTask,
  touchConversation,
  getClaudeSessionMetadata,
  getClaudeSessionContext,
  getCodexSessionContext,
});
