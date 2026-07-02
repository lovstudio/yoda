import { AvatarValue } from '@renderer/lib/components/avatar-value';

/**
 * Shared Agent avatar. User-provided glyph/image values win; otherwise we fall
 * back to a brand-tinted initial so legacy Agents without an icon still have an
 * identity.
 */
export function AgentAvatar({
  name,
  icon,
  className,
}: {
  name: string;
  icon?: string;
  className?: string;
}) {
  return (
    <AvatarValue name={name} value={icon} className={className} imageClassName="bg-background-2" />
  );
}
