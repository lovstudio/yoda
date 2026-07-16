import {
  getContrastRatio,
  type CustomThemeColors,
  type CustomThemeMode,
  type DreamSkinDecorationPreset,
} from '@shared/custom-theme';

type Rgb = [number, number, number];

export type DreamSkinPaletteAnalysis = {
  mode: CustomThemeMode;
  colors: CustomThemeColors;
  dominant: string;
  accent: string;
};

type ColorBucket = {
  count: number;
  red: number;
  green: number;
  blue: number;
};

export async function analyzeDreamSkinImage(imageUrl: string): Promise<DreamSkinPaletteAnalysis> {
  const image = await loadImage(imageUrl);
  const canvas = document.createElement('canvas');
  const size = 64;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法分析图片颜色。');
  context.drawImage(image, 0, 0, size, size);
  return extractDreamSkinPaletteFromPixels(context.getImageData(0, 0, size, size).data);
}

export function extractDreamSkinPaletteFromPixels(
  pixels: ArrayLike<number>
): DreamSkinPaletteAnalysis {
  const buckets = new Map<string, ColorBucket>();
  let red = 0;
  let green = 0;
  let blue = 0;
  let total = 0;
  let luminanceTotal = 0;

  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const alpha = pixels[index + 3] ?? 0;
    if (alpha < 160) continue;
    const r = pixels[index] ?? 0;
    const g = pixels[index + 1] ?? 0;
    const b = pixels[index + 2] ?? 0;
    red += r;
    green += g;
    blue += b;
    total += 1;
    luminanceTotal += relativeLuminance([r, g, b]);

    const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
    const bucket = buckets.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
    bucket.count += 1;
    bucket.red += r;
    bucket.green += g;
    bucket.blue += b;
    buckets.set(key, bucket);
  }

  if (total === 0) throw new Error('图片没有可分析的有效像素。');

  const average: Rgb = [
    Math.round(red / total),
    Math.round(green / total),
    Math.round(blue / total),
  ];
  const ranked = [...buckets.values()]
    .map((bucket) => {
      const rgb: Rgb = [
        Math.round(bucket.red / bucket.count),
        Math.round(bucket.green / bucket.count),
        Math.round(bucket.blue / bucket.count),
      ];
      const [, saturation, lightness] = rgbToHsl(rgb);
      const usableLightness = lightness > 0.08 && lightness < 0.92 ? 1 : 0.12;
      return {
        rgb,
        score: bucket.count * (0.25 + saturation * 1.5) * usableLightness,
      };
    })
    .sort((a, b) => b.score - a.score);

  const averageLuminance = luminanceTotal / total;
  const mode: CustomThemeMode = averageLuminance < 0.43 ? 'dark' : 'light';
  const dominant = ranked[0]?.rgb ?? average;
  const accentSource =
    ranked.find(({ rgb }) => {
      const [, saturation, lightness] = rgbToHsl(rgb);
      return saturation >= 0.35 && lightness >= 0.18 && lightness <= 0.82;
    })?.rgb ?? dominant;
  const accent = tuneAccent(accentSource, mode);
  const colors = deriveThemeColors(average, dominant, accent, mode);

  return {
    mode,
    colors,
    dominant: rgbToHex(dominant),
    accent: colors.primaryButtonBackground,
  };
}

export function humanizeDreamSkinFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[a-z0-9]+$/i, '');
  const withoutPrefix = withoutExtension
    .replace(/^(?:19|20)\d{6}(?:[-_\s]+|$)/, '')
    .replace(/^(?:img|image|photo|wallpaper|background|bg|ent)(?:[-_\s]+|$)/i, '')
    .replace(/^(?:19|20)\d{2}[-_]\d{2}[-_]\d{2}(?:[-_\s]+|$)/, '');
  const words = withoutPrefix.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!words) return '';
  if (/^[\x00-\x7f]+$/.test(words)) {
    return words.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  }
  return words;
}

