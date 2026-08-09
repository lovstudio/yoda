import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('workspace agent sessions', () => {
  const source = readFileSync(new URL('./workspace-runtime-bar.tsx', import.meta.url), 'utf8');

  it('merges live resource sessions with globally routable sessions', () => {
    expect(source).toContain('resourceSnapshot?.agentSessions');
    expect(source).toContain('appState.agentRuntime');
    expect(source).toContain('.runningSessions()');
    expect(source).toContain('const agentSessionCount = agentSessions.length');
    expect(source).toContain('rankWorkspaceAgentSessions');
  });

  it('lists every live session in a dedicated agent module and opens its target', () => {
    expect(source).toContain("t('workspaceRuntime.agents.title')");
    expect(source).toContain('displayedAgentSessions.map((session)');
    expect(source).toContain('setIsAgentPopoverOpen(false)');
    expect(source).toMatch(
      /openTaskTarget\(\s*\{\s*projectId: session\.projectId,\s*taskId: session\.taskId,\s*conversationId: session\.conversationId,\s*\},\s*navigate\s*\)/
    );
  });

  it('shows agent, tmux, and process resource state independently', () => {
    expect(source).toContain('session.tmuxBacked');
    expect(source).toContain('t(`agentStatus.${session.status}`)');
    expect(source).toContain('formatBytes(session.memoryBytes)');
    expect(source).toContain('Math.round(session.cpuPercent)');
    expect(source).not.toContain('const tmuxSessionCount');
  });

  it('keeps cold tmux reclamation explicit and confirmation-gated', () => {
    expect(source).toContain('rpc.app.getTmuxReclamationSnapshot()');
    expect(source).toContain('showConfirmActionModal({');
    expect(source).toContain('rpc.app.cleanupReclaimableTmuxSessions()');
    expect(source).toContain('tmuxReclamation?.reclaimableCount');
  });

  it('uses metrics as tabs so the session and acceptance lists never render together', () => {
    expect(source).toContain(
      "type AgentPanelTab = 'all' | 'working' | 'needs-reply' | 'pending-acceptance'"
    );
    expect(source).toContain('const displayedAgentSessions = agentSessions.filter');
    expect(source).toContain("agentPanelTab !== 'pending-acceptance'");
    expect(source).toContain('displayedAgentSessions.map((session)');
    expect(source).toContain('pendingAcceptanceTasks.map((task)');
  });

  it('keeps restore and archive actions with each pending-acceptance task', () => {
    expect(source).toContain('restorePendingAcceptanceTask(task)');
    expect(source).toContain('archivePendingAcceptanceTask(task)');
    expect(source).toContain('showArchiveWithNote({');
  });

  it('keeps every session compact and removes repeated task context', () => {
    const sessionListStart = source.indexOf('displayedAgentSessions.map((session)');
    const sessionListEnd = source.indexOf("t('workspaceRuntime.agents.empty')", sessionListStart);
    const sessionList = source.slice(sessionListStart, sessionListEnd);

    expect(sessionList).toContain('getDistinctAgentTaskTitle(title, taskTitle)');
    expect(sessionList).toContain('grid-rows-2');
    expect(sessionList).toContain('col-span-2 flex min-w-0 items-center');
    expect(sessionList).not.toContain('mt-1.5 flex flex-wrap');
  });

  it('keeps the idle trigger compact and only adds meaningful active state', () => {
    expect(source).toContain(': String(agentSessionCount)');
    expect(source).toContain("t('workspaceRuntime.agents.triggerAttention'");
    expect(source).toContain("t('workspaceRuntime.agents.triggerWorking'");
    expect(source).not.toContain("t('workspaceRuntime.agents.triggerShort'");
  });

  it('keeps the resource overview focused on four dialog-backed, time-aware metrics', () => {
    expect(source).toContain("t('workspaceRuntime.resources.triggerShort')");
    expect(source).not.toContain(
      '`${formatBytes(resourceSnapshot.memoryBytes)} · ${Math.round(resourceSnapshot.cpuPercent)}%`'
    );
    expect(source).toContain('<WorkspaceResourceTrend');
    expect(source).toContain("label={t('workspaceRuntime.resources.latency')}");
    expect(source).toContain('grid grid-cols-2');
    expect(source).toContain("openResourceDetails('cpu')");
    expect(source).toContain("openResourceDetails('memory')");
    expect(source).toContain("openResourceDetails('latency')");
    expect(source).toContain("openResourceDetails('worktrees')");
    expect(source).toContain('opensDialog');
    expect(source).not.toContain('workspace-worktree-details');
    expect(source).not.toContain('resourceSnapshot.processes');
    expect(source).not.toContain('resourceSnapshot.admission');
    expect(source).not.toContain("t('workspaceRuntime.resources.mainLoop')");
    expect(source).not.toContain("t('workspaceRuntime.resources.rendererLoop')");
  });
});
