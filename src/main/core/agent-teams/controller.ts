import type { AgentTeam, AgentTeamDraft } from '@shared/agent-team';
import { createRPCController } from '@shared/ipc/rpc';
import { agentTeamsService } from './agent-teams-service';

export const agentTeamsController = createRPCController({
  list: (): Promise<AgentTeam[]> => agentTeamsService.list(),
  get: (id: string): Promise<AgentTeam | null> => agentTeamsService.get(id),
  create: (draft: AgentTeamDraft): Promise<AgentTeam> => agentTeamsService.create(draft),
  update: (id: string, draft: AgentTeamDraft): Promise<AgentTeam> =>
    agentTeamsService.update(id, draft),
  remove: (id: string): Promise<void> => agentTeamsService.remove(id),
  duplicate: (id: string): Promise<AgentTeam> => agentTeamsService.duplicate(id),
});