export function updateDreamSkinAccent(
  colors: CustomThemeColors,
  accentHex: string,
  mode: CustomThemeMode
): CustomThemeColors {
  const accent = tuneAccent(hexToRgb(accentHex), mode);
  const hover = changeLightness(accent, mode === 'dark' ? 0.1 : -0.09);
  const foreground = pickContrastingText(rgbToHex(accent));
  return {
    ...colors,
    primaryButtonBackground: rgbToHex(accent),
    primaryButtonBackgroundHover: rgbToHex(hover),
    primaryButtonForeground: foreground,
    primaryButtonBorder: rgbToHex(changeLightness(accent, mode === 'dark' ? -0.12 : -0.14)),
    statusInReview: rgbToHex(changeLightness(accent, mode === 'dark' ? 0.06 : -0.03)),
  };
}

export function rebuildDreamSkinColors(
  colors: CustomThemeColors,
  mode: CustomThemeMode
): CustomThemeColors {
  return deriveThemeColors(
    hexToRgb(colors.background2),
    hexToRgb(colors.background3),
    tuneAccent(hexToRgb(colors.primaryButtonBackground), mode),
    mode
  );
}

export function suggestDreamSkinDecoration(accentHex: string): DreamSkinDecorationPreset {
  const [hue, saturation] = rgbToHsl(hexToRgb(accentHex));
  const degrees = hue * 360;
  if (saturation < 0.25) return 'glow';
  if (degrees < 65 || degrees >= 342) return 'embers';
  if (degrees < 155) return 'glow';
  if (degrees < 245) return 'orbit';
  if (degrees < 315) return 'stars';
  return 'petals';
}

function deriveThemeColors(
  average: Rgb,
  dominant: Rgb,
  accent: Rgb,
  mode: CustomThemeMode
): CustomThemeColors {
  const dark = mode === 'dark';
  const background = dark ? blend(average, [5, 7, 9], 0.16) : blend(dominant, [250, 250, 248], 0.1);
  const background1 = dark
    ? blend(dominant, [10, 12, 15], 0.18)
    : blend(dominant, [255, 255, 255], 0.07);
  const background2 = dark
    ? blend(dominant, [19, 22, 27], 0.26)
    : blend(dominant, [244, 243, 240], 0.14);
  const background3 = dark
    ? blend(dominant, [33, 37, 43], 0.34)
    : blend(dominant, [229, 226, 222], 0.2);
  const foreground: Rgb = dark ? [250, 247, 242] : [28, 25, 25];
  const foregroundMuted = dark
    ? blend(dominant, [202, 198, 194], 0.2)
    : blend(dominant, [91, 84, 84], 0.14);
  const foregroundPassive = dark
    ? blend(dominant, [132, 128, 128], 0.22)
    : blend(dominant, [151, 143, 143], 0.16);
  const border = dark
    ? blend(dominant, [47, 51, 57], 0.28)
    : blend(dominant, [221, 216, 214], 0.16);
  const border1 = dark
    ? blend(dominant, [69, 73, 81], 0.34)
    : blend(dominant, [194, 185, 183], 0.2);
  const border2 = dark ? blend(accent, [95, 99, 108], 0.28) : blend(accent, [158, 146, 145], 0.24);
  const accentHex = rgbToHex(accent);
  const warm = tuneStatus(accent, [222, 162, 70], dark);
  const green = tuneStatus(dominant, [82, 165, 116], dark);
  const red = tuneStatus(accent, [211, 79, 75], dark);

  return {
    background: rgbToHex(background),
    background1: rgbToHex(background1),
    background2: rgbToHex(background2),
    background3: rgbToHex(background3),
    foreground: rgbToHex(foreground),
    foregroundMuted: ensureReadable(rgbToHex(foregroundMuted), rgbToHex(background), 3, dark),
    foregroundPassive: rgbToHex(foregroundPassive),
    border: rgbToHex(border),
    border1: rgbToHex(border1),
    border2: rgbToHex(border2),
    primaryButtonBackground: accentHex,
    primaryButtonBackgroundHover: rgbToHex(changeLightness(accent, dark ? 0.1 : -0.09)),
    primaryButtonForeground: pickContrastingText(accentHex),
    primaryButtonBorder: rgbToHex(changeLightness(accent, dark ? -0.12 : -0.14)),
    statusInProgress: rgbToHex(warm),
    statusInReview: rgbToHex(changeLightness(accent, dark ? 0.06 : -0.03)),
    statusDone: rgbToHex(green),
    statusTodo: rgbToHex(foregroundPassive),
    statusCancelled: rgbToHex(blend(red, foregroundPassive, 0.55)),
    diffAdded: rgbToHex(green),
    diffModified: rgbToHex(warm),
    diffDeleted: rgbToHex(red),
  };
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法读取图片内容。'));
    image.src = source;
  });
}

