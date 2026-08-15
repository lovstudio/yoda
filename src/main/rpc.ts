import { createRPCRouter } from '../shared/ipc/rpc';
import { accountController } from './core/account/controller';
import { agentHooksController } from './core/agent-hooks/controller';
import { agentsConfigController } from './core/agents-config/controller';
import { aiLabController } from './core/ai-lab/controller';
import { aiLogsController } from './core/ai-logs/controller';
import { appController } from './core/app/controller';
import { asanaController } from './core/asana/controller';
import { automationController } from './core/automation/controller';
import { browserSessionHealthController } from './core/browser-session-health/controller';
import { conversationController } from './core/conversations/controller';
import { dependenciesController } from './core/dependencies/controller';
import { doctorController } from './core/doctor/controller';
import { editorBufferController } from './core/editor/controller';
import { extensionsController } from './core/extensions/controller';
import { featurebaseController } from './core/featurebase/controller';
import { feishuController } from './core/feishu/controller';
import { forgejoController } from './core/forgejo/controller';
import { filesController } from './core/fs/controller';
import { gitController } from './core/git/controller';
import { githubController } from './core/github/controller';
import { gitlabController } from './core/gitlab/controller';
import { issueController } from './core/issues/controller';
import { jiraController } from './core/jira/controller';
import { linearController } from './core/linear/controller';
import { llmController } from './core/llm/controller';
import { lovcodeController } from './core/lovcode/controller';
import { maasController } from './core/maas/controller';
import { mcpController } from './core/mcp/controller';
import { mobileGatewayController } from './core/mobile-gateway/controller';
import { mondayController } from './core/monday/controller';
import { notionController } from './core/notion/controller';
import { paradigmsController } from './core/paradigms/controller';
import { plainController } from './core/plain/controller';
import { planeController } from './core/plane/controller';
import { pluginsController } from './core/plugins/controller';
import { projectController } from './core/projects/controller';
import { promptLibraryController } from './core/prompt-library/controller';
import { ptyController } from './core/pty/controller';
import { pullRequestController } from './core/pull-requests/controller';
import { quickActionsController } from './core/quick-actions/controller';
import { repositoryController } from './core/repository/controller';
import { searchController } from './core/search/controller';
import { sessionSharesController } from './core/session-shares/controller';
import { settingsSyncController } from './core/settings-sync/controller';
import { appSettingsController } from './core/settings/controller';
import { runtimeSettingsController } from './core/settings/runtime-settings-controller';
import { skillsController } from './core/skills/controller';
import { sshController } from './core/ssh/controller';
import { statsController } from './core/stats/controller';
import { taskController } from './core/tasks/controller';
import { teamRoomController } from './core/team-rooms/controller';
import { telemetryController } from './core/telemetry/controller';
import { terminalsController } from './core/terminals/controller';
import { trelloController } from './core/trello/controller';
import { updateController } from './core/updates/controller';
import { viewStateController } from './core/view-state/controller';
import { workspaceController } from './core/workspaces/controller';
import { legacyPortController } from './db/legacy-port/controller';

export const rpcRouter = createRPCRouter({
  account: accountController,
  agentHooks: agentHooksController,
  agentsConfig: agentsConfigController,
  aiLab: aiLabController,
  aiLogs: aiLogsController,
  automation: automationController,
  browserSessionHealth: browserSessionHealthController,
  legacyPort: legacyPortController,
  app: appController,
  asana: asanaController,
  appSettings: appSettingsController,
  runtimeSettings: runtimeSettingsController,
  settingsSync: settingsSyncController,
  repository: repositoryController,
  fs: filesController,
  update: updateController,
  pty: ptyController,
  featurebase: featurebaseController,
  feishu: feishuController,
  forgejo: forgejoController,
  github: githubController,
  gitlab: gitlabController,
  issues: issueController,
  jira: jiraController,
  linear: linearController,
  llm: llmController,
  lovcode: lovcodeController,
  maas: maasController,
  mobileGateway: mobileGatewayController,
  monday: mondayController,
  notion: notionController,
  plane: planeController,
  plain: plainController,
  paradigms: paradigmsController,
  plugins: pluginsController,
  promptLibrary: promptLibraryController,
  quickActions: quickActionsController,
  skills: skillsController,
  ssh: sshController,
  projects: projectController,
  workspaces: workspaceController,
  stats: statsController,
  tasks: taskController,
  conversations: conversationController,
  terminals: terminalsController,
  trello: trelloController,
  git: gitController,
  dependencies: dependenciesController,
  doctor: doctorController,
  mcp: mcpController,
  editorBuffer: editorBufferController,
  extensions: extensionsController,
  telemetry: telemetryController,
  pullRequests: pullRequestController,
  viewState: viewStateController,
  search: searchController,
  sessionShares: sessionSharesController,
  teamRooms: teamRoomController,
});

export type RpcRouter = typeof rpcRouter;
