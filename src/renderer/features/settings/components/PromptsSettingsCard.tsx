import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronRight, GripVertical, Plus, Trash2 } from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PromptPrinciple } from '@shared/project-settings';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';

/**
 * Manages the user's atomic prompt principles. Enabled principles are appended
 * after the runtime's system prompt when a session spawns for runtimes that
 * support prompt extension, and surface in the session panel's Persona section.
 */
const PromptsSettingsCard: React.FC = () => {
  const { t } = useTranslation();
  const { value, update, isLoading } = useAppSettingsKey('promptPrinciples');
  const items = value?.items ?? [];
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const setItems = (next: PromptPrinciple[]) => update({ items: next });
  const patchItem = (id: string, patch: Partial<PromptPrinciple>) =>
    setItems(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const toggleExpanded = (id: string) =>
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const addPrinciple = () => {
    const id = crypto.randomUUID();
    setItems([...items, { id, name: '', text: '', enabled: true }]);
    setExpandedIds((current) => new Set(current).add(id));
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((item) => item.id === active.id);
    const newIdx = items.findIndex((item) => item.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    setItems(arrayMove(items, oldIdx, newIdx));
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-foreground-passive">{t('settings.prompts.description')}</p>
      <div className="flex flex-col gap-2">
        <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
          <SortableContext
            items={items.map((item) => item.id)}
            strategy={verticalListSortingStrategy}
          >
            {items.map((item) => (
              <SortablePrincipleRow
                key={item.id}
                item={item}
                isOpen={expandedIds.has(item.id)}
                onToggle={() => toggleExpanded(item.id)}
                patchItem={patchItem}
                onRemove={() => setItems(items.filter((entry) => entry.id !== item.id))}
              />
            ))}
          </SortableContext>
        </DndContext>
        {!isLoading && items.length === 0 ? (
          <p className="text-xs text-foreground-passive">{t('settings.prompts.empty')}</p>
        ) : null}
      </div>
      <div>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={addPrinciple}>
          <Plus className="size-3.5" />
          {t('settings.prompts.addPrinciple')}
        </Button>
      </div>
    </div>
  );
};

type SortablePrincipleRowProps = {
  item: PromptPrinciple;
  isOpen: boolean;
  onToggle: () => void;
  patchItem: (id: string, patch: Partial<PromptPrinciple>) => void;
  onRemove: () => void;
};

/**
 * One principle slat. Collapsed by default — only the grip, toggle, switch and
 * name show; the principle text reveals on expand. Drag listeners live on the
 * grip handle only — spreading them on the row would swallow pointer events on
 * the switch, inputs, and textarea inside it.
 */
const SortablePrincipleRow: React.FC<SortablePrincipleRowProps> = ({
  item,
  isOpen,
  onToggle,
  patchItem,
  onRemove,
}) => {
  const { t } = useTranslation();
  const { setNodeRef, transform, transition, isDragging, listeners, attributes } = useSortable({
    id: item.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 1 : 'auto',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group overflow-hidden rounded-xl border border-border/60 bg-muted/10"
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center text-foreground-passive hover:text-foreground active:cursor-grabbing"
          aria-label={t('settings.prompts.reorder')}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-label={t('settings.prompts.toggleExpand')}
          className="shrink-0 text-foreground-passive hover:text-foreground"
        >
          <ChevronRight className={cn('size-4 transition-transform', isOpen && 'rotate-90')} />
        </button>
        <Switch
          size="sm"
          checked={item.enabled}
          onCheckedChange={(checked) => patchItem(item.id, { enabled: checked })}
          aria-label={t('settings.prompts.toggle')}
        />
        <Input
          className="h-7 min-w-0 flex-1 text-xs"
          defaultValue={item.name}
          placeholder={t('settings.prompts.namePlaceholder')}
          onBlur={(event) => {
            const next = event.target.value.trim();
            if (next !== item.name) patchItem(item.id, { name: next });
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-foreground-passive opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          aria-label={t('settings.prompts.remove')}
          onClick={onRemove}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {isOpen && (
        <div className="border-t border-border/60 px-2 py-2 pl-9">
          <Textarea
            className="max-h-64 min-h-16 overflow-auto text-xs"
            defaultValue={item.text}
            placeholder={t('settings.prompts.textPlaceholder')}
            onBlur={(event) => {
              const next = event.target.value;
              if (next !== item.text) patchItem(item.id, { text: next });
            }}
          />
        </div>
      )}
    </div>
  );
};

export default PromptsSettingsCard;
