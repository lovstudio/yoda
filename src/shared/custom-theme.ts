import z from 'zod';

export const CUSTOM_THEME_SCHEMA_VERSION = 1;
export const CUSTOM_THEME_SELECTION_PREFIX = 'custom:';
export const CUSTOM_THEME_EXAMPLE_FILE_NAME = 'yoda-theme-example.json';
export const DREAM_SKIN_BUILTIN_IMAGE = 'builtin:dream-portal';
export const DREAM_SKIN_MAX_IMAGE_BYTES = 16 * 1024 * 1024;
export const DREAM_SKIN_SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type BuiltInTheme =
  | 'ylight'
  | 'ydark'
  | 'ywarm'
  | 'ygreen'
  | 'ylight2'
  | 'ydream'
  | 'ydream-night';

/** A non-null theme selection, as stored in the system light/dark pair. */
export type ResolvedThemeSelection = Exclude<ThemeSelection, null>;
export type CustomThemeMode = 'light' | 'dark';
export type CustomThemeSelection = `${typeof CUSTOM_THEME_SELECTION_PREFIX}${string}`;
export type ThemeSelection = BuiltInTheme | CustomThemeSelection | null;

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const CUSTOM_THEME_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;

export const customThemeIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(CUSTOM_THEME_ID_RE, 'Use lowercase letters, numbers, dots, hyphens, or underscores.');

export const hexColorSchema = z
  .string()
  .regex(HEX_COLOR_RE, 'Use a 6-digit hex color, for example #0f172a.')
  .transform((value) => value.toLowerCase());

export const customThemeColorsSchema = z
  .object({
    background: hexColorSchema,
    background1: hexColorSchema,
    background2: hexColorSchema,
    background3: hexColorSchema,
    foreground: hexColorSchema,
    foregroundMuted: hexColorSchema,
    foregroundPassive: hexColorSchema,
    border: hexColorSchema,
    border1: hexColorSchema,
    border2: hexColorSchema,
    primaryButtonBackground: hexColorSchema,
    primaryButtonBackgroundHover: hexColorSchema,
    primaryButtonForeground: hexColorSchema,
    primaryButtonBorder: hexColorSchema,
    statusInProgress: hexColorSchema,
    statusInReview: hexColorSchema,
    statusDone: hexColorSchema,
    statusTodo: hexColorSchema,
    statusCancelled: hexColorSchema,
    diffAdded: hexColorSchema,
    diffModified: hexColorSchema,
    diffDeleted: hexColorSchema,
  })
  .strict();

const DREAM_SKIN_IMAGE_DATA_URL_RE = /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\r\n]+$/i;
const DREAM_SKIN_MAX_DATA_URL_LENGTH = Math.ceil((DREAM_SKIN_MAX_IMAGE_BYTES * 4) / 3) + 128;

export const dreamSkinSchema = z
  .object({
    kind: z.literal('dream-skin'),
    image: z.union([
      z.literal(DREAM_SKIN_BUILTIN_IMAGE),
      z
        .string()
        .max(DREAM_SKIN_MAX_DATA_URL_LENGTH, 'The skin image must be no larger than 16 MB.')
        .regex(
          DREAM_SKIN_IMAGE_DATA_URL_RE,
          'Use a base64 PNG, JPEG, or WebP data URL for the skin image.'
        ),
    ]),
    imageName: z.string().trim().min(1).max(255),
    brandSubtitle: z.string().trim().max(80).default('YODA DREAM SKIN'),
    tagline: z.string().trim().max(160).default('Make something wonderful.'),
    statusText: z.string().trim().max(80).default('DREAM SKIN ONLINE'),
    quote: z.string().trim().max(80).default('MAKE SOMETHING WONDERFUL'),
  })
  .strict();

