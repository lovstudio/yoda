import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureCodexMaasCompatibleModelCatalog } from './codex-maas-model-catalog';

describe('ensureCodexMaasCompatibleModelCatalog', () => {
  const temporaryDirectories: string[] = [];

  async function makeDirectory(prefix: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), prefix));
    temporaryDirectories.push(directory);
    return directory;
  }

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true }))
    );
  });

  it('writes a managed copy with Responses Lite disabled and preserves the source cache', async () => {
    const codexHome = await makeDirectory('yoda-codex-catalog-');
    const source = {
      client_version: '0.147.0',
      models: [
        { slug: 'gpt-5.6-sol', use_responses_lite: true, description: 'Frontier model' },
        { slug: 'gpt-5.5', use_responses_lite: false },
      ],
    };
    const sourceText = `${JSON.stringify(source, null, 2)}\n`;
    await writeFile(join(codexHome, 'models_cache.json'), sourceText, 'utf8');

    const catalogPath = await ensureCodexMaasCompatibleModelCatalog(codexHome);

    expect(catalogPath).toBe(join(codexHome, '.yoda', 'maas-model-catalog.json'));
    const catalog = JSON.parse(await readFile(catalogPath!, 'utf8')) as typeof source;
    expect(catalog.models).toEqual([
      { slug: 'gpt-5.6-sol', use_responses_lite: false, description: 'Frontier model' },
      { slug: 'gpt-5.5', use_responses_lite: false },
    ]);
    expect(await readFile(join(codexHome, 'models_cache.json'), 'utf8')).toBe(sourceText);
  });

  it('uses the primary Codex cache for an adopted state root that has no catalog', async () => {
    const stateRoot = await makeDirectory('yoda-codex-state-root-');
    const primaryHome = await makeDirectory('yoda-codex-primary-home-');
    await writeFile(
      join(primaryHome, 'models_cache.json'),
      JSON.stringify({ models: [{ slug: 'gpt-5.6-terra', use_responses_lite: true }] }),
      'utf8'
    );

    const catalogPath = await ensureCodexMaasCompatibleModelCatalog(stateRoot, {
      fallbackCodexHome: primaryHome,
    });

    expect(catalogPath).toBe(join(stateRoot, '.yoda', 'maas-model-catalog.json'));
    expect(await readFile(catalogPath!, 'utf8')).toContain('"use_responses_lite": false');
  });

  it('does not create an override when no compatible source catalog needs rewriting', async () => {
    const codexHome = await makeDirectory('yoda-codex-catalog-unneeded-');
    const fallbackHome = join(codexHome, 'fallback');
    await mkdir(fallbackHome);
    await writeFile(
      join(codexHome, 'models_cache.json'),
      JSON.stringify({ models: [{ slug: 'gpt-5.5', use_responses_lite: false }] }),
      'utf8'
    );

    await expect(
      ensureCodexMaasCompatibleModelCatalog(codexHome, { fallbackCodexHome: fallbackHome })
    ).resolves.toBeUndefined();
  });
});
