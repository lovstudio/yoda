import { Avatar, Style } from '@dicebear/core';
import lorelei from '@dicebear/styles/lorelei.json';

const loreleiStyle = new Style(lorelei);

const PRESET_DEFINITIONS = [
  ['ada', 'b6e3f4'],
  ['milo', 'ffd5dc'],
  ['nova', 'c0aede'],
  ['kai', 'd1f4d1'],
  ['luna', 'ffdfbf'],
  ['remy', 'c7d2fe'],
  ['sora', 'fde68a'],
  ['cleo', 'fbcfe8'],
  ['theo', 'bae6fd'],
  ['niko', 'ddd6fe'],
  ['ivy', 'bbf7d0'],
  ['zuri', 'fed7aa'],
  ['finn', 'fecdd3'],
  ['maya', 'bfdbfe'],
  ['rio', 'e9d5ff'],
  ['sage', 'd9f99d'],
] as const;

export type AvatarPreset = {
  id: string;
  value: string;
};

export const AVATAR_PRESETS: AvatarPreset[] = PRESET_DEFINITIONS.map(([seed, backgroundColor]) => ({
  id: seed,
  value: new Avatar(loreleiStyle, {
    seed: `yoda-${seed}`,
    size: 128,
    scale: 0.9,
    borderRadius: 18,
    backgroundColor: [backgroundColor],
  }).toDataUri(),
}));
