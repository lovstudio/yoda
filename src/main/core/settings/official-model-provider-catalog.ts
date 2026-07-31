import { net } from 'electron';
import { normalizeModelIdForProvider } from '@shared/model-provider-catalog';
import type { RuntimeId } from '@shared/runtime-registry';
import { runtimeOverrideSettings } from './runtime-settings-service';

const OFFICIAL_CATALOG_TIMEOUT_MS = 15_000;

type OfficialModelProviderSource = {
  providerId: string;
  sourceUrl: string;
  snapshotAt: string;
  snapshotModels: readonly string[];
  runtimeId: RuntimeId;
  apiUrl: string;
  apiKeyEnvVars: readonly string[];
  auth: 'bearer' | 'x-api-key' | 'x-goog-api-key';
  headers?: Readonly<Record<string, string>>;
  responseShape: 'openai' | 'google';
};

export type OfficialModelProviderFetchResult =
  | {
      kind: 'success';
      models: string[];
    }
  | {
      kind: 'credentialsMissing';
    };

/**
 * Checked against each vendor's public model documentation on 2026-07-31.
 * These snapshots make first-run model selection useful before a local API key
 * is configured. Authenticated model-list APIs then replace them with the
 * models available to the user's own vendor account.
 */
export const OFFICIAL_MODEL_PROVIDER_SOURCES = [
  {
    providerId: 'openai',
    sourceUrl: 'https://developers.openai.com/api/docs/models',
    snapshotAt: '2026-07-31T00:00:00.000Z',
    snapshotModels: [
      'openai/gpt-5.6',
      'openai/gpt-5.6-sol',
      'openai/gpt-5.6-terra',
      'openai/gpt-5.6-luna',
    ],
    runtimeId: 'codex',
    apiUrl: 'https://api.openai.com/v1/models',
    apiKeyEnvVars: ['OPENAI_API_KEY'],
    auth: 'bearer',
    responseShape: 'openai',
  },
  {
    providerId: 'anthropic',
    sourceUrl: 'https://platform.claude.com/docs/en/about-claude/models/overview',
    snapshotAt: '2026-07-31T00:00:00.000Z',
    snapshotModels: [
      'anthropic/claude-fable-5',
      'anthropic/claude-opus-5',
      'anthropic/claude-sonnet-5',
      'anthropic/claude-haiku-4-5-20251001',
      'anthropic/claude-haiku-4-5',
    ],
    runtimeId: 'claude',
    apiUrl: 'https://api.anthropic.com/v1/models?limit=1000',
    apiKeyEnvVars: ['ANTHROPIC_API_KEY'],
    auth: 'x-api-key',
    headers: { 'anthropic-version': '2023-06-01' },
    responseShape: 'openai',
  },
  {
    providerId: 'kimi',
    sourceUrl: 'https://platform.kimi.com/docs/overview',
    snapshotAt: '2026-07-31T00:00:00.000Z',
    snapshotModels: [
      'moonshotai/kimi-k3',
      'moonshotai/kimi-k2.7-code',
      'moonshotai/kimi-k2.7-code-highspeed',
      'moonshotai/kimi-k2.6',
      'moonshotai/kimi-k2.5',
    ],
    runtimeId: 'kimi',
    apiUrl: 'https://api.moonshot.cn/v1/models',
    apiKeyEnvVars: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
    auth: 'bearer',
    responseShape: 'openai',
  },
  {
    providerId: 'google',
    sourceUrl: 'https://ai.google.dev/gemini-api/docs/models',
    snapshotAt: '2026-07-31T00:00:00.000Z',
    snapshotModels: [
      'google/gemini-3.6-flash',
      'google/gemini-3.5-flash',
      'google/gemini-3.5-flash-lite',
      'google/gemini-3.1-flash-lite',
      'google/gemini-3.1-pro-preview',
      'google/gemini-2.5-flash',
    ],
    runtimeId: 'gemini',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
    apiKeyEnvVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    auth: 'x-goog-api-key',
    responseShape: 'google',
  },
] as const satisfies readonly OfficialModelProviderSource[];

