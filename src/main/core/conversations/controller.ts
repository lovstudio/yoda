import { createRPCController } from '@shared/ipc/rpc';
import { archiveConversation } from './archiveConversation';
import { getClaudeStatusline, setClaudeStatusline } from './claude-statusline';
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
import {
  getSessionSummary,
  getSessionSummaryPreview,
  setManualSessionSummary,
} from './getSessionSummary';
import { injectConversationPrompt } from './injectConversationPrompt';
import { getInstructionFiles, getRuntimeInstructionFiles } from './instruction-files';
import { interruptConversation } from './interruptConversation';
import { renameConversation } from './renameConversation';
import { restartConversation } from './restartConversation';
import { resumeConversation } from './resumeConversation';
import { rewritePrompt } from './rewritePrompt';
import { getSessionSummarySnapshot } from './session-summary-snapshot';
import { touchConversation } from './touchConversation';
import {
  getConversationTranscript,
  subscribeConversationTranscript,
  unsubscribeConversationTranscript,
} from './transcript-feed';
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
  injectConversationPrompt,
  rewritePrompt,
  resumeConversation,
  interruptConversation,
  getConversationRuntimeStatuses,
  getAllRuntimeStatuses,
  getConversationsForTask,
  getArchivedConversationsForTask,
  touchConversation,
  getClaudeSessionMetadata,
  getClaudeSessionContext,
  getClaudeStatusline,
  setClaudeStatusline,
  getCodexSessionContext,
  getInstructionFiles,
  getRuntimeInstructionFiles,
  getConversationSessionInfo,
  getSessionSummary,
  getSessionSummaryPreview,
  getSessionSummarySnapshot,
  setManualSessionSummary,
  getConversationTranscript,
  subscribeConversationTranscript,
  unsubscribeConversationTranscript,
});
