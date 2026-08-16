import { Plus, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import type { ProjectFacet } from '@shared/project-facets';
import { Button } from '@renderer/lib/ui/button';
import { Field, FieldDescription, FieldTitle } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { Separator } from '@renderer/lib/ui/separator';
import { Textarea } from '@renderer/lib/ui/textarea';
import type { FormState, FormUpdate } from '../project-settings-form-model';

type FacetsSectionProps = {
  form: FormState;
  update: FormUpdate;
};

function parsePaths(value: string): string[] {
  return value
    .split('\n')
    .map((path) => path.trim())
    .filter(Boolean);
}

/**
 * Long-lived sub-scopes of the project. A task assigned to a facet gets the
 * facet's scope and context file appended to its system prompt at session start,
 * which is why the fields here are repo-relative paths rather than free text.
 */
export const FacetsSection = observer(function FacetsSection({ form, update }: FacetsSectionProps) {
  const { t } = useTranslation();
  const facets = form.facets ?? [];

  const patchFacet = (id: string, patch: Partial<ProjectFacet>) =>
    update(
      'facets',
      facets.map((facet) => (facet.id === id ? { ...facet, ...patch } : facet))
    );

  return (
    <>
      <Separator />
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <FieldTitle>{t('projects.settings.facets.title')}</FieldTitle>
          <FieldDescription className="text-foreground-muted">
            {t('projects.settings.facets.description')}
          </FieldDescription>
        </div>

        <Field>
          <div className="flex flex-col gap-2">
            {facets.map((facet) => (
              <div
                key={facet.id}
                className="flex flex-col gap-2 rounded-xl border border-border/60 bg-muted/10 p-2"
              >
                <div className="flex items-center gap-2">
                  <Input
                    className="h-7 min-w-0 flex-1 text-xs"
                    defaultValue={facet.name}
                    placeholder={t('projects.settings.facets.namePlaceholder')}
                    onBlur={(event) => {
                      const next = event.target.value.trim();
                      if (next !== facet.name) patchFacet(facet.id, { name: next });
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-foreground-passive hover:text-foreground"
                    aria-label={t('projects.settings.facets.remove')}
                    onClick={() =>
                      update(
                        'facets',
                        facets.filter((entry) => entry.id !== facet.id)
                      )
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <Textarea
                  className="min-h-16 text-xs"
                  defaultValue={facet.paths.join('\n')}
                  placeholder={t('projects.settings.facets.pathsPlaceholder')}
                  onBlur={(event) => {
                    const next = parsePaths(event.target.value);
                    if (next.join('\n') !== facet.paths.join('\n')) {
                      patchFacet(facet.id, { paths: next });
                    }
                  }}
                />
                <Input
                  className="h-7 text-xs"
                  defaultValue={facet.contextFile ?? ''}
                  placeholder={t('projects.settings.facets.contextFilePlaceholder')}
                  onBlur={(event) => {
                    const next = event.target.value.trim() || undefined;
                    if (next !== facet.contextFile) patchFacet(facet.id, { contextFile: next });
                  }}
                />
              </div>
            ))}
          </div>
          <div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() =>
                update('facets', [...facets, { id: crypto.randomUUID(), name: '', paths: [] }])
              }
            >
              <Plus className="size-3.5" />
              {t('projects.settings.facets.add')}
            </Button>
          </div>
        </Field>
      </div>
    </>
  );
});
