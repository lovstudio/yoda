import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import type { PluggableList } from 'unified';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { rpc } from '@renderer/lib/ipc';
import { cn } from '@renderer/utils/utils';

type Variant = 'full' | 'compact';

interface MarkdownRendererProps {
  content: string;
  variant?: Variant;
  className?: string;
  /**
   * Optional callback for resolving non-external image src values (e.g. relative
   * paths inside a workspace). Should return a `data:` URI string, or `null` to
   * render a "not found" placeholder. When omitted, local images are not resolved.
   */
  resolveImage?: (src: string) => Promise<string | null>;
}

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * Splits YAML front matter off the markdown content. Returns the parsed
 * key-value data (or `null` when absent/invalid) and the remaining body.
 */
function parseFrontMatter(content: string): {
  data: Record<string, unknown> | null;
  body: string;
} {
  const match = FRONT_MATTER_RE.exec(content);
  if (!match) return { data: null, body: content };
  try {
    const data: unknown = parseYaml(match[1]);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { data: null, body: content };
    }
    return { data: data as Record<string, unknown>, body: content.slice(match[0].length) };
  } catch {
    return { data: null, body: content };
  }
}

function formatFrontMatterValue(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) {
    if (value.some((item) => item !== null && typeof item === 'object')) {
      return stringifyYaml(value).trimEnd();
    }
    const items = value.map(String);
    const inline = items.join(', ');
    return inline.length <= 60 ? inline : items.join('\n');
  }
  if (typeof value === 'object') return stringifyYaml(value).trimEnd();
  return String(value);
}

/** Flattens nested front matter objects into dotted-path rows (e.g. `ports.dev`). */
function flattenFrontMatter(
  data: Record<string, unknown>,
  prefix = ''
): Array<{ key: string; value: string }> {
  return Object.entries(data).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const children = flattenFrontMatter(value as Record<string, unknown>, path);
      return children.length > 0 ? children : [{ key: path, value: '' }];
    }
    return [{ key: path, value: formatFrontMatterValue(value) }];
  });
}

