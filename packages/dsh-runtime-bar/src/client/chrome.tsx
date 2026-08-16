/**
 * The one presentation every bar entry uses. An entry decides what it says and
 * whether it says anything at all; how it looks — glyph size, label behaviour
 * under a narrow column, hit target, hover — belongs here, so four entries
 * cannot end up as four slightly different chips.
 */
import clsx from 'clsx';
import type { ReactNode } from 'react';
import css from './bar.module.css';

type BarEntryProps = {
  /**
   * Leading glyph, already rendered. Taking an element rather than a component
   * lets an entry lead with a state dot instead of an icon without a second
   * prop that means almost the same thing; the chrome still owns the box it
   * sits in.
   */
  icon: ReactNode;
  /**
   * What the entry is. Hidden once the column narrows — the glyph and the value
   * carry the meaning from there, which is why every entry also sets `title`.
   */
  label: string;
  /** Full sentence for the native tooltip; also the accessible name. */
  title: string;
  /** Present only on entries that actually do something when clicked. */
  onClick?: () => void;
  /** The figure or state this entry reports. */
  children?: ReactNode;
};

/** One entry chip. */
export function BarEntry({ icon, label, title, onClick, children }: BarEntryProps): ReactNode {
  const body = (
    <>
      <span className={css.icon}>{icon}</span>
      <span className={css.label}>{label}</span>
      {children}
    </>
  );

  if (onClick === undefined) {
    return (
      <span className={css.entry} title={title}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={clsx(css.entry, css.button)}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {body}
    </button>
  );
}

/** The value slot: truncates rather than pushing its neighbours off the row. */
export function BarValue({ children }: { children: ReactNode }): ReactNode {
  return <span className={css.value}>{children}</span>;
}
