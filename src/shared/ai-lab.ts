export const AI_LAB_ENGINE_IDS = ['zenmux', 'codex'] as const;

export type AiLabEngineId = (typeof AI_LAB_ENGINE_IDS)[number];

export type AiLabEngineUnavailableReason = 'not-connected' | 'cli-missing';

export type AiLabEngineStatus = {
  id: AiLabEngineId;
  available: boolean;
  reason: AiLabEngineUnavailableReason | null;
};

/**
 * ZenMux image models the logo generator can route to. Google image models are
 * only exposed through ZenMux's Vertex AI protocol (they never appear in the
 * OpenAI-style /models or /images endpoints); OpenAI ones use the Images API.
 */
export const AI_LAB_ZENMUX_MODELS = [
  'google/gemini-3-pro-image-preview',
  'openai/gpt-image-2',
] as const;

export type AiLabZenmuxModel = (typeof AI_LAB_ZENMUX_MODELS)[number];

export const AI_LAB_DEFAULT_ZENMUX_MODEL: AiLabZenmuxModel = 'google/gemini-3-pro-image-preview';

/** Codex CLI generates through its built-in image_gen tool, backed by gpt-image-2. */
export const AI_LAB_CODEX_MODEL = 'gpt-image-2';

export const LOGO_STYLE_IDS = [
  'minimal',
  'geometric',
  'wordmark',
  'badge',
  'mascot',
  'gradient',
] as const;

export type LogoStyleId = (typeof LOGO_STYLE_IDS)[number];

export type LogoGenerationInput = {
  brandName: string;
  description: string;
  styleId: LogoStyleId;
  engine: AiLabEngineId;
  /** ZenMux only; the Codex engine is pinned to its built-in model. */
  model?: AiLabZenmuxModel;
  count: number;
};

export type LogoGenerationStatus = 'succeeded' | 'failed';

export type LogoGenerationRecord = {
  id: string;
  brandName: string;
  description: string;
  styleId: string;
  engine: AiLabEngineId;
  model: string;
  prompt: string;
  status: LogoGenerationStatus;
  error: string | null;
  imageCount: number;
  createdAt: string;
};

/** History entry shipped to the renderer: record plus per-image thumbnail data URLs. */
export type LogoGenerationListItem = LogoGenerationRecord & {
  thumbnails: string[];
};

/** A user-created, single-file app hosted by AI Lab's isolated web sandbox. */
export type AiLabUserApp = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  html: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateAiLabAppInput = {
  prompt: string;
};

export type UpdateAiLabAppInput = {
  id: string;
  pinned: boolean;
};
