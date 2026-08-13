import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const CODEX_MODEL_CACHE_FILENAME = 'models_cache.json';
const MANAGED_CATALOG_PATH = ['.yoda', 'maas-model-catalog.json'] as const;

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rewriteResponsesLiteModels(value: unknown): JsonObject | undefined {
  if (!isJsonObject(value) || !Array.isArray(value.models)) return undefined;

  let rewritten = false;
  const models = value.models.map((model) => {
    if (!isJsonObject(model) || model.use_responses_lite !== true) return model;
    rewritten = true;
    return { ...model, use_responses_lite: false };
  });

  return rewritten ? { ...value, models } : undefined;
}

async function readCompatibleCatalog(sourcePath: string): Promise<string | undefined> {
  try {
    const source = await readFile(sourcePath, 'utf8');
    const compatible = rewriteResponsesLiteModels(JSON.parse(source) as unknown);
    return compatible ? `${JSON.stringify(compatible, null, 2)}\n` : undefined;
  } catch {
    return undefined;
  }
}

async function writeAtomically(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    if ((await readFile(path, 'utf8')) === content) {
      await chmod(path, 0o600);
      return;
    }
  } catch {}

  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

/**
 * Codex 0.147 enables Responses Lite for newer models. Some OpenAI-compatible
 * MaaS endpoints reject the Lite namespace tool because its description is an
 * empty string. Keep the official catalog intact and write a Yoda-owned copy
 * that disables only the transport optimization for MaaS-launched sessions.
 */
export async function ensureCodexMaasCompatibleModelCatalog(
  codexHome: string,
  options: { fallbackCodexHome?: string } = {}
): Promise<string | undefined> {
  const normalizedCodexHome = resolve(codexHome);
  const fallbackCodexHome = resolve(options.fallbackCodexHome ?? join(homedir(), '.codex'));
  const sourceHomes = [...new Set([normalizedCodexHome, fallbackCodexHome])];

  for (const sourceHome of sourceHomes) {
    const content = await readCompatibleCatalog(join(sourceHome, CODEX_MODEL_CACHE_FILENAME));
    if (!content) continue;

    const targetPath = join(normalizedCodexHome, ...MANAGED_CATALOG_PATH);
    await writeAtomically(targetPath, content);
    return targetPath;
  }

  return undefined;
}
