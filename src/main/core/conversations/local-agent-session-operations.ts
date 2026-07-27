import { localAgentSessionCatalog } from './local-agent-session-catalog-instance';

export async function listLocalAgentSessions(projectPath?: string) {
  return localAgentSessionCatalog.list({ projectPath });
}

export async function getLocalAgentSessionTranscript(catalogId: string) {
  return localAgentSessionCatalog.getTranscript(catalogId);
}
