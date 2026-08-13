import { Activity, useState, type ReactNode } from 'react';

/**
 * Mount the current task renderer immediately, but do not build every hidden
 * renderer on the task's first frame. Once visited, Activity keeps its React
 * state while hidden so switching internal tabs remains warm.
 */
export function TaskRendererActivity({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const [hasMounted, setHasMounted] = useState(active);

  // Lock the visited state before React commits this activation. An effect
  // would paint once and then schedule a cascading render, which defeats the
  // point of keeping task-tab activation on the immediate path.
  if (active && !hasMounted) setHasMounted(true);

  if (!active && !hasMounted) return null;
  return <Activity mode={active ? 'visible' : 'hidden'}>{children}</Activity>;
}
