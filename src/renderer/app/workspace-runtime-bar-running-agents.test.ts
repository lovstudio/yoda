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
    expect(source).toContain('agentSessions.map((session)');
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
  });

  it('keeps the resource overview focused on four expandable and time-aware metrics', () => {
    expect(source).toContain('<WorkspaceResourceTrend');
    expect(source).toContain("label={t('workspaceRuntime.resources.latency')}");
    expect(source).toContain('controls="workspace-worktree-details"');
    expect(source).toContain('grid grid-cols-2');
    expect(source).not.toContain('resourceSnapshot.processes');
    expect(source).not.toContain('resourceSnapshot.admission');
    expect(source).not.toContain("t('workspaceRuntime.resources.mainLoop')");
    expect(source).not.toContain("t('workspaceRuntime.resources.rendererLoop')");
  });
});
