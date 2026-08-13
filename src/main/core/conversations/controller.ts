import { createRPCController } from '@shared/ipc/rpc';
import { makePtySessionId } from '@shared/ptySessionId';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import { KeyedTtlSingleFlightCache } from '@main/lib/keyed-ttl-single-flight-cache';
import { archiveConversation } from './archiveConversation';
import { getClaudeStatusline, setClaudeStatusline } from './claude-statusline';
import { createConversation } from './createConversation';
import { deleteConversation } from './deleteConversation';
import {
  getEditableRuntimeInstructionFiles,
  listRuntimeInstructionFileVersions,
  restoreRuntimeInstructionFileVersion,
  saveEditableRuntimeInstructionFile,
} from './editable-instruction-files';
import { forkConversation } from './forkConversation';
import { forkConversationAtPrompt } from './forkConversationAtPrompt';
import {
  generateConversationTitle,
  getConversationNamingPreview,
  getConversationNamingSnapshot,
} from './generateConversationTitle';
import { getActiveRuntimeStatuses } from './getActiveRuntimeStatuses';
import { getArchivedConversationsForTask } from './getArchivedConversationsForTask';
import { getClaudeSessionContext, getClaudeSessionConversation } from './getClaudeSessionContext';
import { getClaudeSessionMetadata } from './getClaudeSessionMetadata';
import {
  getCodexSessionContext,
  getCodexSessionConversation,
  getCodexSessionRuntimeMetadata,
} from './getCodexSessionContext';
import { getCohubSessionContext } from './getCohubSessionContext';
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
import {
  getLocalAgentSessionTranscript,
  listLocalAgentSessions,
} from './local-agent-session-operations';
import { moveConversation } from './moveConversation';
import { getProjectConversationPrompts, getProjectPromptSources } from './project-prompts';
import { getProjectSessionSources } from './project-sessions';
import { renameConversation } from './renameConversation';
import { restartConversation } from './restartConversation';
import { resumeConversation } from './resumeConversation';
import { rewritePrompt } from './rewritePrompt';
import { getProjectDeliverySummaries, getTaskDeliverySummaries } from './session-summary-context';
import { getSessionSummarySnapshot } from './session-summary-snapshot';
import { getStoredConversationSessionSource } from './stored-conversation-session-source';
import { touchConversation } from './touchConversation';
import {
  getConversationTranscript,
  subscribeConversationTranscript,
  unsubscribeConversationTranscript,
} from './transcript-feed';
import { unarchiveConversation } from './unarchiveConversation';

export const SESSION_CONTEXT_RPC_CACHE_TTL_MS = 2_000;
const SESSION_CONTEXT_RPC_CACHE_MAX_ENTRIES = 256;

const claudeSessionContextCache = new KeyedTtlSingleFlightCache<
  Awaited<ReturnType<typeof getClaudeSessionContext>>
>(SESSION_CONTEXT_RPC_CACHE_TTL_MS, SESSION_CONTEXT_RPC_CACHE_MAX_ENTRIES);
const claudeSessionConversationCache = new KeyedTtlSingleFlightCache<
  Awaited<ReturnType<typeof getClaudeSessionConversation>>
>(SESSION_CONTEXT_RPC_CACHE_TTL_MS, SESSION_CONTEXT_RPC_CACHE_MAX_ENTRIES);
const claudeSessionMetadataCache = new KeyedTtlSingleFlightCache<
  Awaited<ReturnType<typeof getClaudeSessionMetadata>>
>(SESSION_CONTEXT_RPC_CACHE_TTL_MS, SESSION_CONTEXT_RPC_CACHE_MAX_ENTRIES);
const codexSessionContextCache = new KeyedTtlSingleFlightCache<
  Awaited<ReturnType<typeof getCodexSessionContext>>
