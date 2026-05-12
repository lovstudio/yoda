import { defineEvent } from '@shared/ipc/events';

export const accountAuthDeviceCodeChannel = defineEvent<{
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}>('account:auth:device-code');

export const accountAuthSuccessChannel = defineEvent<{
  user: { userId: string; username: string; name: string; avatarUrl: string; email: string };
}>('account:auth:success');

export const accountAuthErrorChannel = defineEvent<{
  message: string;
}>('account:auth:error');

export const accountAuthCancelledChannel = defineEvent<void>('account:auth:cancelled');
