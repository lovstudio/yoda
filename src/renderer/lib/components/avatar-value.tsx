import { cn } from '@renderer/utils/utils';

const AVATAR_IMAGE_RE = /^(data:image\/|https?:\/\/|blob:|file:\/\/)/i;

/**
 * Longest value still plausible as a glyph (an emoji sequence, initials). Past
 * this an avatar value is a payload — an unrecognized data URI scheme, a path,
 * raw markup — and printing it as text is never what the author meant.
 */
const MAX_GLYPH_LENGTH = 8;

export function isAvatarImageValue(value: string | null | undefined): boolean {
  return AVATAR_IMAGE_RE.test(value?.trim() ?? '');
}

export function avatarFallbackText(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '·';
}

export function avatarDisplayText(name: string, value: string | null | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || isAvatarImageValue(trimmed)) return avatarFallbackText(name);
  return Array.from(trimmed).length <= MAX_GLYPH_LENGTH ? trimmed : avatarFallbackText(name);
}

export function AvatarValue({
  name,
  value,
  className,
  imageClassName,
  textClassName,
}: {
  name: string;
  value?: string | null;
  className?: string;
  imageClassName?: string;
  textClassName?: string;
}) {
  const trimmed = value?.trim() ?? '';
  const image = isAvatarImageValue(trimmed);

  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 select-none items-center justify-center overflow-hidden rounded-lg bg-primary-button-background font-semibold leading-none text-primary-button-foreground',
        className
      )}
    >
      {image ? (
        <img
          src={trimmed}
          alt=""
          draggable={false}
          className={cn('h-full w-full rounded-[inherit] object-cover', imageClassName)}
        />
      ) : (
        <span className={cn('min-w-0 truncate', textClassName)}>
          {avatarDisplayText(name, trimmed)}
        </span>
      )}
    </span>
  );
}
