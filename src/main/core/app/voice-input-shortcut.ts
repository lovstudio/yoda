export type TypelessShortcutSource =
  | 'typeless-settings:hands-free'
  | 'typeless-settings:dictation'
  | 'typeless-settings:keyboard-hands-free'
  | 'typeless-settings:keyboard-dictation'
  | 'fallback:hands-free';

export type TypelessShortcutResolution = {
  shortcut: string;
  source: TypelessShortcutSource;
};

const TYPELESS_HANDS_FREE_FALLBACK_SHORTCUT = 'Fn+Space';

const MAC_KEY_CODES: Record<string, number> = {
  a: 0,
  s: 1,
  d: 2,
  f: 3,
  h: 4,
  g: 5,
  z: 6,
  x: 7,
  c: 8,
  v: 9,
  b: 11,
  q: 12,
  w: 13,
  e: 14,
  r: 15,
  y: 16,
  t: 17,
  '1': 18,
  '2': 19,
  '3': 20,
  '4': 21,
  '6': 22,
  '5': 23,
  '=': 24,
  plus: 24,
  '9': 25,
  '7': 26,
  '-': 27,
  minus: 27,
  '8': 28,
  '0': 29,
  ']': 30,
  rightbracket: 30,
  o: 31,
  u: 32,
  '[': 33,
  leftbracket: 33,
  i: 34,
  p: 35,
  return: 36,
  enter: 36,
  l: 37,
  j: 38,
  "'": 39,
  quote: 39,
  k: 40,
  ';': 41,
  semicolon: 41,
  '\\': 42,
  backslash: 42,
  ',': 43,
  comma: 43,
  '/': 44,
  slash: 44,
  n: 45,
  m: 46,
  '.': 47,
  period: 47,
  tab: 48,
  space: 49,
  '`': 50,
  grave: 50,
  backtick: 50,
  delete: 51,
  backspace: 51,
  escape: 53,
  esc: 53,
  rightcmd: 54,
  rightcommand: 54,
  leftcmd: 55,
  leftcommand: 55,
  cmd: 55,
  command: 55,
  leftshift: 56,
  shift: 56,
  capslock: 57,
  leftoption: 58,
  leftalt: 58,
  option: 58,
  alt: 58,
  leftctrl: 59,
  leftcontrol: 59,
  ctrl: 59,
  control: 59,
  rightshift: 60,
  rightoption: 61,
  rightalt: 61,
  rightctrl: 62,
  rightcontrol: 62,
  fn: 63,
  function: 63,
  f17: 64,
  volumeup: 72,
  volumedown: 73,
  mute: 74,
  f18: 79,
  f19: 80,
  f20: 90,
  f5: 96,
  f6: 97,
  f7: 98,
  f3: 99,
  f8: 100,
  f9: 101,
  f11: 103,
  f13: 105,
  f16: 106,
  f14: 107,
  f10: 109,
  f12: 111,
  f15: 113,
  help: 114,
  home: 115,
  pageup: 116,
  forwarddelete: 117,
  f4: 118,
  end: 119,
  f2: 120,
  pagedown: 121,
  f1: 122,
  left: 123,
  right: 124,
  down: 125,
  up: 126,
};

const readShortcutArray = (value: unknown): string | null => {
  if (!Array.isArray(value)) return null;
  const shortcut = value.find((item) => typeof item === 'string' && item.trim().length > 0);
  return typeof shortcut === 'string' ? shortcut.trim() : null;
};

const readShortcutValue = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

export function resolveTypelessShortcutFromSettings(
  settings: unknown
): TypelessShortcutResolution | null {
  if (!settings || typeof settings !== 'object') return null;
  const root = settings as {
    featureShortcutBindings?: Record<string, unknown>;
    keyboardShortcut?: Record<string, unknown>;
  };

  const featureBindings = root.featureShortcutBindings ?? {};
  const keyboardShortcut = root.keyboardShortcut ?? {};

  const handsFreeFeatureShortcut =
    readShortcutArray(featureBindings.handsFreeMode) ??
    readShortcutArray(featureBindings.handlesFreeMode) ??
    readShortcutArray(featureBindings.askAnythingMode);
  if (handsFreeFeatureShortcut) {
    return { shortcut: handsFreeFeatureShortcut, source: 'typeless-settings:hands-free' };
  }

  const handsFreeKeyboardShortcut =
    readShortcutValue(keyboardShortcut.handsFreeMode) ??
    readShortcutValue(keyboardShortcut.handlesFreeMode);
  if (handsFreeKeyboardShortcut) {
    return {
      shortcut: handsFreeKeyboardShortcut,
      source: 'typeless-settings:keyboard-hands-free',
    };
  }

  const dictationFeatureShortcut = readShortcutArray(featureBindings.dictationMode);
  if (dictationFeatureShortcut) {
    return { shortcut: dictationFeatureShortcut, source: 'typeless-settings:dictation' };
  }

  const pushToTalkShortcut = readShortcutValue(keyboardShortcut.pushToTalk);
  if (pushToTalkShortcut) {
    return { shortcut: pushToTalkShortcut, source: 'typeless-settings:keyboard-dictation' };
  }

  return null;
}

export function resolveTypelessFallbackShortcut(): TypelessShortcutResolution {
  return { shortcut: TYPELESS_HANDS_FREE_FALLBACK_SHORTCUT, source: 'fallback:hands-free' };
}

export function parseVoiceInputShortcut(
  shortcut: string
): Array<{ token: string; keyCode: number }> {
  const tokens = shortcut
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) throw new Error('Voice input shortcut is empty.');

  return tokens.map((token) => {
    const normalized = token.replace(/[\s_-]/g, '').toLowerCase();
    const keyCode = MAC_KEY_CODES[normalized];
    if (keyCode === undefined) {
      throw new Error(`Unsupported voice input shortcut key: ${token}`);
    }
    return { token, keyCode };
  });
}

export function buildMacShortcutAppleScript(shortcut: string): string {
  const keys = parseVoiceInputShortcut(shortcut);
  const keyDownLines = keys.map((key) => `  key down (key code ${key.keyCode})`);
  const keyUpLines = [...keys].reverse().map((key) => `  key up (key code ${key.keyCode})`);

  return [
    'tell application "System Events"',
    ...keyDownLines,
    '  delay 0.12',
    ...keyUpLines,
    'end tell',
  ].join('\n');
}