export const customThemeSchema = z
  .object({
    schemaVersion: z.literal(CUSTOM_THEME_SCHEMA_VERSION),
    id: customThemeIdSchema,
    name: z.string().trim().min(1).max(80),
    mode: z.enum(['light', 'dark']),
    colors: customThemeColorsSchema,
    skin: dreamSkinSchema.optional(),
  })
  .strict();

export const customThemeCollectionSchema = z
  .object({
    schemaVersion: z.literal(CUSTOM_THEME_SCHEMA_VERSION),
    kind: z.literal('yoda-theme-collection'),
    themes: z.array(customThemeSchema).min(1).max(100),
  })
  .strict()
  .superRefine(({ themes }, ctx) => {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const [index, theme] of themes.entries()) {
      if (ids.has(theme.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['themes', index, 'id'],
          message: `Duplicate theme id: ${theme.id}`,
        });
      }
      ids.add(theme.id);

      const normalizedName = theme.name.trim().toLowerCase();
      if (names.has(normalizedName)) {
        ctx.addIssue({
          code: 'custom',
          path: ['themes', index, 'name'],
          message: `Duplicate theme name: ${theme.name}`,
        });
      }
      names.add(normalizedName);
    }
  });

export const customThemesSettingsSchema = z
  .object({
    items: z.array(customThemeSchema).max(100),
  })
  .default({ items: [] });

export type CustomThemeColors = z.infer<typeof customThemeColorsSchema>;
export type DreamSkin = z.infer<typeof dreamSkinSchema>;
export type CustomTheme = z.infer<typeof customThemeSchema>;
export type CustomThemeCollection = z.infer<typeof customThemeCollectionSchema>;
export type CustomThemesSettings = z.infer<typeof customThemesSettingsSchema>;

export const CUSTOM_THEME_EXAMPLE: CustomTheme = {
  schemaVersion: CUSTOM_THEME_SCHEMA_VERSION,
  id: 'example-light',
  name: 'Example Light',
  mode: 'light',
  colors: {
    background: '#faf7ef',
    background1: '#f2ecdd',
    background2: '#e8dfca',
    background3: '#d8ceb9',
    foreground: '#1f2933',
    foregroundMuted: '#64707d',
    foregroundPassive: '#9ca3af',
    border: '#d8ceb9',
    border1: '#b9ad95',
    border2: '#918771',
    primaryButtonBackground: '#215a46',
    primaryButtonBackgroundHover: '#287055',
    primaryButtonForeground: '#ffffff',
    primaryButtonBorder: '#1b4b3a',
    statusInProgress: '#9a6700',
    statusInReview: '#2f7d4f',
    statusDone: '#6b7280',
    statusTodo: '#6b7280',
    statusCancelled: '#9ca3af',
    diffAdded: '#3f8f5f',
    diffModified: '#b7791f',
    diffDeleted: '#c2413b',
  },
};

// Built-in "Yoda Warm" palette (Lovstudio Warm Academic). Selected via the
// 'ywarm' built-in theme and applied through the custom-theme CSS var pipeline.
export const YODA_WARM_THEME: CustomTheme = {
  schemaVersion: CUSTOM_THEME_SCHEMA_VERSION,
  id: 'ywarm',
  name: 'Yoda Warm',
  mode: 'light',
  colors: {
    background: '#f9f9f7',
    background1: '#f4f2ec',
    background2: '#ece8dc',
    background3: '#ded8c7',
    foreground: '#181818',
    foregroundMuted: '#73736b',
    foregroundPassive: '#9a9890',
    border: '#ddd8cb',
    border1: '#c9c1b2',
    border2: '#a89f90',
    primaryButtonBackground: '#a8563f',
    primaryButtonBackgroundHover: '#8f4734',
    primaryButtonForeground: '#ffffff',
    primaryButtonBorder: '#8f4734',
    statusInProgress: '#b7791f',
    statusInReview: '#735384',
    statusDone: '#5f7f4f',
    statusTodo: '#87867f',
    statusCancelled: '#b45f5c',
    diffAdded: '#5f7f4f',
    diffModified: '#c29242',
    diffDeleted: '#c86655',
  },
};

