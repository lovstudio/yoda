export const CLIPROXYAPI_MANAGED_VERSION = '7.2.120';
export const CLIPROXYAPI_MANAGED_ENDPOINT = 'http://127.0.0.1:8317/v1';
export const CLIPROXYAPI_MANAGED_ADMIN_URL = 'http://127.0.0.1:8317/management.html';

export type CliProxyApiManagedState =
  | 'unsupported'
  | 'not-installed'
  | 'stopped'
  | 'running'
  | 'external-running';

export type CliProxyApiManagedOperation = 'installing' | 'starting' | 'stopping';

export type CliProxyApiManagedStatus = {
  state: CliProxyApiManagedState;
  operation: CliProxyApiManagedOperation | null;
  supported: boolean;
  managed: boolean;
  installed: boolean;
  endpoint: string;
  adminUrl: string;
  bundledVersion: string;
  installedVersion: string | null;
  modelCount: number | null;
};

export type CliProxyApiManagedActionResult = {
  success: boolean;
  status: CliProxyApiManagedStatus;
  error?: string;
};

export type CliProxyApiManagedCredentialActionResult = {
  success: boolean;
  error?: string;
};