>(SESSION_CONTEXT_RPC_CACHE_TTL_MS, SESSION_CONTEXT_RPC_CACHE_MAX_ENTRIES);
const codexSessionConversationCache = new KeyedTtlSingleFlightCache<
  Awaited<ReturnType<typeof getCodexSessionConversation>>
>(SESSION_CONTEXT_RPC_CACHE_TTL_MS, SESSION_CONTEXT_RPC_CACHE_MAX_ENTRIES);
const codexSessionRuntimeMetadataCache = new KeyedTtlSingleFlightCache<
  Awaited<ReturnType<typeof getCodexSessionRuntimeMetadata>>
>(SESSION_CONTEXT_RPC_CACHE_TTL_MS, SESSION_CONTEXT_RPC_CACHE_MAX_ENTRIES);

function sessionContextCacheKey(parts: ReadonlyArray<string | null | undefined>): string {
  return JSON.stringify(parts);
}

async function getConfiguredClaudeSessionContext(cwd: string, sessionId: string) {
  return claudeSessionContextCache.get(sessionContextCacheKey([cwd, sessionId]), async () => {
    const providerConfig = await runtimeOverrideSettings.getItem('claude');
    const source = await getStoredConversationSessionSource(sessionId);
    return getClaudeSessionContext(cwd, source?.sessionId ?? sessionId, {
      claudeConfigDir:
        source?.runtimeId === 'claude'
          ? source.stateRoot
          : resolveRuntimeStateDirectory('claude', providerConfig),
    });
  });
}

async function getConfiguredClaudeSessionConversation(cwd: string, sessionId: string) {
  return claudeSessionConversationCache.get(sessionContextCacheKey([cwd, sessionId]), async () => {
    const providerConfig = await runtimeOverrideSettings.getItem('claude');
    const source = await getStoredConversationSessionSource(sessionId);
    return getClaudeSessionConversation(cwd, source?.sessionId ?? sessionId, {
      claudeConfigDir:
        source?.runtimeId === 'claude'
          ? source.stateRoot
          : resolveRuntimeStateDirectory('claude', providerConfig),
    });
  });
}

function getCachedClaudeSessionMetadata(cwd: string, sessionId: string) {
  return claudeSessionMetadataCache.get(sessionContextCacheKey([cwd, sessionId]), () =>
    getClaudeSessionMetadata(cwd, sessionId)
  );
}

async function getConfiguredCodexSessionContext(
  cwd: string,
  conversationId: string,
  conversationTitle?: string,
  conversationCreatedAt?: string | null,
  transcriptMode: 'full' | 'harness' = 'full'
) {
  return codexSessionContextCache.get(
    sessionContextCacheKey([
      cwd,
      conversationId,
      conversationTitle,
      conversationCreatedAt,
      transcriptMode,
    ]),
    async () => {
      const providerConfig = await runtimeOverrideSettings.getItem('codex');
      const source = await getStoredConversationSessionSource(conversationId);
      return getCodexSessionContext(
        cwd,
        source?.runtimeId === 'codex' ? source.sessionId : conversationId,
        conversationTitle,
        conversationCreatedAt,
        {
          codexHome:
            source?.runtimeId === 'codex'
              ? source.stateRoot
              : resolveRuntimeStateDirectory('codex', providerConfig),
          transcriptMode,
        }
      );
    }
  );
}

async function getConfiguredCodexSessionConversation(
  cwd: string,
  conversationId: string,
  conversationTitle?: string,
  conversationCreatedAt?: string | null
) {
  return codexSessionConversationCache.get(
    sessionContextCacheKey([cwd, conversationId, conversationTitle, conversationCreatedAt]),
    async () => {
      const providerConfig = await runtimeOverrideSettings.getItem('codex');
      const source = await getStoredConversationSessionSource(conversationId);
      return getCodexSessionConversation(
        cwd,
        source?.runtimeId === 'codex' ? source.sessionId : conversationId,
        conversationTitle,
        conversationCreatedAt,
        {
          codexHome:
            source?.runtimeId === 'codex'
              ? source.stateRoot
              : resolveRuntimeStateDirectory('codex', providerConfig),
        }
      );
    }
  );
}

