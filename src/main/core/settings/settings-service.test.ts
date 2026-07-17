import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDreamSkinTheme } from '@shared/custom-theme';
import { SettingsStore } from './settings-service';

const mocks = vi.hoisted(() => ({
  selectExecute: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ execute: mocks.selectExecute }),
      }),
    }),
  },
}));

beforeEach(() => {
  mocks.selectExecute.mockReset();
});

describe('SettingsStore', () => {
  it('applies schema defaults when reading a legacy Dream Skin', async () => {
    const theme = createDreamSkinTheme({
      id: 'legacy-dream',
      name: 'Legacy Dream',
      image: 'data:image/png;base64,aA==',
      imageName: 'legacy.png',
    });
    const {
      imageTreatment: _imageTreatment,
      decorations: _decorations,
      ...legacySkin
    } = theme.skin!;
    const storedValue = {
      items: [{ ...theme, schemaVersion: 1 as const, skin: legacySkin }],
    };
    mocks.selectExecute.mockResolvedValue([
      { key: 'customThemes', value: JSON.stringify(storedValue) },
    ]);

    const result = await new SettingsStore().get('customThemes');

    expect(result.items[0]?.skin?.imageTreatment).toMatchObject({
      positionX: 50,
      positionY: 50,
      zoom: 1,
      overlayStrength: 0.34,
    });
    expect(result.items[0]?.skin?.decorations).toEqual({
      preset: 'glow',
      density: 0.55,
      motion: true,
    });
  });

  it('falls back to defaults instead of exposing schema-invalid settings', async () => {
    mocks.selectExecute.mockResolvedValue([
      { key: 'customThemes', value: JSON.stringify({ items: [{ id: 'broken' }] }) },
    ]);

    const result = await new SettingsStore().getWithMeta('customThemes');

    expect(result.value).toEqual({ items: [] });
    expect(result.overrides).toEqual({});
  });
});
