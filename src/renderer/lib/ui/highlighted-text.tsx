import { Fragment, useMemo } from 'react';

interface HighlightedTextProps {
  text: string;
  /** Raw search input; blank renders the text untouched. */
  query: string;
  className?: string;
}

type Segment = { text: string; match: boolean };

function splitOnMatches(text: string, query: string): Segment[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [{ text, match: false }];

  const haystack = text.toLocaleLowerCase();
  const segments: Segment[] = [];
  let cursor = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, cursor)) {
    if (at > cursor) segments.push({ text: text.slice(cursor, at), match: false });
    segments.push({ text: text.slice(at, at + needle.length), match: true });
    cursor = at + needle.length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}

/**
 * Drops the head of a long line so that a match further along stays inside the
 * visible width. Trimming the tail is left to CSS, which cannot help when the
 * match itself sits past the cut.
 */
export function windowAroundMatch(text: string, query: string, leadIn = 12): string {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return text;
  const at = text.toLocaleLowerCase().indexOf(needle);
  if (at <= leadIn) return text;
  return `…${text.slice(at - leadIn)}`;
}

/** Marks every occurrence of the query within the text, case-insensitively. */
export function HighlightedText({ text, query, className }: HighlightedTextProps) {
  const segments = useMemo(() => splitOnMatches(text, query), [text, query]);
  return (
    <span className={className}>
      {segments.map((segment, index) =>
        segment.match ? (
          // Positional segments: the index is the identity.
          <mark key={index} className="yoda-search-hit">
            {segment.text}
          </mark>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        )
      )}
    </span>
  );
}
