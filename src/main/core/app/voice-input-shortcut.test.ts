import { describe, expect, it } from 'vitest';
import {
  buildMacShortcutAppleScript,
  parseVoiceInputShortcut,
  resolveTypelessFallbackShortcut,
  resolveTypelessShortcutFromSettings,
} from './voice-input-shortcut';

describe('voice input shortcuts', () => {
  it('resolves Typeless hands-free shortcuts before push-to-talk shortcuts', () => {
    expect(
      resolveTypelessShortcutFromSettings({
        keyboardShortcut: {
          pushToTalk: 'LeftCtrl+LeftCmd+V',
          handlesFreeMode: 'Fn+Space',
        },
        featureShortcutBindings: {
          dictationMode: ['RightShift+RightOption'],
          askAnythingMode: ['Fn+Space'],
        },
      })
    ).toEqual({ shortcut: 'Fn+Space', source: 'typeless-settings:hands-free' });
  });

  it('falls back to Typeless keyboard shortcut fields', () => {
    expect(
      resolveTypelessShortcutFromSettings({
        keyboardShortcut: {
          pushToTalk: 'RightShift+RightOption',
          handlesFreeMode: 'LeftCtrl+LeftCmd+V',
        },
      })
    ).toEqual({
      shortcut: 'LeftCtrl+LeftCmd+V',
      source: 'typeless-settings:keyboard-hands-free',
    });
  });

  it('falls back to push-to-talk when no hands-free shortcut is configured', () => {
    expect(
      resolveTypelessShortcutFromSettings({
        keyboardShortcut: {
          pushToTalk: 'RightShift+RightOption',
        },
      })
    ).toEqual({
      shortcut: 'RightShift+RightOption',
      source: 'typeless-settings:keyboard-dictation',
    });
  });

  it('provides the Typeless hands-free default', () => {
    expect(resolveTypelessFallbackShortcut()).toEqual({
      shortcut: 'Fn+Space',
      source: 'fallback:hands-free',
    });
  });

  it('parses side-specific macOS shortcut keys', () => {
    expect(parseVoiceInputShortcut('RightShift+RightOption')).toEqual([
      { token: 'RightShift', keyCode: 60 },
      { token: 'RightOption', keyCode: 61 },
    ]);
  });

  it('builds AppleScript for combined shortcuts', () => {
    expect(buildMacShortcutAppleScript('Fn+Space')).toBe(
      [
        'tell application "System Events"',
        '  key down (key code 63)',
        '  key down (key code 49)',
        '  delay 0.12',
        '  key up (key code 49)',
        '  key up (key code 63)',
        'end tell',
      ].join('\n')
    );
  });

  it('rejects unsupported shortcut keys', () => {
    expect(() => buildMacShortcutAppleScript('Hyper+Space')).toThrow(
      'Unsupported voice input shortcut key: Hyper'
    );
  });
});
