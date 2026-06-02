import type { AgentProviderId } from '@shared/agent-provider-registry';

export type Conversation = {
  id: string;
  projectId: string;
  taskId: string;
  providerId: AgentProviderId;
  title: string;
  lastInteractedAt: string | null;
  resume?: boolean;
  autoApprove?: boolean;
  isInitialConversation: boolean | null;
};

export type RenameConversationParams = {
  conversationId: string;
  newTitle: string;
};

export type ClaudeTodoStatus = 'pending' | 'in_progress' | 'completed';

export type ClaudeTodo = {
  content: string;
  activeForm?: string;
  status: ClaudeTodoStatus;
};

export type ClaudeSessionMetadata = {
  summary: string | null;
  todos: ClaudeTodo[];
  model: string | null;
};

export type ClaudeSessionPrompt = {
  id: string;
  text: string;
  timestamp: string | null;
};

export type ClaudeMemoryFile = {
  kind: 'global-claude' | 'project-claude' | 'project-agents';
  path: string;
  content: string;
  bytes: number;
};

export type CodexMemoryFile = {
  kind: 'global-codex-agents' | 'project-agents' | 'project-codex-agents';
  path: string;
  content: string;
  bytes: number;
};

export type ClaudeMcpServer = {
  name: string;
  instructions: string;
};

export type ClaudeSessionContext = {
  transcriptPath: string;
  memoryFiles: ClaudeMemoryFile[];
  tools: string[];
  agents: string[];
  mcpServers: ClaudeMcpServer[];
  skillsListing: string | null;
  prompts: ClaudeSessionPrompt[];
};

export type CodexDynamicTool = {
  name: string;
  namespace: string | null;
  description: string;
  inputSchema: string;
  deferLoading: boolean;
};

export type CodexTurnContext = {
  turnId: string | null;
  model: string | null;
  approvalPolicy: string | null;
  sandboxPolicy: string | null;
  effort: string | null;
};

export type CodexSessionContext = {
  threadId: string;
  rolloutPath: string | null;
  title: string;
  cwd: string;
  model: string | null;
  modelProvider: string | null;
  cliVersion: string | null;
  memoryMode: string | null;
  approvalMode: string | null;
  sandboxPolicy: string | null;
  baseInstructions: string | null;
  developerMessages: ClaudeSessionPrompt[];
  memoryFiles: CodexMemoryFile[];
  dynamicTools: CodexDynamicTool[];
  skillsListing: string | null;
  prompts: ClaudeSessionPrompt[];
  turnContexts: CodexTurnContext[];
};

export type CreateConversationParams = {
  id: string;
  projectId: string;
  taskId: string;
  provider: AgentProviderId;
  title: string;
  autoApprove?: boolean;
  isInitialConversation?: boolean;
  initialSize?: { cols: number; rows: number };
  initialPrompt?: string;
};