function tuneAccent(rgb: Rgb, mode: CustomThemeMode): Rgb {
  const [hue, saturation, lightness] = rgbToHsl(rgb);
  return hslToRgb([
    hue,
    Math.max(0.5, Math.min(0.92, saturation)),
    mode === 'dark'
      ? Math.max(0.56, Math.min(0.72, lightness))
      : Math.max(0.36, Math.min(0.56, lightness)),
  ]);
}

function tuneStatus(source: Rgb, fallback: Rgb, dark: boolean): Rgb {
  const [, saturation] = rgbToHsl(source);
  const mixed = blend(source, fallback, saturation > 0.25 ? 0.3 : 0.12);
  const [hue, nextSaturation, lightness] = rgbToHsl(mixed);
  return hslToRgb([
    hue,
    Math.max(0.42, nextSaturation),
    dark ? Math.max(0.58, lightness) : Math.min(0.48, lightness),
  ]);
}

function ensureReadable(color: string, background: string, minimum: number, dark: boolean): string {
  if (getContrastRatio(color, background) >= minimum) return color;
  const target = dark ? '#f4f1ed' : '#262222';
  for (let weight = 0.2; weight <= 1; weight += 0.1) {
    const candidate = rgbToHex(blend(hexToRgb(target), hexToRgb(color), weight));
    if (getContrastRatio(candidate, background) >= minimum) return candidate;
  }
  return target;
}

function pickContrastingText(background: string): string {
  return getContrastRatio('#15100c', background) >= 4.5 ? '#15100c' : '#ffffff';
}

function changeLightness(rgb: Rgb, delta: number): Rgb {
  const [hue, saturation, lightness] = rgbToHsl(rgb);
  return hslToRgb([hue, saturation, Math.max(0, Math.min(1, lightness + delta))]);
}

function blend(first: Rgb, second: Rgb, firstWeight: number): Rgb {
  return first.map((channel, index) =>
    Math.round(channel * firstWeight + second[index]! * (1 - firstWeight))
  ) as Rgb;
}

function relativeLuminance([red, green, blue]: Rgb): number {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function rgbToHsl([red, green, blue]: Rgb): [number, number, number] {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (delta === 0) return [0, 0, lightness];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return [((hue * 60 + 360) % 360) / 360, saturation, lightness];
}

function hslToRgb([hue, saturation, lightness]: [number, number, number]): Rgb {
  const h = hue * 360;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const match = lightness - chroma / 2;
  let raw: Rgb;
  if (h < 60) raw = [chroma, x, 0];
  else if (h < 120) raw = [x, chroma, 0];
  else if (h < 180) raw = [0, chroma, x];
  else if (h < 240) raw = [0, x, chroma];
  else if (h < 300) raw = [x, 0, chroma];
  else raw = [chroma, 0, x];
  return raw.map((channel) => Math.round((channel + match) * 255)) as Rgb;
}

function hexToRgb(hex: string): Rgb {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}
