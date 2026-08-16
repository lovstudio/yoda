import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCE_DIR = new URL('./', import.meta.url);

function protocolSources(): string[] {
  return readdirSync(SOURCE_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort();
}

describe('protocol package boundary', () => {
  it('never imports desktop-only modules', () => {
    for (const name of protocolSources()) {
      const source = readFileSync(new URL(name, SOURCE_DIR), 'utf8');
      const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]!);
      for (const specifier of specifiers) {
        expect(
          specifier.startsWith('./'),
          `${name} imports "${specifier}"; the protocol must stay self-contained`
        ).toBe(true);
      }
    }
  });

  it('keeps relative imports extensioned so Node ESM consumers resolve them', () => {
    for (const name of protocolSources()) {
      const source = readFileSync(new URL(name, SOURCE_DIR), 'utf8');
      for (const match of source.matchAll(/from\s+'(\.[^']+)'/g)) {
        expect(
          match[1]!.endsWith('.js'),
          `${name} imports "${match[1]}" without a .js suffix`
        ).toBe(true);
      }
    }
  });
});
