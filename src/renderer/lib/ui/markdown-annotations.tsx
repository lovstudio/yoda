import { Check, MessageSquarePlus, X } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/lib/ui/button';
import { Textarea } from '@renderer/lib/ui/textarea';

/** A single annotation a user attached to a span of the rendered document. */
export interface MarkdownNote {
  id: string;
  /** The selected text the note refers to. */
  quote: string;
  /** The user's note. */
  comment: string;
}

/** Payload handed to the consumer when a note is saved. */
export type MarkdownNoteDraft = Pick<MarkdownNote, 'quote' | 'comment'>;

/** Collapses selection whitespace so quotes stay readable in compact UI. */
function normalizeQuote(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Anchored floating action shown right after a non-empty text selection. */
function SelectionToolbar({ rect, onClick }: { rect: DOMRect; onClick: () => void }) {
  const { t } = useTranslation();
  return createPortal(
    <div
      className="fixed z-50"
      style={{ top: Math.max(rect.top - 36, 4), left: rect.left }}
      // Keep the live selection alive: mousedown would otherwise collapse it
      // before our click handler reads the quote.
      onMouseDown={(event) => event.preventDefault()}
    >
      <Button
        size="xs"
        variant="default"
        className="shadow-md"
        onClick={onClick}
        title={t('markdown.addNote')}
      >
        <MessageSquarePlus />
        {t('markdown.addNote')}
      </Button>
    </div>,
    document.body
  );
}

/** Small composer to type the note for the captured quote. */
function NoteComposer({
  rect,
  quote,
  onSave,
  onCancel,
}: {
  rect: DOMRect;
  quote: string;
  onSave: (comment: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [comment, setComment] = useState('');

  const save = () => {
    const trimmed = comment.trim();
    if (!trimmed) {
      onCancel();
      return;
    }
    onSave(trimmed);
  };

  return createPortal(
    <div
      className="fixed z-50 flex w-72 flex-col gap-2 rounded-md bg-background-quaternary p-3 text-sm shadow-md ring-1 ring-foreground/10"
      style={{
        top: Math.min(rect.bottom + 6, window.innerHeight - 180),
        left: Math.min(rect.left, window.innerWidth - 300),
      }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <p className="line-clamp-2 border-l-2 border-primary/60 pl-2 text-xs italic text-foreground-muted">
        {quote}
      </p>
      <Textarea
        autoFocus
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            save();
          }
        }}
        placeholder={t('markdown.notePlaceholder')}
        className="min-h-16 text-xs leading-relaxed"
      />
      <div className="flex justify-end gap-1.5">
        <Button size="xs" variant="ghost" onClick={onCancel}>
          {t('markdown.cancelNote')}
        </Button>
        <Button size="xs" variant="default" onClick={save}>
          <Check />
          {t('markdown.saveNote')}
        </Button>
      </div>
    </div>,
    document.body
  );
}

/** The in-flow list of all notes attached to the document. */
function NotesList({ notes, onRemove }: { notes: MarkdownNote[]; onRemove: (id: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="mt-4 flex flex-col gap-1.5 border-t border-border pt-3">
      <span className="text-[11px] font-medium text-foreground-passive">
        {t('markdown.notesTitle')} ({notes.length})
      </span>
      {notes.map((note) => (
        <div
          key={note.id}
          className="group/note flex items-start gap-1.5 rounded-sm border-l-2 border-primary/60 bg-background-1/40 py-1 pl-2 pr-1"
        >
          <div className="min-w-0 flex-1">
            <p className="line-clamp-1 text-[11px] italic text-foreground-passive">{note.quote}</p>
            <p className="whitespace-pre-wrap break-words text-xs text-foreground-muted">
              {note.comment}
            </p>
          </div>
          <Button
            size="icon-xs"
            variant="ghost"
            className="opacity-0 transition-opacity group-hover/note:opacity-100"
            onClick={() => onRemove(note.id)}
            title={t('markdown.removeNote')}
          >
            <X />
          </Button>
        </div>
      ))}
    </div>
  );
}

type Captured = { quote: string; rect: DOMRect };

/**
 * Adds select-text → add-note behavior over a rendered markdown container.
 * Selecting text surfaces a floating action; saving a note appends it to the
 * in-flow notes list and forwards it to `onAddNote` (e.g. to sync into a
 * session's input box). Self-contained — owns selection tracking and overlays.
 */
export function MarkdownAnnotations({
  containerRef,
  onAddNote,
  className,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  onAddNote: (note: MarkdownNoteDraft) => void;
  className?: string;
}) {
  const [toolbar, setToolbar] = useState<Captured | null>(null);
  const [composing, setComposing] = useState<Captured | null>(null);
  const [notes, setNotes] = useState<MarkdownNote[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onMouseUp = () => {
      // Don't steal focus from the open composer with a fresh toolbar.
      if (composing) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setToolbar(null);
        return;
      }
      const quote = normalizeQuote(selection.toString());
      if (!quote || !container.contains(selection.anchorNode)) {
        setToolbar(null);
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      setToolbar({ quote, rect });
    };

    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, [containerRef, composing]);

  const beginComposing = useCallback(() => {
    if (!toolbar) return;
    setComposing(toolbar);
    setToolbar(null);
  }, [toolbar]);

  const saveNote = useCallback(
    (comment: string) => {
      if (!composing) return;
      const note: MarkdownNote = { id: crypto.randomUUID(), quote: composing.quote, comment };
      setNotes((prev) => [...prev, note]);
      onAddNote({ quote: note.quote, comment: note.comment });
      setComposing(null);
    },
    [composing, onAddNote]
  );

  const removeNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((note) => note.id !== id));
  }, []);

  return (
    <div className={className}>
      {notes.length > 0 && <NotesList notes={notes} onRemove={removeNote} />}
      {toolbar && <SelectionToolbar rect={toolbar.rect} onClick={beginComposing} />}
      {composing && (
        <NoteComposer
          rect={composing.rect}
          quote={composing.quote}
          onSave={saveNote}
          onCancel={() => setComposing(null)}
        />
      )}
    </div>
  );
}
