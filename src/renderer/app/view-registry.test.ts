import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('view registry startup boundary', () => {
  it('keeps secondary product surfaces out of the initial renderer chunk', () => {
    const source = readFileSync(new URL('./view-registry.ts', import.meta.url), 'utf8');
    const deferredModules = [
      'agents-config/agent-manager-view',
      'agents/agents-view',
      'ai-lab/ai-lab-view',
      'automation/automation-view',
      'library/library-view',
      'maas/maas-view',
      'mcp/mcp-view',
      'mobile/mobile-view',
      'roadmap/roadmap-view',
      'settings/settings-view',
      'skills/skills-view',
      'usage/usage-view',
    ];

    for (const modulePath of deferredModules) {
      expect(source).toContain(`() => import('@renderer/features/${modulePath}')`);
      expect(source).not.toMatch(
        new RegExp(`^import \\{[^\\n]+\\} from '@renderer/features/${modulePath}'`, 'm')
      );
    }
  });
});
