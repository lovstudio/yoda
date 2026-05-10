type ImportMetaWithEnv = ImportMeta & { env?: { VITE_BUILD?: string } };

const isCanary = (import.meta as ImportMetaWithEnv).env?.VITE_BUILD === 'canary';

export const APP_ID = isCanary ? 'ai.lovstudio.yoda.canary' : 'ai.lovstudio.yoda.stable';
export const PRODUCT_NAME = isCanary ? 'Yoda Canary' : 'Yoda';
export const APP_NAME_LOWER = isCanary ? 'yoda-canary' : 'yoda';
export const UPDATE_CHANNEL = isCanary ? 'v1-canary' : 'v1-stable';
export const ARTIFACT_PREFIX = isCanary ? 'yoda-canary' : 'yoda';
export const R2_BASE_URL = 'https://releases.lovstudio.ai/yoda';
