import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('workspace running agent sessions', () => {
  const source = readFileSync(new URL('./workspace-runtime-bar.tsx', import.meta.url), 'utf8');

  it('shows the running agent count in the persistent resource trigger', () => {
    expect(source).toContain('resourceSnapshot?.activeAgentSessions ?? 0');
    expect(source).toContain("t('workspaceRuntime.resources.runningAgentsShort'");
  });

  it('lists running sessions and opens the selected conversation target', () => {
    expect(source).toContain('runningAgentSessions.map((session)');
    expect(source).toContain('setIsResourcePopoverOpen(false)');
    expect(source).toMatch(
      /openTaskTarget\(\s*\{\s*projectId: session\.projectId,\s*taskId: session\.taskId,\s*conversationId: session\.conversationId,\s*\},\s*navigate\s*\)/
    );
  });

  it('makes the agent metric actionable without turning passive resource metrics into buttons', () => {
    expect(source).toContain('handleRunningAgentMetricClick');
    expect(source).toContain(
      'runningAgentSessions.length > 0 ? handleRunningAgentMetricClick : undefined'
    );
    expect(source).toContain('<WorkspaceResourceMetric');
    expect(source).toContain('controls={\n                runningAgentSessions.length > 1');
  });
});
