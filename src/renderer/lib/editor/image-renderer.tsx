import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Lightbox from 'yet-another-react-lightbox';
import Download from 'yet-another-react-lightbox/plugins/download';
import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen';
import Inline from 'yet-another-react-lightbox/plugins/inline';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';

interface ImageRendererProps {
  file: { path: string; content: string };
}

/** Renders raster image files (png, jpg, gif, webp, ico, bmp). */
export const ImageRenderer = observer(function ImageRenderer({ file }: ImageRendererProps) {
  const { t } = useTranslation();
  const fileName = file.path.split('/').pop() ?? file.path;
  const slides = useMemo(
    () => [
      {
        src: file.content,
        alt: fileName,
        download: { url: file.content, filename: fileName },
      },
    ],
    [file.content, fileName]
  );

  if (!file.content) return null;

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <Lightbox
        className="yoda-image-viewer"
        slides={slides}
        plugins={[Download, Fullscreen, Inline, Zoom]}
        carousel={{ finite: true, padding: 24 }}
        controller={{ disableSwipeNavigation: true }}
        zoom={{ scrollToZoom: true, zoomInMultiplier: 1.5 }}
        labels={{
          Carousel: t('editor.imageViewer.carousel'),
          Lightbox: t('editor.imageViewer.lightbox'),
          Slide: t('editor.imageViewer.image'),
          Download: t('editor.imageViewer.download'),
          'Enter Fullscreen': t('editor.imageViewer.enterFullscreen'),
          'Exit Fullscreen': t('editor.imageViewer.exitFullscreen'),
          'Zoom in': t('editor.imageViewer.zoomIn'),
          'Zoom out': t('editor.imageViewer.zoomOut'),
        }}
        render={{ buttonPrev: () => null, buttonNext: () => null }}
      />
    </div>
  );
});
