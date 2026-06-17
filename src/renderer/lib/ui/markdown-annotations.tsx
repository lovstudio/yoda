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
  /** Where the quote lives — e.g. `path/to/file.md:42`. Undefined for sources
   *  without a backing document (e.g. a generated session summary). */
  anchor?: string;
}

/** Payload handed to the consumer when a note is saved. */
export type MarkdownNoteDraft = Pick<MarkdownNote, 'quote' | 'comment' | 'anchor'>;

type Captured = { quote: string; rect: DOMRect; line?: number };

/** Minimal shape of a react-markdown hast node carrying a source position. */
export type SourceNode = { position?: { start?: { line?: number } } };

/**
 * Emits a `data-source-line` attribute from a hast node's source position so a
 * selected quote can be anchored back to its line in the source. Empty object
 * when the position is unavailable (then the anchor falls back to the path).
 */
export function sourceLineAttr(node: SourceNode | undefined): { 'data-source-line'?: number } {
  const line = node?.position?.start?.line;
  return typeof line === 'number' ? { 'data-source-line': line } : {};
}

/** Collapses selection whitespace so quotes stay readable in compact UI. */
function normalizeQuote(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Walks up from a selection node to the nearest element carrying a
 * `data-source-line` attribute (emitted by the markdown block components) and
 * returns that 1-based source line. Undefined when positions aren't available.
 */
function sourceLineOf(node: Node | null): number | undefined {
  const start = node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null);
  const el = start?.closest('[data-source-line]');
  const line = el?.getAttribute('data-source-line');
  const parsed = line ? Number.parseInt(line, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Reads the current window selection and, when it is a non-empty range that
 * starts inside `container`, returns the normalized quote, the range's viewport
 * rect, and the source line of the selection start. Returns `null` otherwise.
 * Exported for testing.
 */
export function detectSelectionInside(container: HTMLElement): Captured | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const quote = normalizeQuote(selection.toString());
  if (!quote) return null;
  // The anchor can be a text node; `contains` covers nodes and their parents.
  if (!container.contains(selection.anchorNode)) return null;
  const range = selection.getRangeAt(0);
  return { quote, rect: range.getBoundingClientRect(), line: sourceLineOf(range.startContainer) };
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
            {note.anchor ? (
              <p className="truncate font-mono text-[10px] text-foreground-passive">
                {note.anchor}
              </p>
            ) : null}
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

/**
 * Adds select-text → add-note behavior over a rendered markdown container.
 * Selecting text surfaces a floating action; saving a note appends it to the
 * in-flow notes list and forwards it to `onAddNote` (e.g. to sync into a
 * session's input box). Self-contained — owns selection tracking and overlays.
 */
export function MarkdownAnnotations({
  containerRef,
  onAddNote,
  documentPath,
  className,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  /** Called when a note is saved. Omit when there is no sync target (e.g. a
   *  read-only doc not opened from a session) — notes still render locally. */
  onAddNote?: (note: MarkdownNoteDraft) => void;
  /** Backing document path; combined with the source line into a note anchor
   *  (`path:line`) so the consumer can point precisely at the quote. */
  documentPath?: string;
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
      setToolbar(detectSelectionInside(container));
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
      const anchor = documentPath
        ? composing.line
          ? `${documentPath}:${composing.line}`
          : documentPath
        : undefined;
      const note: MarkdownNote = {
        id: crypto.randomUUID(),
        quote: composing.quote,
        comment,
        anchor,
      };
      setNotes((prev) => [...prev, note]);
      onAddNote?.({ quote: note.quote, comment: note.comment, anchor: note.anchor });
      setComposing(null);
    },
    [composing, onAddNote, documentPath]
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
