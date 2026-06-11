import { createRPCController } from '@shared/ipc/rpc';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { yodaAccountService } from './services/yoda-account-service';

export const accountController = createRPCController({
  getSession: async () => {
    try {
      return await yodaAccountService.getSession();
    } catch (error) {
      log.error('Failed to get account session:', error);
      return { user: null, isSignedIn: false, hasAccount: false };
    }
  },

  signIn: async (provider?: string) => {
    try {
      const result = await yodaAccountService.signIn(provider);
      telemetryService.capture('user_signed_in');
      return { success: true, user: result.user };
    } catch (error) {
      log.error('Account sign-in failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Sign-in failed',
      };
    }
  },

  cancelSignIn: async () => {
    yodaAccountService.cancelSignIn();
    return { success: true };
  },

  warmUpAuth: async () => {
    yodaAccountService.warmUp();
    return { success: true };
  },

  signOut: async () => {
    try {
      await yodaAccountService.signOut();
      telemetryService.capture('user_signed_out');
      return { success: true };
    } catch (error) {
      log.error('Account sign-out failed:', error);
      return { success: false, error: 'Sign-out failed' };
    }
  },

  checkHealth: async () => {
    try {
      return await yodaAccountService.checkServerHealth();
    } catch {
      return false;
    }
  },

  validateSession: async () => {
    try {
      return await yodaAccountService.validateSession();
    } catch {
      return false;
    }
  },
});
