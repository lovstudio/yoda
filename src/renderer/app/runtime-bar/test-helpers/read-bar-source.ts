import { readFileSync } from 'node:fs';

/**
 * The bar is assembled from one module per entry, so a structural assertion has
 * to read the same set — in registry order, since several of these tests assert
 * that one entry precedes another.
 *
 * Kept in step with `runtime-bar/registry.ts` by hand: importing the registry
 * here would pull React components (and the whole renderer graph) into a Node
 * test whose only job is to read text off disk.
 */
const RUNTIME_BAR_SOURCE_FILES = [
  '../../workspace-runtime-bar.tsx',
  '../items/config-item.tsx',
  '../items/runtime-item.tsx',
  '../items/prompt-item.tsx',
  '../items/skill-item.tsx',
  '../items/context-item.tsx',
  '../items/account-usage-item.tsx',
  '../items/notifications-item.tsx',
  '../items/agent-sessions-item.tsx',
  '../items/maas-item.tsx',
  '../items/resources-item.tsx',
  '../items/trajectory-item.tsx',
  '../items/sync-item.tsx',
  '../items/doctor-item.tsx',
  '../items/terminal-item.tsx',
  '../bar-chrome.tsx',
  '../maas-usage-content.tsx',
  '../session-context.ts',
  '../session-usage.ts',
  '../maas-context.ts',
  '../resource-snapshot.ts',
  '../display.ts',
];

export function readRuntimeBarSource(): string {
  return RUNTIME_BAR_SOURCE_FILES.map((path) =>
    readFileSync(new URL(path, import.meta.url), 'utf8')
  ).join('\n');
}
