import { Bot, Columns2, GitFork } from 'lucide-react';
import type { ComponentType } from 'react';
import type { ParadigmIconId } from '@shared/paradigms/contract';
import { AvatarValue } from '@renderer/lib/components/avatar-value';
import { cn } from '@renderer/utils/utils';

/**
 * The renderer half of `ParadigmIconId`. Shared paradigm code is imported by the
 * main and mobile processes, so it names icons as strings and this map is the one
 * place they become components.
 */
export const PARADIGM_ICONS: Record<ParadigmIconId, ComponentType<{ className?: string }>> = {
  bot: Bot,
  'git-fork': GitFork,
  columns: Columns2,
};

/** Renders a paradigm's (or slot's) declared icon. */
export function ParadigmIcon({
  iconId,
  className,
}: {
  iconId: ParadigmIconId;
  className?: string;
}) {
  const Icon = PARADIGM_ICONS[iconId];
  return <Icon className={className} />;
}

/**
 * A paradigm's mark at one footprint: the instance's own avatar when it has one,
 * its kind's glyph when it does not.
 *
 * Both get the same tile. An image and a bare line glyph have nothing in common
 * visually, and a list that alternates between them reads as two kinds of thing
 * at two weights — so the glyph is given the frame the avatar already has.
 */
export function ParadigmMark({
  iconId,
  avatar,
  name,
  active = false,
  className,
}: {
  iconId: ParadigmIconId;
  /** The instance's glyph or image. Absent on anything never re-iconed. */
  avatar?: string | undefined;
  /** Drives the initial an image-less avatar falls back to. */
  name: string;
  active?: boolean;
  className?: string;
}) {
  if (avatar)
    return (
      <AvatarValue
        name={name}
        value={avatar}
        className={cn('size-9 rounded-lg text-sm', className)}
        imageClassName="bg-background-2"
      />
    );
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-lg',
        active ? 'bg-primary/10 text-primary' : 'bg-background-2 text-foreground-muted',
        className
      )}
    >
      <ParadigmIcon iconId={iconId} className="size-4" />
    </span>
  );
}
