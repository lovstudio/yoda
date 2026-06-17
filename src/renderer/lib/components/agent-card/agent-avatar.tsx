import { cn } from '@renderer/utils/utils';

/**
 * Monogram avatar for an Agent. We deliberately do not render the Agent's emoji
 * — a brand-tinted initial reads as a real identity anchor and stays consistent
 * across light/dark themes, where stray emoji look out of place. Shared by every
 * surface that shows an Agent (slot picker, manager grid, team roster).
 */
export function AgentAvatar({ name, className }: { name: string; className?: string }) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '·';
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 select-none items-center justify-center rounded-lg bg-primary-button-background font-semibold uppercase leading-none text-primary-button-foreground',
        className
      )}
    >
      {initial}
    </span>
  );
}
