import type {
  ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';

export type MobileVoiceInputSession = {
  abort: () => void;
  dispose: () => void;
  stop: () => void;
};

export function mobileSpeechLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'zh-CN';
  } catch {
    return 'zh-CN';
  }
}

export async function startMobileVoiceInput(options: {
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
      continuous: false,
      interimResults: true,
      lang: mobileSpeechLocale(),
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
