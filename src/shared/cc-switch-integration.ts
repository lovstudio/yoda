export const CC_SWITCH_APP_NAME = 'CC Switch';
export const CC_SWITCH_REPOSITORY = 'farion1231/cc-switch';
export const CC_SWITCH_REPOSITORY_URL = 'https://github.com/farion1231/cc-switch';
export const CC_SWITCH_RELEASES_URL = 'https://github.com/farion1231/cc-switch/releases/latest';
export const CC_SWITCH_WEBSITE_URL = 'https://ccswitch.io';
export const CC_SWITCH_HOMEBREW_CASK = 'cc-switch';

export type CcSwitchIntegrationState = 'not-installed' | 'installed';

export type CcSwitchIntegrationOperation = 'installing';

/**
 * How the card's install action behaves: `homebrew` runs the cask install,
 * `download` falls back to opening the release page.
 */
export type CcSwitchInstallMethod = 'homebrew' | 'download';

export type CcSwitchIntegrationStatus = {
  state: CcSwitchIntegrationState;
  operation: CcSwitchIntegrationOperation | null;
  installed: boolean;
  /** Executable or app bundle Yoda launches; null when the app was not found. */
  appPath: string | null;
  installedVersion: string | null;
  /** `~/.cc-switch` exists, so the app has been run at least once. */
  configured: boolean;
  /** CC Switch's own local proxy toggle, read from its device settings. */
  localProxyEnabled: boolean;
  installMethod: CcSwitchInstallMethod;
};

export type CcSwitchIntegrationActionResult = {
  success: boolean;
  status: CcSwitchIntegrationStatus;
  error?: string;
};
