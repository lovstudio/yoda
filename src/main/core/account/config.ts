export const ACCOUNT_CONFIG = {
  authServer: {
    baseUrl: process.env.YODA_AUTH_BASE_URL?.trim() || 'https://lovstudio.ai',
    authTimeoutMs: Number(process.env.YODA_AUTH_TIMEOUT_MS || 600_000),
  },
};
