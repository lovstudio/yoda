import type { AgentTeam } from '@shared/agent-team';
import type { Agent } from '@shared/agents';
import type { ParadigmEntry } from './entries';

/**
 * What a paradigm's configuration panel gets. A kind reads only what it needs —
 * the slot seats are rendered generically from its descriptor, so a panel
 * contribution exists purely for what a kind adds beyond its seats.
 */
export interface ParadigmPanelProps {
  entry: ParadigmEntry;
  teams: AgentTeam[];
  agents: Agent[];
  slotAgentId: (slotKey: string) => string | null;
  onSlotAgentChange: (slotKey: string, agentId: string) => void;
  onConfigurationChange: () => void;
}
