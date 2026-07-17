import { createRPCController } from '@shared/ipc/rpc';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import { archiveConversation } from './archiveConversation';
import { getClaudeStatusline, setClaudeStatusline } from './claude-statusline';
import { createConversation } from './createConversation';
import { deleteConversation } from './deleteConversation';
import { forkConversationAtPrompt } from './forkConversationAtPrompt';
import {
  generateConversationTitle,
  getConversationNamingPreview,
  getConversationNamingSnapshot,
} from './generateConversationTitle';
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
import { resolveRuntimeStateDirectory } from './impl/runtime-env';
import { injectConversationPrompt } from './injectConversationPrompt';
import { getInstructionFiles, getRuntimeInstructionFiles } from './instruction-files';
import { interruptConversation } from './interruptConversation';
import { renameConversation } from './renameConversation';
import { restartConversation } from './restartConversation';
import { resumeConversation } from './resumeConversation';
import { rewritePrompt } from './rewritePrompt';
import { getProjectDeliverySummaries } from './session-summary-context';
import { getSessionSummarySnapshot } from './session-summary-snapshot';
import { touchConversation } from './touchConversation';
import {
  getConversationTranscript,
  subscribeConversationTranscript,
  unsubscribeConversationTranscript,
} from './transcript-feed';
import { unarchiveConversation } from './unarchiveConversation';

async function getConfiguredClaudeSessionContext(cwd: string, sessionId: string) {
  const providerConfig = await runtimeOverrideSettings.getItem('claude');
  return getClaudeSessionContext(cwd, sessionId, {
    claudeConfigDir: resolveRuntimeStateDirectory('claude', providerConfig),
  });
}

async function getConfiguredCodexSessionContext(
  cwd: string,
  conversationId: string,
  conversationTitle?: string,
  conversationCreatedAt?: string | null
) {
  const providerConfig = await runtimeOverrideSettings.getItem('codex');
  return getCodexSessionContext(cwd, conversationId, conversationTitle, conversationCreatedAt, {
    codexHome: resolveRuntimeStateDirectory('codex', providerConfig),
  });
}

export const conversationController = createRPCController({
  getConversations,
  createConversation,
  archiveConversation,
  unarchiveConversation,
  deleteConversation,
  forkConversationAtPrompt,
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
  getConversationsForTask,
  getArchivedConversationsForTask,
  touchConversation,
  getClaudeSessionMetadata,
  getClaudeSessionContext: getConfiguredClaudeSessionContext,
  getClaudeStatusline,
  setClaudeStatusline,
  getCodexSessionContext: getConfiguredCodexSessionContext,
  getInstructionFiles,
  getRuntimeInstructionFiles,
  getConversationSessionInfo,
  getSessionSummary,
  getSessionSummaryPreview,
  getSessionSummarySnapshot,
  getProjectDeliverySummaries,
  setManualSessionSummary,
  getConversationTranscript,
  subscribeConversationTranscript,
  unsubscribeConversationTranscript,
});
