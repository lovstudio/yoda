import { getLocales } from 'expo-localization';
import type {
  ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';
import {
  buildMobileSpeechContextualStrings,
  resolveMobileSpeechLocale,
} from '../../../src/shared/mobile-api';

export type MobileVoiceInputSession = {
  abort: () => void;
  dispose: () => void;
  stop: () => void;
};

export async function startMobileVoiceInput(options: {
  contextualStrings?: readonly (string | null | undefined)[];
  onEnd: () => void;
  onError: (message: string) => void;
  onResult: (transcript: string, isFinal: boolean) => void;
}): Promise<MobileVoiceInputSession> {
  const { ExpoSpeechRecognitionModule } = await import('expo-speech-recognition');
  if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
    throw new Error('Speech recognition is not available on this device.');
  }
  const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Microphone and speech recognition permission are required.');
  }
  const preferredLocales = getLocales().map((locale) => locale.languageTag);
  const supportedLocales = await ExpoSpeechRecognitionModule.getSupportedLocales({})
    .then((result) => result.locales)
    .catch(() => []);
  const speechLocale = resolveMobileSpeechLocale(preferredLocales, supportedLocales);
  const speechContextualStrings = buildMobileSpeechContextualStrings(
    options.contextualStrings ?? []
  );

  const resultSubscription = ExpoSpeechRecognitionModule.addListener(
    'result',
    (event: ExpoSpeechRecognitionResultEvent) => {
      options.onResult(event.results[0]?.transcript ?? '', event.isFinal);
    }
  );
  const errorSubscription = ExpoSpeechRecognitionModule.addListener(
    'error',
    (event: ExpoSpeechRecognitionErrorEvent) => {
      if (event.error !== 'aborted') {
        options.onError(event.message || `Speech recognition failed (${event.error}).`);
      }
    }
  );
  const endSubscription = ExpoSpeechRecognitionModule.addListener('end', options.onEnd);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    resultSubscription.remove();
    errorSubscription.remove();
    endSubscription.remove();
  };

  try {
    ExpoSpeechRecognitionModule.start({
      addsPunctuation: true,
      continuous: true,
      contextualStrings: speechContextualStrings,
      interimResults: true,
      iosTaskHint: 'dictation',
      lang: speechLocale,
      maxAlternatives: 1,
    });
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    abort: () => ExpoSpeechRecognitionModule.abort(),
    dispose,
    stop: () => ExpoSpeechRecognitionModule.stop(),
  };
}