// Built-in "Yoda Green" palette — full phosphor CRT: green-tinted dark
// backgrounds, not just green accents (those now live in the ydark base).
// Selected via the 'ygreen' built-in theme and applied through the
// custom-theme CSS var pipeline.
export const YODA_GREEN_THEME: CustomTheme = {
  schemaVersion: CUSTOM_THEME_SCHEMA_VERSION,
  id: 'ygreen',
  name: 'Yoda Green',
  mode: 'dark',
  colors: {
    background: '#0b130e',
    background1: '#101a13',
    background2: '#15221a',
    background3: '#1c2c21',
    foreground: '#d9eadf',
    foregroundMuted: '#8aa593',
    foregroundPassive: '#5a7363',
    border: '#1c2c21',
    border1: '#27392c',
    border2: '#344a3a',
    primaryButtonBackground: '#5ecf95',
    primaryButtonBackgroundHover: '#74dba6',
    primaryButtonForeground: '#08130d',
    primaryButtonBorder: '#46b87e',
    statusInProgress: '#c9a227',
    statusInReview: '#6cc0e0',
    statusDone: '#6f8f7d',
    statusTodo: '#6f8f7d',
    statusCancelled: '#55695c',
    diffAdded: '#54d68d',
    diffModified: '#c9a227',
    diffDeleted: '#e0705f',
  },
};

// Built-in "Yoda Light II" palette — celadon paper: green-tinted whites with
// the Yoda-green accent family, the light-mode counterpart of the ydark
// phosphor base. A/B candidate against the neutral 'ylight'. Selected via the
// 'ylight2' built-in theme and applied through the custom-theme CSS var
// pipeline.
export const YODA_LIGHT2_THEME: CustomTheme = {
  schemaVersion: CUSTOM_THEME_SCHEMA_VERSION,
  id: 'ylight2',
  name: 'Yoda Light II',
  mode: 'light',
  colors: {
    background: '#f5f7f3',
    background1: '#eef1ea',
    background2: '#e4e9e0',
    background3: '#d7ded2',
    foreground: '#1c1f1b',
    foregroundMuted: '#5c655c',
    foregroundPassive: '#98a195',
    border: '#d7ded2',
    border1: '#c2cbbc',
    border2: '#a0ab99',
    primaryButtonBackground: '#2f9e63',
    primaryButtonBackgroundHover: '#288a56',
    primaryButtonForeground: '#ffffff',
    primaryButtonBorder: '#288a56',
    statusInProgress: '#9a6700',
    statusInReview: '#2f7d8f',
    statusDone: '#6b7268',
    statusTodo: '#6b7268',
    statusCancelled: '#98a195',
    diffAdded: '#2f8f57',
    diffModified: '#b7791f',
    diffDeleted: '#c2473d',
  },
};

// Built-in "Yoda Dream" palette — the native Yoda adaptation of the
// MIT-licensed Codex Dream Skin project. The palette continues through the
// shared terminal/Monaco pipeline; its image and glass treatment live in
// renderer CSS behind the `ydream` root class.
const DEFAULT_DREAM_SKIN: DreamSkin = {
  kind: 'dream-skin',
  image: DREAM_SKIN_BUILTIN_IMAGE,
  imageName: 'codex-dream-skin.jpg',
  brandSubtitle: 'YODA DREAM SKIN',
  tagline: 'Turn inspiration into an interactive agent workspace.',
  statusText: 'DREAM SKIN ONLINE',
  quote: 'MAKE SOMETHING WONDERFUL',
};

