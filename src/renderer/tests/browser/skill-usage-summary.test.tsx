import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillUsageStat } from '@shared/skills/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { time?: string }) =>
      key === 'common.ago' ? `${options?.time} ago` : key,
    i18n: { language: 'en' },
  }),
}));

const usage: SkillUsageStat = {
  skill: 'frontend-design',
  total: 42,
  manual: 2,
  auto: 40,
  lastUsedAt: '2026-07-29T07:00:00.000Z',
  daily: { '2026-07-29': 42 },
};

describe('SkillUsageSummary', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T10:00:00.000Z'));
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it('shows invocation count and last-used relative time together', async () => {
    const { default: SkillUsageSummary } = await import(
      '@renderer/features/skills/components/SkillUsageSummary'
    );
    await act(async () => root.render(createElement(SkillUsageSummary, { usage })));

    expect(host.textContent).toContain('42');
    expect(host.textContent).toContain('3h ago');
    expect(host.querySelector('time')?.dateTime).toBe(usage.lastUsedAt);
  });
});
