import { Command } from 'cmdk';
import { useEffect, useRef } from 'react';
import type { SearchItem } from '@shared/search';

/**
 * A cmdk group whose items load incrementally. A sentinel at the bottom calls
 * `fetchNextPage` when it scrolls into view, giving per-category infinite scroll
 * inside the shared Command.List.
 */
export function InfiniteGroup({
  heading,
  className,
  items,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  renderItem,
}: {
  heading: string;
  className?: string;
  items: SearchItem[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  renderItem: (item: SearchItem) => React.ReactNode;
}) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) fetchNextPage();
      },
      { root: node.closest('[cmdk-list]'), rootMargin: '120px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (items.length === 0) return null;

  return (
    <Command.Group heading={heading} className={className}>
      {items.map((item) => renderItem(item))}
      {hasNextPage && <div ref={sentinelRef} aria-hidden className="h-px" />}
    </Command.Group>
  );
}
