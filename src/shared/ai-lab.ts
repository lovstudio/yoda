import type { RuntimeId } from './runtime-registry';

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

export type AiLabProjectKind = 'app';

export const AI_LAB_APP_RUNTIME_KINDS = ['legacy-html', 'react-vite'] as const;

export type AiLabAppRuntimeKind = (typeof AI_LAB_APP_RUNTIME_KINDS)[number];

export const AI_LAB_APP_CAPABILITIES = ['ai.image.edit'] as const;

export type AiLabAppCapability = (typeof AI_LAB_APP_CAPABILITIES)[number];

export const AI_LAB_APP_MANIFEST_PATH = '.yoda/app.json';
export const AI_LAB_APP_TEMPLATE_VERSION = 1;

export type AiLabAppManifest = {
  schemaVersion: 1;
  template: 'react-vite';
  templateVersion: number;
  status: 'draft' | 'ready';
  name: string;
  description: string;
  capabilities: AiLabAppCapability[];
};

/** A user-created app. Project apps keep source in their dedicated Git repository. */
export type AiLabUserApp = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  /** Legacy single-file source only. React/Vite apps use the project repository as source. */
  html: string;
  runtimeKind?: AiLabAppRuntimeKind;
  templateVersion?: number;
  capabilities?: AiLabAppCapability[];
  /** Marks a dedicated project owned by this App, rather than a legacy source project. */
  projectKind?: AiLabProjectKind;
  projectId?: string;
  taskId?: string;
  conversationId?: string;
  runtimeId?: RuntimeId;
  model?: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PrepareAiLabBuildTaskInput = {
  /** Present when continuing development of an existing App project. */
  appId?: string;
  prompt: string;
  projectId: string;
  taskId: string;
  conversationId: string;
  runtimeId: RuntimeId;
  model?: string | null;
  systemPrompt?: string;
};

export type PrepareAiLabBuildTaskResult = {
  initialPrompt: string;
};

export type ScaffoldAiLabAppProjectInput = {
  projectId: string;
  name: string;
};

export type AiLabAppPreviewResult =
  | { kind: 'legacy' }
  | {
      kind: 'url';
      url: string;
    };

export type AiLabAppProjectBuild = {
  name: string;
  description: string;
  runtimeKind: Extract<AiLabAppRuntimeKind, 'react-vite'>;
  templateVersion: number;
  capabilities: AiLabAppCapability[];
};

export type AssignAiLabAppProjectInput = {
  id: string;
  projectId: string;
};

export type UpdateAiLabAppInput = {
  id: string;
  pinned: boolean;
};
