import { defineEvent } from '@shared/ipc/events';

export const accountAuthDeviceCodeChannel = defineEvent<{
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}>('account:auth:device-code');

export const accountAuthSuccessChannel = defineEvent<{
  user: {
    userId: string;
    username: string;
    nickname: string;
    nicknameOverride: string;
    name: string;
    avatarUrl: string;
    email: string;
  };
}>('account:auth:success');

export const accountAuthErrorChannel = defineEvent<{
  message: string;
}>('account:auth:error');

export const accountAuthCancelledChannel = defineEvent<void>('account:auth:cancelled');

/**
 * Invalidates renderer account snapshots when the main-process session changes
 * outside the renderer mutation that initiated it (for example, a 401 refresh
 * failure discovered by a background commerce request).
 */
export const accountSessionChangedChannel = defineEvent<void>('account:session-changed');
