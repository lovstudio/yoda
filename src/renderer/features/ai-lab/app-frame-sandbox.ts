export const AI_LAB_APP_FRAME_SANDBOX = 'allow-scripts allow-forms allow-modals allow-downloads';

/**
 * Project Apps load from an isolated loopback origin. Same-origin is required
 * for Vite module loading and HMR; the origin remains separate from Yoda.
 */
export const AI_LAB_PROJECT_APP_FRAME_SANDBOX =
  'allow-scripts allow-forms allow-modals allow-downloads allow-same-origin';
