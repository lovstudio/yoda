import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('home run-mode confirmation', () => {
  it('requires confirmation after an Agent assignment or profile change', () => {
    const home = readFileSync(new URL('./home-view.tsx', import.meta.url), 'utf8');

    expect(home).toContain('const [configurationDirty, setConfigurationDirty] = useState(false);');
    expect(home).toContain('configurationDirty ||');
    expect(home).toContain(
      'renderConfiguration(pending.mode, pending.teamId, () => setConfigurationDirty(true))'
    );
    expect(home).toContain('onConfigurationChange={onConfigurationChange}');
    expect(home).toContain('onSlotAgentChange(key, agentId);\n        onConfigurationChange();');
    expect(home).toContain('onSuccess: () => onConfigurationChange()');
  });
});
