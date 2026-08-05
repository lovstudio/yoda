import { describe, expect, it } from 'vitest';
import { buildAiLabAppBasicInfo, type AiLabAppBasicInfoLabels } from './ai-lab-app-basic-info';

const labels: AiLabAppBasicInfoLabels = {
  app: 'App',
  description: 'Description',
  appId: 'App ID',
  yodaLink: 'Yoda link',
  projectId: 'Project ID',
  projectPath: 'Project path',
  runtimeKind: 'App runtime',
  runtime: 'Development agent',
  model: 'Model',
  capabilities: 'Capabilities',
  startCommand: 'Headless start command',
};

describe('buildAiLabAppBasicInfo', () => {
  it('builds agent-ready app information without the original creation prompt', () => {
    const value = buildAiLabAppBasicInfo(
      {
        appName: 'Trip planner',
        description: 'Plans a focused trip.',
        appId: 'app-1',
        yodaLink: 'yoda://app/app-1',
        projectId: 'project-1',
        projectPath: '/repo/trip-planner',
        startCommand: 'pnpm run dev',
        runtimeKind: 'react-vite',
        runtimeName: 'Codex',
        model: 'gpt-5',
        capabilities: ['ai.image.edit'],
      },
      labels
    );

    expect(value).toBe(
      [
        'App: Trip planner',
        'Description: Plans a focused trip.',
        'App ID: app-1',
        'Yoda link: yoda://app/app-1',
        'Project ID: project-1',
        'Project path: /repo/trip-planner',
        'Headless start command: pnpm run dev',
        'App runtime: react-vite',
        'Development agent: Codex',
        'Model: gpt-5',
        'Capabilities: ai.image.edit',
      ].join('\n')
    );
    expect(value).not.toContain('original creation prompt');
  });

  it('omits unavailable optional fields', () => {
    expect(
      buildAiLabAppBasicInfo(
        { appName: 'Legacy app', appId: 'legacy-1', yodaLink: 'yoda://app/legacy-1' },
        labels
      )
    ).toBe('App: Legacy app\nApp ID: legacy-1\nYoda link: yoda://app/legacy-1');
  });

  it('returns undefined without usable fields', () => {
    expect(buildAiLabAppBasicInfo({}, labels)).toBeUndefined();
  });
});
