export const NEW_API_MANAGED_ENDPOINT = 'http://127.0.0.1:4001/v1';
export const NEW_API_MANAGED_ADMIN_URL = 'http://127.0.0.1:4001';
export const NEW_API_MANAGED_ADMIN_USERNAME = 'admin';
export const NEW_API_DOCKER_DESKTOP_URL = 'https://www.docker.com/products/docker-desktop/';

export type NewApiManagedState =
  | 'docker-missing'
  | 'docker-starting'
  | 'docker-stopped'
  | 'not-installed'
  | 'stopped'
  | 'needs-setup'
  | 'running'
  | 'external-running';

export type NewApiManagedOperation =
  | 'installing'
  | 'initializing'
  | 'starting'
  | 'stopping'
  | 'starting-docker';

export type NewApiManagedStatus = {
  state: NewApiManagedState;
  operation: NewApiManagedOperation | null;
  managed: boolean;
  installed: boolean;
  initialized: boolean;
  credentialsAvailable: boolean;
  dockerInstalled: boolean;
  dockerRunning: boolean;
  canStartDocker: boolean;
  dockerVersion: string | null;
  endpoint: string;
  adminUrl: string;
  imageVersion: string;
  modelCount: number | null;
};

export type NewApiManagedActionResult = {
  success: boolean;
  status: NewApiManagedStatus;
  error?: string;
};

export type NewApiManagedCredentialActionResult = {
  success: boolean;
  error?: string;
};
