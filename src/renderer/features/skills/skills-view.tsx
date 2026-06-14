import { Boxes, Puzzle } from 'lucide-react';
import React, { type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import PluginsView from '@renderer/features/plugins/PluginsView';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { cn } from '@renderer/utils/utils';
import SkillsView from './components/SkillsView';

type SkillsViewParams = {
  focusSkillId?: string;
};

/** Which catalog the unified Skills/Plugins view is showing. */
type Surface = 'skills' | 'plugins';

const SURFACE_STORAGE_KEY = 'yoda.catalogSurface';

function loadStoredSurface(): Surface {
  try {
    return window.localStorage.getItem(SURFACE_STORAGE_KEY) === 'plugins' ? 'plugins' : 'skills';
  } catch {
    return 'skills';
  }
}

const SURFACE_OPTIONS = [
  { value: 'skills', icon: Boxes, labelKey: 'plugins.surface.skills' },
  { value: 'plugins', icon: Puzzle, labelKey: 'plugins.surface.plugins' },
] as const;

/**
 * [Skills | Plugins] switch rendered in the page-title slot of each surface.
 * Styled to match the top-level app tab chips (see AppTab in app-tab-strip.tsx)
 * so switching surfaces reads with the same tab affordance as the rest of the app.
 */
const SurfaceToggle: React.FC<{ value: Surface; onChange: (value: Surface) => void }> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation();
  return (
    <div
      role="tablist"
      aria-label={t('plugins.surface.ariaLabel')}
      className="flex items-center gap-1"
    >
      {SURFACE_OPTIONS.map(({ value: option, icon: Icon, labelKey }) => {
        const active = value === option;
        return (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option)}
            className={cn(
              'group flex h-7 cursor-default select-none items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
              active
                ? 'border-border bg-background-1 text-foreground'
                : 'border-transparent text-foreground-muted hover:bg-background-2 hover:text-foreground'
            )}
          >
            <Icon className="size-3.5 shrink-0" />
            <span className="truncate">{t(labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
};

export function SkillsTitlebar() {
  return <Titlebar />;
}

export function SkillsWrapView({ children }: PropsWithChildren<SkillsViewParams>) {
  return <>{children}</>;
}

export function SkillsMainPanel() {
  const [surface, setSurface] = React.useState<Surface>(loadStoredSurface);

  const changeSurface = React.useCallback((next: Surface) => {
    setSurface(next);
    try {
      window.localStorage.setItem(SURFACE_STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort.
    }
  }, []);

  const toggle = <SurfaceToggle value={surface} onChange={changeSurface} />;

  return surface === 'plugins' ? (
    <PluginsView surfaceControl={toggle} />
  ) : (
    <SkillsView surfaceControl={toggle} />
  );
}

export const skillsView = {
  WrapView: SkillsWrapView,
  TitlebarSlot: SkillsTitlebar,
  MainPanel: SkillsMainPanel,
};
