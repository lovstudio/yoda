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
 * Prominent segmented [Skills | Plugins] control. Rendered in the page-title
 * slot of each surface so the tabs ARE the header, not a toolbar afterthought.
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
      className="inline-flex items-center gap-1 rounded-lg bg-muted p-1"
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
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-4 w-4" />
            {t(labelKey)}
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