export const YODA_DREAM_THEME: CustomTheme = {
  schemaVersion: CUSTOM_THEME_SCHEMA_VERSION,
  id: 'ydream',
  name: 'Yoda Dream',
  mode: 'light',
  skin: DEFAULT_DREAM_SKIN,
  colors: {
    background: '#f7f4f5',
    background1: '#ffffff',
    background2: '#fff7f8',
    background3: '#f8e7ea',
    foreground: '#2b2224',
    foregroundMuted: '#756669',
    foregroundPassive: '#a28f93',
    border: '#ead8dc',
    border1: '#d9bfc4',
    border2: '#bd929a',
    primaryButtonBackground: '#e25563',
    primaryButtonBackgroundHover: '#c93d4c',
    primaryButtonForeground: '#ffffff',
    primaryButtonBorder: '#c93d4c',
    statusInProgress: '#c97a32',
    statusInReview: '#a25480',
    statusDone: '#5f8d77',
    statusTodo: '#7b7073',
    statusCancelled: '#aa747c',
    diffAdded: '#4f9572',
    diffModified: '#c58b3e',
    diffDeleted: '#d14f5d',
  },
};

export const YODA_DREAM_NIGHT_THEME: CustomTheme = {
  schemaVersion: CUSTOM_THEME_SCHEMA_VERSION,
  id: 'ydream-night',
  name: 'Yoda Dream Night',
  mode: 'dark',
  skin: {
    ...DEFAULT_DREAM_SKIN,
    brandSubtitle: 'YODA DREAM NIGHT',
    statusText: 'NIGHT SKIN ONLINE',
  },
  colors: {
    background: '#0b1118',
    background1: '#111a22',
    background2: '#17232c',
    background3: '#21313b',
    foreground: '#f7edf0',
    foregroundMuted: '#bca9ae',
    foregroundPassive: '#786970',
    border: '#2b3942',
    border1: '#3b4a54',
    border2: '#56646d',
    primaryButtonBackground: '#f07a86',
    primaryButtonBackgroundHover: '#ff929d',
    primaryButtonForeground: '#241014',
    primaryButtonBorder: '#d85d69',
    statusInProgress: '#d9a24f',
    statusInReview: '#d991bc',
    statusDone: '#7ba68f',
    statusTodo: '#98878c',
    statusCancelled: '#79676c',
    diffAdded: '#70bd91',
    diffModified: '#dda95a',
    diffDeleted: '#ee7080',
  },
};

export function createDreamSkinTheme(input: {
  id: string;
  name: string;
  image: string;
  imageName: string;
  mode?: CustomThemeMode;
}): CustomTheme {
  const base = input.mode === 'dark' ? YODA_DREAM_NIGHT_THEME : YODA_DREAM_THEME;
  return customThemeSchema.parse({
    ...base,
    id: input.id,
    name: input.name,
    mode: input.mode ?? 'light',
    skin: {
      ...base.skin,
      image: input.image,
      imageName: input.imageName,
    },
  });
}

export type CustomThemeWarning = {
  code: 'low-contrast';
  foreground: keyof CustomThemeColors;
  background: keyof CustomThemeColors;
  contrast: number;
  minimum: number;
};

export type CustomThemePackageParseResult =
  | {
      ok: true;
      themes: Array<{ theme: CustomTheme; warnings: CustomThemeWarning[] }>;
    }
  | {
      ok: false;
      reason: 'invalid-json' | 'invalid-theme';
      message: string;
    };

export function toCustomThemeSelection(id: string): CustomThemeSelection {
  return `${CUSTOM_THEME_SELECTION_PREFIX}${id}`;
}

export function getCustomThemeId(selection: unknown): string | null {
  if (typeof selection !== 'string' || !selection.startsWith(CUSTOM_THEME_SELECTION_PREFIX)) {
    return null;
  }
  const id = selection.slice(CUSTOM_THEME_SELECTION_PREFIX.length);
  return customThemeIdSchema.safeParse(id).success ? id : null;
}

export function isCustomThemeSelection(value: unknown): value is CustomThemeSelection {
  return getCustomThemeId(value) !== null;
}

export const customThemeSelectionSchema = z.custom<CustomThemeSelection>(isCustomThemeSelection);