/** Renders front matter as a subtle key-value table above the markdown body. */
const FrontMatterBlock: React.FC<{ data: Record<string, unknown>; variant: Variant }> = ({
  data,
  variant,
}) => {
  const rows = flattenFrontMatter(data);
  if (rows.length === 0) return null;
  const isCompact = variant === 'compact';
  const cellPadding = isCompact ? 'px-2 py-1' : 'px-3 py-1.5';
  return (
    <div
      className={cn('overflow-hidden rounded-md border border-border', isCompact ? 'mb-2' : 'mb-3')}
    >
      <table className={cn('w-full border-collapse', isCompact ? 'text-[11px]' : 'text-xs')}>
        <tbody>
          {rows.map(({ key, value }) => (
            <tr key={key} className="border-t border-border first:border-t-0">
              <td
                className={cn(
                  'whitespace-nowrap bg-muted/30 align-top font-medium text-muted-foreground',
                  cellPadding
                )}
              >
                {key}
              </td>
              <td
                className={cn(
                  'whitespace-pre-wrap break-words align-top text-foreground',
                  cellPadding
                )}
              >
                {value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** Sanitize schema that also allows data: URIs on images */
const sanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src || []), 'data'],
  },
};

/** Resolves a local image src via the provided callback and renders as a base64 data URI. */
const ResolvedImage: React.FC<{
  src: string;
  alt: string;
  resolveImage: (src: string) => Promise<string | null>;
}> = ({ src, alt, resolveImage }) => {
  const { t } = useTranslation();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    resolveImage(src)
      .then((result) => {
        if (cancelled) return;
        if (result) {
          setDataUrl(result);
        } else {
          setError(true);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [src, resolveImage]);

  if (error) {
    return (
      <span className="my-3 inline-block text-xs text-muted-foreground">
        {t('markdown.imageNotFound', { src })}
      </span>
    );
  }
  if (!dataUrl) {
    return (
      <span className="my-3 inline-block text-xs text-muted-foreground">
        {t('markdown.loadingImage')}
      </span>
    );
  }
  return <img src={dataUrl} alt={alt} className="my-3 max-w-full rounded" />;
};

type WithChildren = { children?: React.ReactNode };
type WithChildrenAndClass = { children?: React.ReactNode; className?: string };
type AnchorProps = { href?: string; children?: React.ReactNode };
type ImgProps = { src?: string; alt?: string };
type TableCellProps = {
  children?: React.ReactNode;
  style?: React.CSSProperties;
};

function useFullComponents(
  isDark: boolean,
  resolveImage?: (src: string) => Promise<string | null>
) {
  return useMemo(
    () => ({
      h1: ({ children }: WithChildren) => (
        <h1 className="mb-4 mt-6 border-b border-border pb-2 text-2xl font-semibold text-foreground first:mt-0">
          {children}
        </h1>
      ),
      h2: ({ children }: WithChildren) => (
        <h2 className="mb-3 mt-6 border-b border-border pb-2 text-xl font-semibold text-foreground first:mt-0">
          {children}
        </h2>
      ),
      h3: ({ children }: WithChildren) => (
        <h3 className="mb-2 mt-4 text-lg font-semibold text-foreground">{children}</h3>
      ),
      h4: ({ children }: WithChildren) => (
        <h4 className="mb-2 mt-4 text-base font-semibold text-foreground">{children}</h4>
      ),
      h5: ({ children }: WithChildren) => (
        <h5 className="mb-1 mt-3 text-sm font-semibold text-foreground">{children}</h5>
      ),
      h6: ({ children }: WithChildren) => (
        <h6 className="mb-1 mt-3 text-sm font-semibold text-muted-foreground">{children}</h6>
      ),
      p: ({ children }: WithChildren) => (
        <p className="mb-3 text-sm leading-relaxed text-foreground">{children}</p>
      ),
      ul: ({ children }: WithChildren) => (
        <ul className="mb-3 ml-6 list-disc space-y-1 text-sm text-foreground">{children}</ul>
      ),
      ol: ({ children }: WithChildren) => (
        <ol className="mb-3 ml-6 list-decimal space-y-1 text-sm text-foreground">{children}</ol>
      ),
      li: ({ children }: WithChildren) => <li className="leading-relaxed">{children}</li>,
      code: ({ children, className }: WithChildrenAndClass) => {
        const match = /language-(\w+)/.exec(className || '');
        const language = match ? match[1] : '';
        const isBlock = className?.includes('language-');

        if (isBlock) {
          return (
            <SyntaxHighlighter
              style={isDark ? oneDark : oneLight}
              language={language}
              PreTag="div"
              className="!my-0 !rounded-md !text-xs"
            >
              {String(children).replace(/\n$/, '')}
            </SyntaxHighlighter>
          );
        }

        return <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{children}</code>;
      },
      pre: ({ children }: WithChildren) => (
        <pre className="mb-3 overflow-x-auto rounded-md border border-border">{children}</pre>
      ),
      a: ({ href, children }: AnchorProps) => {
        const isHttp = typeof href === 'string' && /^https?:\/\//i.test(href);
        const handleClick = (e: React.MouseEvent) => {
          if (isHttp) {
            e.preventDefault();
            rpc.app.openExternal(href).catch(() => {});
          }
        };
        return (
          <a
            href={href}
            className="text-primary underline decoration-primary/50 hover:decoration-primary"
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleClick}
          >
            {children}
          </a>
        );
      },
      blockquote: ({ children }: WithChildren) => (
        <blockquote className="mb-3 border-l-4 border-border bg-muted/30 py-1 pl-4 text-sm italic text-muted-foreground">
          {children}
        </blockquote>
      ),
      table: ({ children }: WithChildren) => (
        <div className="mb-3 min-w-0 max-w-full overflow-x-auto">
          <table className="w-max min-w-full border-collapse text-sm">{children}</table>
        </div>
      ),
      thead: ({ children }: WithChildren) => (
        <thead className="border-b border-border bg-muted/30">{children}</thead>
      ),
      th: ({ children, style }: TableCellProps) => (
        <th className="px-3 py-2 text-left font-semibold text-foreground" style={style}>
          {children}
        </th>
      ),
      td: ({ children, style }: TableCellProps) => (
        <td className="border-t border-border px-3 py-2 text-foreground" style={style}>
          {children}
        </td>
      ),
      hr: () => <hr className="my-6 border-border" />,
      img: ({ src, alt }: ImgProps) => {
        const isExternal = typeof src === 'string' && /^https?:\/\//i.test(src);
        if (!isExternal && resolveImage && src) {
          return <ResolvedImage src={src} alt={alt || ''} resolveImage={resolveImage} />;
        }
        return <img src={src} alt={alt || ''} className="my-3 max-w-full rounded" />;
      },
      strong: ({ children }: WithChildren) => (
        <strong className="font-semibold text-foreground">{children}</strong>
      ),
      input: ({ checked, ...props }: React.ComponentPropsWithoutRef<'input'>) => (
        <input
          type="checkbox"
          checked={checked}
          disabled
          className="mr-2 align-middle"
          {...props}
        />
      ),
    }),
    [isDark, resolveImage]
  );
}

function useCompactComponents() {
  return useMemo(
    () => ({
      h1: ({ children }: WithChildren) => (
        <h2 className="mb-1 mt-3 text-sm font-semibold text-foreground first:mt-0">{children}</h2>
      ),
      h2: ({ children }: WithChildren) => (
        <h3 className="mb-1 mt-3 text-sm font-semibold text-foreground first:mt-0">{children}</h3>
      ),
      h3: ({ children }: WithChildren) => (
        <h4 className="mb-1 mt-2 text-xs font-semibold text-foreground">{children}</h4>
      ),
      p: ({ children }: WithChildren) => <p className="mb-2 leading-relaxed">{children}</p>,
      ul: ({ children }: WithChildren) => (
        <ul className="mb-2 ml-4 list-disc space-y-0.5">{children}</ul>
      ),
      ol: ({ children }: WithChildren) => (
        <ol className="mb-2 ml-4 list-decimal space-y-0.5">{children}</ol>
      ),
      li: ({ children }: WithChildren) => <li className="leading-relaxed">{children}</li>,
      code: ({ children, className }: WithChildrenAndClass) => {
        const isBlock = className?.includes('language-');
        return isBlock ? (
          <code className="block overflow-x-auto rounded bg-muted/60 p-2 text-[11px]">
            {children}
          </code>
        ) : (
          <code className="rounded bg-muted/60 px-1 py-0.5 text-[11px]">{children}</code>
        );
      },
      pre: ({ children }: WithChildren) => <pre className="mb-2 overflow-x-auto">{children}</pre>,
      table: ({ children }: WithChildren) => (
        <div className="mb-2 min-w-0 max-w-full overflow-x-auto">
          <table className="w-max min-w-full border-collapse text-[11px]">{children}</table>
        </div>
      ),
      thead: ({ children }: WithChildren) => (
        <thead className="border-b border-border bg-muted/30">{children}</thead>
      ),
      th: ({ children, style }: TableCellProps) => (
        <th className="px-2 py-1.5 text-left font-semibold text-foreground" style={style}>
          {children}
        </th>
      ),
      td: ({ children, style }: TableCellProps) => (
        <td className="border-t border-border px-2 py-1.5 text-foreground" style={style}>
          {children}
        </td>
      ),
      strong: ({ children }: WithChildren) => (
        <strong className="font-semibold text-foreground">{children}</strong>
      ),
      a: ({ href, children }: AnchorProps) => {
        const isHttp = typeof href === 'string' && /^https?:\/\//i.test(href);
        const handleClick = (e: React.MouseEvent) => {
          if (isHttp) {
            e.preventDefault();
            rpc.app.openExternal(href).catch(() => {});
          }
        };
        return (
          <a
            href={href}
            className="text-primary underline"
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleClick}
          >
            {children}
          </a>
        );
      },
    }),
    []
  );
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  variant = 'full',
  className,
  resolveImage,
}) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'ydark';

  const fullComponents = useFullComponents(isDark, resolveImage);
  const compactComponents = useCompactComponents();

  const components = variant === 'full' ? fullComponents : compactComponents;
  const rehypePlugins: PluggableList =
    variant === 'full'
      ? [rehypeRaw, [rehypeSanitize, sanitizeSchema]]
      : [[rehypeSanitize, sanitizeSchema]];

  const { data: frontMatter, body } = useMemo(() => parseFrontMatter(content), [content]);

  return (
    <div className={cn(className)}>
      {frontMatter && <FrontMatterBlock data={frontMatter} variant={variant} />}
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={components}>
        {body}
      </Markdown>
    </div>
  );
};