async function getConfiguredCodexSessionRuntimeMetadata(
  cwd: string,
  conversationId: string,
  conversationTitle?: string,
  conversationCreatedAt?: string | null
) {
  return codexSessionRuntimeMetadataCache.get(
    sessionContextCacheKey([cwd, conversationId, conversationTitle, conversationCreatedAt]),
    async () => {
      const providerConfig = await runtimeOverrideSettings.getItem('codex');
      const source = await getStoredConversationSessionSource(conversationId);
      return getCodexSessionRuntimeMetadata(
        cwd,
        source?.runtimeId === 'codex' ? source.sessionId : conversationId,
        conversationTitle,
        conversationCreatedAt,
        {
          codexHome:
            source?.runtimeId === 'codex'
              ? source.stateRoot
              : resolveRuntimeStateDirectory('codex', providerConfig),
        }
      );
    }
  );
}

export const conversationController = createRPCController({
  getConversations,
  createConversation,
  archiveConversation,
  unarchiveConversation,
  deleteConversation,
  forkConversation,
  forkConversationAtPrompt,
  generateConversationTitle,
  getConversationNamingPreview,
  getConversationNamingSnapshot,
  renameConversation,
  restartConversation: async (
    projectId: string,
    taskId: string,
    conversationId: string,
    initialSize?: { cols: number; rows: number },
    tmuxOverride?: boolean,
    enableSkillKey?: string,
    runtimeOverrides?: Parameters<typeof restartConversation>[6]
  ) => {
    await restartConversation(
      projectId,
      taskId,
      conversationId,
      initialSize,
      tmuxOverride,
      enableSkillKey,
      runtimeOverrides
    );
    return {
      generation: ptySessionRegistry.getGeneration(
        makePtySessionId(projectId, taskId, conversationId)
      ),
    };
  },
  injectConversationPrompt,
  rewritePrompt,
  resumeConversation: async (
    projectId: string,
    taskId: string,
    conversationId: string,
    initialSize?: { cols: number; rows: number }
  ) => {
    const running = await resumeConversation(projectId, taskId, conversationId, initialSize);
    return {
      running,
      generation: ptySessionRegistry.getGeneration(
        makePtySessionId(projectId, taskId, conversationId)
      ),
    };
  },
  interruptConversation,
  getActiveRuntimeStatuses,
  listLocalAgentSessions,
  getLocalAgentSessionTranscript,
  moveConversation,
  getConversationRuntimeStatuses,
  getProjectPromptSources,
  getProjectConversationPrompts,
  getProjectSessionSources,
  getConversationsForTask,
  getArchivedConversationsForTask,
  touchConversation,
  getClaudeSessionMetadata: getCachedClaudeSessionMetadata,
  getClaudeSessionContext: getConfiguredClaudeSessionContext,
  getClaudeSessionConversation: getConfiguredClaudeSessionConversation,
  getClaudeStatusline,
  setClaudeStatusline,
  getCodexSessionContext: getConfiguredCodexSessionContext,
  getCodexSessionConversation: getConfiguredCodexSessionConversation,
  getCodexSessionRuntimeMetadata: getConfiguredCodexSessionRuntimeMetadata,
  getCohubSessionContext,
  getInstructionFiles,
  getRuntimeInstructionFiles,
  getEditableRuntimeInstructionFiles,
  listRuntimeInstructionFileVersions,
  restoreRuntimeInstructionFileVersion,
  saveEditableRuntimeInstructionFile,
  getConversationSessionInfo,
  getSessionSummary,
  getSessionSummaryPreview,
  getSessionSummarySnapshot,
  getTaskDeliverySummaries,
  getProjectDeliverySummaries,
  setManualSessionSummary,
  getConversationTranscript,
  subscribeConversationTranscript,
  unsubscribeConversationTranscript,
});
