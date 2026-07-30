export const LITELLM_MANAGED_ENDPOINT = 'http://127.0.0.1:4000/v1';
export const LITELLM_MANAGED_ADMIN_URL = 'http://127.0.0.1:4000/ui';
export const LITELLM_MANAGED_ADMIN_USERNAME = 'admin';
export const LITELLM_DOCKER_DESKTOP_URL = 'https://www.docker.com/products/docker-desktop/';

export type LiteLlmManagedState =
  | 'docker-missing'
  | 'docker-starting'
  | 'docker-stopped'
  | 'not-installed'
  | 'stopped'
  | 'running'
  | 'external-running';

export type LiteLlmManagedOperation = 'installing' | 'starting' | 'stopping' | 'starting-docker';

export type LiteLlmManagedStatus = {
  state: LiteLlmManagedState;
  operation: LiteLlmManagedOperation | null;
  managed: boolean;
  installed: boolean;
  dockerInstalled: boolean;
  dockerRunning: boolean;
  canStartDocker: boolean;
  dockerVersion: string | null;
  endpoint: string;
  adminUrl: string;
  imageVersion: string;
  modelCount: number | null;
};

export type LiteLlmManagedActionResult = {
  success: boolean;
  status: LiteLlmManagedStatus;
  error?: string;
};

export type LiteLlmManagedCredentialActionResult = {
  success: boolean;
  error?: string;
};
