import { Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { UNASSIGNED_FACET_VALUE, type ProjectFacet } from '@shared/project-facets';
import {
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@renderer/lib/ui/context-menu';
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@renderer/lib/ui/dropdown-menu';

interface FacetAssignSubmenuProps {
  /** Facets the task's project defines. The submenu is skipped when empty. */
  facets: ProjectFacet[];
  /** Current facet assignment (null = unassigned). */
  currentFacetId: string | null;
  onAssign: (facetId: string | null) => void;
  showSeparator?: boolean;
}

/**
 * "Assign to facet" submenu shared by the task context and dropdown menus.
 * Renders nothing when the project defines no facets — an empty picker is worse
 * than no entry at all. Context-menu variant.
 */
export function FacetAssignContextSubmenu({
  facets,
  currentFacetId,
  onAssign,
  showSeparator = true,
}: FacetAssignSubmenuProps) {
  const { t } = useTranslation();
  if (facets.length === 0) return null;
  return (
    <>
      {showSeparator && <ContextMenuSeparator />}
      <ContextMenuSub>
        <ContextMenuSubTrigger className="whitespace-nowrap">
          <Layers className="size-4" />
          {t('facets.assignToFacet')}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuRadioGroup value={currentFacetId ?? UNASSIGNED_FACET_VALUE}>
            <ContextMenuRadioItem value={UNASSIGNED_FACET_VALUE} onClick={() => onAssign(null)}>
              {t('facets.unassigned')}
            </ContextMenuRadioItem>
            {facets.map((facet) => (
              <ContextMenuRadioItem
                key={facet.id}
                value={facet.id}
                onClick={() => onAssign(facet.id)}
              >
                {facet.name}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>
    </>
  );
}

/** Dropdown-menu variant of {@link FacetAssignContextSubmenu}. */
export function FacetAssignDropdownSubmenu({
  facets,
  currentFacetId,
  onAssign,
  showSeparator = true,
}: FacetAssignSubmenuProps) {
  const { t } = useTranslation();
  if (facets.length === 0) return null;
  return (
    <>
      {showSeparator && <DropdownMenuSeparator />}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="whitespace-nowrap">
          <Layers className="size-4" />
          {t('facets.assignToFacet')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup value={currentFacetId ?? UNASSIGNED_FACET_VALUE}>
            <DropdownMenuRadioItem value={UNASSIGNED_FACET_VALUE} onClick={() => onAssign(null)}>
              {t('facets.unassigned')}
            </DropdownMenuRadioItem>
            {facets.map((facet) => (
              <DropdownMenuRadioItem
                key={facet.id}
                value={facet.id}
                onClick={() => onAssign(facet.id)}
              >
                {facet.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
}
