import type { AgentTeamMember } from '@shared/agent-team';
import type { Agent } from '@shared/agents';
import type { ParadigmEntry } from './entries';

/**
 * What a paradigm's configuration panel gets.
 *
 * The roster is rendered generically above it — every paradigm is a set of Agents,
 * whatever kind stores it — so a panel contribution exists purely for what a kind
 * adds beyond who is on the list.
 */
export interface ParadigmPanelProps {
  entry: ParadigmEntry;
  agents: Agent[];
  /** The Agents this instance runs with, already read out of its params. */
  roster: AgentTeamMember[];
  onRosterChange: (members: AgentTeamMember[]) => void;
  onConfigurationChange: () => void;
}