export function findCustomTheme(
  themes: readonly CustomTheme[],
  selection: unknown
): CustomTheme | undefined {
  const id = getCustomThemeId(selection);
  if (!id) return undefined;
  return themes.find((theme) => theme.id === id);
}

/** Light/dark base for every built-in theme selection. */
const BUILT_IN_THEME_MODES: Record<BuiltInTheme, CustomThemeMode> = {
  ylight: 'light',
  ydark: 'dark',
  ywarm: 'light',
  ygreen: 'dark',
  ylight2: 'light',
  ydream: 'light',
  'ydream-night': 'dark',
};

/**
 * Resolves a theme selection to its effective light/dark mode — the single
 * source of truth shared by the renderer (CSS classes) and the main process
 * (CLI theme alignment). `null` means follow-system, resolved through the
 * configured light/dark pair.
 */
export function resolveThemeMode(
  selection: ThemeSelection,
  ctx: {
    systemMode: CustomThemeMode;
    systemThemes: { light: ThemeSelection; dark: ThemeSelection };
    customThemes: readonly CustomTheme[];
  }
): CustomThemeMode {
  const active =
    selection ?? (ctx.systemMode === 'dark' ? ctx.systemThemes.dark : ctx.systemThemes.light);
  if (active && active in BUILT_IN_THEME_MODES) {
    return BUILT_IN_THEME_MODES[active as BuiltInTheme];
  }
  return findCustomTheme(ctx.customThemes, active)?.mode ?? ctx.systemMode;
}

export function parseCustomThemePackageText(text: string): CustomThemePackageParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      ok: false,
      reason: 'invalid-json',
      message: 'The selected file is not valid JSON.',
    };
  }

  const isCollection = looksLikeThemeCollection(raw);
  const parsed = isCollection
    ? customThemeCollectionSchema.safeParse(raw)
    : customThemeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid-theme',
      message: parsed.error.issues.map(formatZodIssue).join('\n'),
    };
  }

  return {
    ok: true,
    themes: (isCollection
      ? (parsed.data as CustomThemeCollection).themes
      : [parsed.data as CustomTheme]
    ).map((theme) => ({
      theme,
      warnings: getCustomThemeWarnings(theme),
    })),
  };
}

export function createCustomThemeCollection(themes: readonly CustomTheme[]): CustomThemeCollection {
  return {
    schemaVersion: CUSTOM_THEME_SCHEMA_VERSION,
    kind: 'yoda-theme-collection',
    themes: [...themes],
  };
}

export function getCustomThemeWarnings(theme: CustomTheme): CustomThemeWarning[] {
  const pairs: Array<{
    foreground: keyof CustomThemeColors;
    background: keyof CustomThemeColors;
    minimum: number;
  }> = [
    { foreground: 'foreground', background: 'background', minimum: 4.5 },
    { foreground: 'foregroundMuted', background: 'background', minimum: 3 },
    { foreground: 'primaryButtonForeground', background: 'primaryButtonBackground', minimum: 4.5 },
  ];

  return pairs.flatMap(({ foreground, background, minimum }) => {
    const contrast = getContrastRatio(theme.colors[foreground], theme.colors[background]);
    if (contrast >= minimum) return [];
    return [{ code: 'low-contrast' as const, foreground, background, contrast, minimum }];
  });
}

export function getContrastRatio(foreground: string, background: string): number {
  const foregroundLum = getRelativeLuminance(foreground);
  const backgroundLum = getRelativeLuminance(background);
  const lighter = Math.max(foregroundLum, backgroundLum);
  const darker = Math.min(foregroundLum, backgroundLum);
  return (lighter + 0.05) / (darker + 0.05);
}

function getRelativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function looksLikeThemeCollection(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    ('themes' in value || ('kind' in value && value.kind === 'yoda-theme-collection'))
  );
}

function formatZodIssue(issue: z.ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join('.') : 'theme';
  return `${path}: ${issue.message}`;
}
