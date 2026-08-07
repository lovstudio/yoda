import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  isAgentReplyDisplayLevel,
  type AgentReplyDisplayLevel,
} from '../../../src/shared/agent-reply-display';

const STORAGE_KEY = 'yoda.mobile.session-display.v1';

export type SessionOutputMode = 'rendered' | 'raw';

export type SessionDisplayPreferences = {
  outputMode: SessionOutputMode;
  replyDisplayLevel: AgentReplyDisplayLevel;
};

export const DEFAULT_SESSION_DISPLAY_PREFERENCES: SessionDisplayPreferences = {
  outputMode: 'rendered',
  replyDisplayLevel: 'concise',
};

function isSessionOutputMode(value: unknown): value is SessionOutputMode {
  return value === 'rendered' || value === 'raw';
}

export async function loadSessionDisplayPreferences(): Promise<SessionDisplayPreferences> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_SESSION_DISPLAY_PREFERENCES;

  try {
    const parsed = JSON.parse(raw) as Partial<SessionDisplayPreferences>;
    return {
      outputMode: isSessionOutputMode(parsed.outputMode)
        ? parsed.outputMode
        : DEFAULT_SESSION_DISPLAY_PREFERENCES.outputMode,
      replyDisplayLevel: isAgentReplyDisplayLevel(parsed.replyDisplayLevel)
        ? parsed.replyDisplayLevel
        : DEFAULT_SESSION_DISPLAY_PREFERENCES.replyDisplayLevel,
    };
  } catch {
    return DEFAULT_SESSION_DISPLAY_PREFERENCES;
  }
}

export async function saveSessionDisplayPreferences(
  preferences: SessionDisplayPreferences
): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}