export function getOfficialModelProviderSource(
  providerId: string
): OfficialModelProviderSource | undefined {
  return OFFICIAL_MODEL_PROVIDER_SOURCES.find((source) => source.providerId === providerId);
}

export async function hasOfficialModelProviderCredentials(providerId: string): Promise<boolean> {
  const source = getOfficialModelProviderSource(providerId);
  if (!source) return false;
  return Boolean(await resolveApiKey(source));
}

export async function fetchOfficialModelProviderModels(
  providerId: string
): Promise<OfficialModelProviderFetchResult> {
  const source = getOfficialModelProviderSource(providerId);
  if (!source) return { kind: 'credentialsMissing' };

  const apiKey = await resolveApiKey(source);
  if (!apiKey) return { kind: 'credentialsMissing' };

  const headers: Record<string, string> = { ...source.headers };
  if (source.auth === 'bearer') headers.Authorization = `Bearer ${apiKey}`;
  else if (source.auth === 'x-api-key') headers['x-api-key'] = apiKey;
  else headers['x-goog-api-key'] = apiKey;

  const response = await net.fetch(source.apiUrl, {
    headers,
    signal: AbortSignal.timeout(OFFICIAL_CATALOG_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Official model API returned ${response.status}.`);
  }

  const payload = (await response.json()) as unknown;
  const models =
    source.responseShape === 'google'
      ? parseGoogleModels(source.providerId, payload)
      : parseOpenAiCompatibleModels(source.providerId, payload);
  if (models.length === 0) {
    throw new Error('Official model API returned no supported text models.');
  }
  return { kind: 'success', models };
}

async function resolveApiKey(source: OfficialModelProviderSource): Promise<string | null> {
  const runtimeConfig = await runtimeOverrideSettings.getItem(source.runtimeId);
  const customEnv = runtimeConfig?.env ?? {};
  for (const envName of source.apiKeyEnvVars) {
    const value = customEnv[envName]?.trim() || process.env[envName]?.trim();
    if (value) return value;
  }
  return null;
}

function parseOpenAiCompatibleModels(providerId: string, payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
  return normalizeOfficialModels(
    providerId,
    payload.data.flatMap((item) =>
      isRecord(item) && typeof item.id === 'string' && isSupportedTextModel(providerId, item.id)
        ? [item.id]
        : []
    )
  );
}

function parseGoogleModels(providerId: string, payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.models)) return [];
  return normalizeOfficialModels(
    providerId,
    payload.models.flatMap((item) => {
      if (!isRecord(item) || typeof item.name !== 'string') return [];
      const methods = Array.isArray(item.supportedGenerationMethods)
        ? item.supportedGenerationMethods
        : [];
      if (!methods.includes('generateContent')) return [];
      return [item.name.replace(/^models\//, '')];
    })
  );
}

function normalizeOfficialModels(providerId: string, modelIds: readonly string[]): string[] {
  const normalized = new Set<string>();
  for (const modelId of modelIds) {
    const value = normalizeModelIdForProvider(providerId, modelId);
    if (value) normalized.add(value);
  }
  return [...normalized].sort((left, right) => left.localeCompare(right));
}

function isSupportedTextModel(providerId: string, modelId: string): boolean {
  const normalized = modelId.toLowerCase();
  if (providerId === 'openai') {
    if (!/^(gpt-|chatgpt-|o1|o3|o4)/.test(normalized)) return false;
    return !/(audio|realtime|transcribe|tts|image|embedding|moderation|search)/.test(normalized);
  }
  if (providerId === 'anthropic') return normalized.startsWith('claude-');
  if (providerId === 'kimi') {
    return normalized.startsWith('kimi-') || normalized.startsWith('moonshot-');
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
