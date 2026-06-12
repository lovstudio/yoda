import { PenTool } from 'lucide-react';
import type { ComponentType } from 'react';
import { LogoStudioApp } from './components/LogoStudioApp';

/**
 * The AI Lab app registry. AI Lab is an app hub — a place where vibe-coded
 * mini-apps live. Each entry is one installable app: register it here and it
 * shows up on the launcher grid. Copy lives under `aiLab.apps.<id>` in i18n.
 */
export type AiLabAppDefinition = {
  id: string;
  icon: ComponentType<{ className?: string }>;
  /** Accent classes for the launcher tile's icon block. */
  iconClassName: string;
  Component: ComponentType;
};

export const AI_LAB_APPS: AiLabAppDefinition[] = [
  {
    id: 'logo-studio',
    icon: PenTool,
    iconClassName: 'bg-accent/10 text-accent',
    Component: LogoStudioApp,
  },
];
