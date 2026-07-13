import { RELEASE_DIR } from './lib/config.ts';
import { info, step } from './lib/log.ts';
import { refreshMacUpdateMetadata } from './lib/mac-update-metadata.ts';

step('Refreshing macOS DMG blockmaps and update metadata');
const result = await refreshMacUpdateMetadata({ releaseDir: RELEASE_DIR });
for (const artifact of result.artifacts) {
  info(`Refreshed ${artifact} and ${artifact}.blockmap`);
}
info(`Updated ${result.manifestPath}`);
