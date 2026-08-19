import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@shared/agents';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A preset avatar: dicebear hands back a URL-encoded SVG data URI, which is what
// made a raw-text render spill markup across the row.
const PRESET_ICON = 'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2027%206%22%3E%3C%2Fsvg%3E';
const UPLOADED_ICON = 'data:image/png;base64,iVBORw0KGgo=';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/features/agents-config/use-agents', () => ({
  useAgents: () => ({ agents: [fixtureAgent('a', 'Spec Agent', PRESET_ICON)] }),
}));

vi.mock('@renderer/lib/layout/navigation-provider', () => ({
  useNavigate: () => ({ navigate: vi.fn() }),
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useShowModal: () => vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({ rpc: {}, events: {} }));

describe('UtilityAgentPicker', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
    host.remove();
  });

  it('renders an image-backed Agent icon as an image, never as raw text', async () => {
    const { UtilityAgentPicker } = await import(
      '@renderer/features/tasks/components/utility-agent-picker'
    );

    await act(async () =>
      root.render(
        createElement(UtilityAgentPicker, {
          label: 'Agent',
          agentId: 'a',
          onAgentIdChange: vi.fn(),
        })
      )
    );

    expect(host.querySelector('img')?.getAttribute('src')).toBe(PRESET_ICON);
    expect(host.textContent).toContain('Spec Agent');
    expect(host.textContent).not.toContain('data:image');
    expect(host.textContent).not.toContain('%3Csvg');
  });

  it('falls back to the Agent initial for an unrecognized icon payload', async () => {
    const { AgentAvatar } = await import('@renderer/lib/components/agent-card/agent-avatar');

    await act(async () =>
      root.render(
        createElement(AgentAvatar, {
          name: 'Implementer',
          icon: UPLOADED_ICON.replace('data:image/png;base64,', ''),
        })
      )
    );

    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toBe('I');
  });
});

function fixtureAgent(id: string, name: string, icon: string): Agent {
  return {
    id,
    slug: id,
    name,
    description: '',
    icon,
    systemPrompt: '',
    enabledSkillIds: [],
    manualSkillIds: [],
    skillPolicyMode: 'runtime-defaults',
    preferredRuntime: 'codex',
    model: null,
    modelSuffix: null,
    reasoningEffort: null,
    accessMode: 'inherit',
    source: 'local',
    createdAt: '',
    updatedAt: '',
  };
}
