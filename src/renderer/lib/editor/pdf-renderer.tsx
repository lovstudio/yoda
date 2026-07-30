import { observer } from 'mobx-react-lite';
import { BinaryRenderer } from './binary-renderer';

interface PdfRendererProps {
  file: { path: string; content: string; isLoading: boolean };
}

/** Renders PDF files via Chromium's built-in PDF viewer (data-URL embed). */
export const PdfRenderer = observer(function PdfRenderer({ file }: PdfRendererProps) {
  if (file.isLoading) return null;
  // Load failed (too large / unreadable) — fall back to the binary placeholder.
  if (!file.content) return <BinaryRenderer file={file} />;

  const fileName = file.path.split('/').pop() ?? file.path;

  return (
    <embed src={file.content} type="application/pdf" title={fileName} className="h-full w-full" />
  );
});
