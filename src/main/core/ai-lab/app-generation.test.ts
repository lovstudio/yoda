import { describe, expect, it } from 'vitest';
import { buildAppGenerationPrompt, buildAppRefinementPrompt } from './app-generation-contract';

describe('Yoda Build Agent prompt', () => {
  it('requires direct project editing and a checked file artifact', () => {
    const prompt = buildAppGenerationPrompt('做一个旅行打包清单', {
      projectPath: '/workspace/travel',
      systemPrompt: 'Reuse the existing product language.',
    });

    expect(prompt).toContain('做一个旅行打包清单');
    expect(prompt).toContain('/workspace/travel');
    expect(prompt).toContain('Reuse the existing product language.');
    expect(prompt).toContain('Directly inspect, create, and edit project files');
    expect(prompt).toContain('Do not print source code into the conversation');
    expect(prompt).toContain('React, Vite, TypeScript');
    expect(prompt).toContain('src/components/ui');
    expect(prompt).toContain('pnpm run check');
    expect(prompt).toContain('.yoda/app.json');
    expect(prompt).toContain('status "ready"');
    expect(prompt).not.toContain('one complete HTML document');
    expect(prompt).not.toContain('YODA_APP_HTML');
  });

  it('continues from existing project files and explains legacy migration', () => {
    const prompt = buildAppRefinementPrompt('Add laps without losing saved settings', {
      appName: 'Timer',
      projectPath: '/workspace/timer',
      legacySource: true,
    });

    expect(prompt).toContain('IMPROVE THE EXISTING APP "Timer"');
    expect(prompt).toContain('Add laps without losing saved settings');
    expect(prompt).toContain('Preserve working behavior and user data');
    expect(prompt).toContain('legacy/index.html');
    expect(prompt).toContain('Rebuild the product as maintainable React components');
  });
});
