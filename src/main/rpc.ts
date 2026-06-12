import { createRPCRouter } from '../shared/ipc/rpc';
import { accountController } from './core/account/controller';
import { agentHooksController } from './core/agent-hooks/controller';
import { agentsConfigController } from './core/agents-config/controller';
import { aiLabController } from './core/ai-lab/controller';
import { appController } from './core/app/controller';
import { conversationController } from './core/conversations/controller';
import { dependenciesController } from './core/dependencies/controller';
import { editorBufferController } from './core/editor/controller';
import { featurebaseController } from './core/featurebase/controller';
import { forgejoController } from './core/forgejo/controller';
import { filesController } from './core/fs/controller';
import { gitController } from './core/git/controller';
import { githubController } from './core/github/controller';
import { gitlabController } from './core/gitlab/controller';
import { issueController } from './core/issues/controller';
import { jiraController } from './core/jira/controller';
import { linearController } from './core/linear/controller';
import { lovcodeController } from './core/lovcode/controller';
import { maasController } from './core/maas/controller';
import { mcpController } from './core/mcp/controller';
import { mobileGatewayController } from './core/mobile-gateway/controller';
import { plainController } from './core/plain/controller';
import { projectController } from './core/projects/controller';
import { ptyController } from './core/pty/controller';
import { pullRequestController } from './core/pull-requests/controller';
import { repositoryController } from './core/repository/controller';
import { searchController } from './core/search/controller';
import { appSettingsController } from './core/settings/controller';
import { runtimeSettingsController } from './core/settings/runtime-settings-controller';
import { skillsController } from './core/skills/controller';
import { sshController } from './core/ssh/controller';
import { statsController } from './core/stats/controller';
import { taskController } from './core/tasks/controller';
import { telemetryController } from './core/telemetry/controller';
import { terminalsController } from './core/terminals/controller';
import { updateController } from './core/updates/controller';
import { viewStateController } from './core/view-state/controller';
import { workspaceController } from './core/workspaces/controller';
import { legacyPortController } from './db/legacy-port/controller';

export const rpcRouter = createRPCRouter({
  account: accountController,
  agentHooks: agentHooksController,
  agentsConfig: agentsConfigController,
  aiLab: aiLabController,
  legacyPort: legacyPortController,
  app: appController,
  appSettings: appSettingsController,
  runtimeSettings: runtimeSettingsController,
  repository: repositoryController,
  fs: filesController,
  update: updateController,
  pty: ptyController,
  featurebase: featurebaseController,
  forgejo: forgejoController,
  github: githubController,
  gitlab: gitlabController,
  issues: issueController,
  jira: jiraController,
  linear: linearController,
  lovcode: lovcodeController,
  maas: maasController,
  mobileGateway: mobileGatewayController,
  plain: plainController,
  skills: skillsController,
  ssh: sshController,
  projects: projectController,
  workspaces: workspaceController,
  stats: statsController,
  tasks: taskController,
  conversations: conversationController,
  terminals: terminalsController,
  git: gitController,
  dependencies: dependenciesController,
  mcp: mcpController,
  editorBuffer: editorBufferController,
  telemetry: telemetryController,
  pullRequests: pullRequestController,
  viewState: viewStateController,
  search: searchController,
});

export type RpcRouter = typeof rpcRouter;
