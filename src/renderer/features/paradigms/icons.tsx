import {
  AppWindow,
  Bot,
  Columns2,
  GitFork,
  Lightbulb,
  Repeat2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { ParadigmIconId } from '@shared/paradigms/contract';

/**
 * The renderer half of `ParadigmIconId`. Shared paradigm code is imported by the
 * main and mobile processes, so it names icons as strings and this map is the one
 * place they become components.
 */
export const PARADIGM_ICONS: Record<ParadigmIconId, ComponentType<{ className?: string }>> = {
  bot: Bot,
  lightbulb: Lightbulb,
  repeat: Repeat2,
  'app-window': AppWindow,
  'git-fork': GitFork,
  columns: Columns2,
  'shield-check': ShieldCheck,
  users: Users,
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
