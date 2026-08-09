import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  PanResponder,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import {
  clampMobileCropRect,
  fullMobileCropRect,
  mobileEditorPointDistance,
  moveMobileCropRect,
  resizeMobileCropRect,
  type MobileCropHandle,
  type MobileCropRect,
  type MobileEditorPoint,
} from './input-image-editing';
import { cropMobileInputImage, encodeMobileInputImage } from './input-media';
import type { MobileImageDraft } from './input-upload';

const EDITOR_COLORS = {
  canvas: '#17191B',
  ink: '#171717',
  muted: '#686B6F',
  page: '#F7F7F2',
  line: '#D8D4CB',
  surface: '#FFFFFF',
};

const ANNOTATION_COLORS = ['#D44747', '#2563EB', '#F0A51A'] as const;
const ANNOTATION_BRUSH_WIDTH = 4;
const EDITOR_MAX_CANVAS_HEIGHT = 430;
const EDITOR_HORIZONTAL_INSET = 18;

type EditorMode = 'annotate' | 'crop';

type AnnotationStroke = {
  color: string;
  points: MobileEditorPoint[];
  width: number;
};

type MobileImageEditorProps = {
  image: MobileImageDraft | null;
  open: boolean;
  onCancel: () => void;
  onError: (message: string) => void;
  onSave: (image: MobileImageDraft) => void;
};

function clampPoint(
  event: GestureResponderEvent,
  width: number,
  height: number
): MobileEditorPoint {
  return {
    x: Math.min(Math.max(event.nativeEvent.locationX, 0), width),
    y: Math.min(Math.max(event.nativeEvent.locationY, 0), height),
  };
}

function isFullCrop(crop: MobileCropRect, width: number, height: number): boolean {
  return (
    Math.abs(crop.x) < 1 &&
    Math.abs(crop.y) < 1 &&
    Math.abs(crop.width - width) < 1 &&
    Math.abs(crop.height - height) < 1
  );
}

function getImageSize(uri: string): Promise<{ height: number; width: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ height, width }),
      (error) => reject(error)
    );
  });
}

function AnnotationStrokeOverlay({ stroke }: { stroke: AnnotationStroke }) {
  if (stroke.points.length === 0) return null;

  return (
    <>
      {stroke.points.length === 1 ? (
        <View
          pointerEvents="none"
          style={[
            styles.annotationDot,
            {
              backgroundColor: stroke.color,
              height: stroke.width * 2,
              left: stroke.points[0].x - stroke.width,
              top: stroke.points[0].y - stroke.width,
              width: stroke.width * 2,
            },
          ]}
        />
      ) : null}
      {stroke.points.slice(1).map((point, index) => {
        const start = stroke.points[index];
        const distance = mobileEditorPointDistance(start, point);
        if (distance < 0.5) return null;

        return (
          <View
            key={`${index}-${point.x}-${point.y}`}
            pointerEvents="none"
            style={[
              styles.annotationSegment,
              {
                backgroundColor: stroke.color,
                height: stroke.width,
                left: start.x,
                top: start.y - stroke.width / 2,
                transform: [{ rotate: `${Math.atan2(point.y - start.y, point.x - start.x)}rad` }],
                width: distance,
              },
            ]}
          />
        );
      })}
    </>
  );
}

function CropOverlay({
  crop,
  height,
  handleResponders,
  width,
}: {
  crop: MobileCropRect;
  height: number;
  handleResponders: Record<MobileCropHandle, ReturnType<typeof PanResponder.create>>;
  width: number;
}) {
  const handles: Array<{ handle: MobileCropHandle; left: number; top: number }> = [
    { handle: 'top-left', left: crop.x - 16, top: crop.y - 16 },
    { handle: 'top-right', left: crop.x + crop.width - 16, top: crop.y - 16 },
    { handle: 'bottom-left', left: crop.x - 16, top: crop.y + crop.height - 16 },
    {
      handle: 'bottom-right',
      left: crop.x + crop.width - 16,
      top: crop.y + crop.height - 16,
    },
  ];

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View
        pointerEvents="none"
        style={[styles.cropShade, { height: crop.y, left: 0, top: 0, width }]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.cropShade,
          { height: height - crop.y - crop.height, left: 0, top: crop.y + crop.height, width },
        ]}
      />
      <View
        pointerEvents="none"
        style={[styles.cropShade, { height: crop.height, left: 0, top: crop.y, width: crop.x }]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.cropShade,
          {
            height: crop.height,
            left: crop.x + crop.width,
            top: crop.y,
            width: width - crop.x - crop.width,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.cropGridLine,
          {
            height: crop.height,
            left: crop.x + crop.width / 3,
            top: crop.y,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.cropGridLine,
          {
            height: crop.height,
            left: crop.x + (crop.width * 2) / 3,
            top: crop.y,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.cropGridLine,
          {
            height: 1,
            left: crop.x,
            top: crop.y + crop.height / 3,
            width: crop.width,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.cropGridLine,
          {
            height: 1,
            left: crop.x,
            top: crop.y + (crop.height * 2) / 3,
            width: crop.width,
          },
        ]}
      />
      <View
        {...handleResponders['top-left'].panHandlers}
        style={[
          styles.cropHandle,
          styles.cropHandleTopLeft,
          { left: handles[0].left, top: handles[0].top },
        ]}
      />
      <View
        {...handleResponders['top-right'].panHandlers}
        style={[
          styles.cropHandle,
          styles.cropHandleTopRight,
          { left: handles[1].left, top: handles[1].top },
        ]}
      />
      <View
        {...handleResponders['bottom-left'].panHandlers}
        style={[
          styles.cropHandle,
          styles.cropHandleBottomLeft,
          { left: handles[2].left, top: handles[2].top },
        ]}
      />
      <View
        {...handleResponders['bottom-right'].panHandlers}
        style={[
          styles.cropHandle,
          styles.cropHandleBottomRight,
          { left: handles[3].left, top: handles[3].top },
        ]}
      />
    </View>
  );
}

export function MobileImageEditor({
  image,
  onCancel,
  onError,
  onSave,
  open,
}: MobileImageEditorProps) {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const [workingImage, setWorkingImage] = useState<MobileImageDraft | null>(image);
  const [mode, setMode] = useState<EditorMode>('crop');
  const [crop, setCrop] = useState<MobileCropRect>({ height: 0, width: 0, x: 0, y: 0 });
  const [cropDirty, setCropDirty] = useState(false);
  const [strokes, setStrokes] = useState<AnnotationStroke[]>([]);
  const [annotationColor, setAnnotationColor] = useState<string>(ANNOTATION_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const editorShotRef = useRef<View>(null);
  const cropGestureStartRef = useRef<MobileCropRect | null>(null);
  const cropRef = useRef(crop);
  const activeStrokeRef = useRef<AnnotationStroke | null>(null);

  const canvasSize = useMemo(() => {
    if (!workingImage) return { height: 0, width: 0 };
    const aspectRatio = workingImage.width / Math.max(workingImage.height, 1);
    const maxWidth = Math.max(windowWidth - EDITOR_HORIZONTAL_INSET * 2, 240);
    const maxHeight = Math.max(windowHeight - 285, 220);
    const width = Math.min(maxWidth, maxHeight * aspectRatio);
    const height = width / aspectRatio;
    return {
      height: Math.min(height, EDITOR_MAX_CANVAS_HEIGHT),
      width: Math.min(width, EDITOR_MAX_CANVAS_HEIGHT * aspectRatio),
    };
  }, [windowHeight, windowWidth, workingImage]);

  useEffect(() => {
    if (!open || !image) return;
    setWorkingImage(image);
    setMode('crop');
    setStrokes([]);
    setCropDirty(false);
    setBusy(false);
  }, [image, open]);

  useEffect(() => {
    if (!open || !workingImage || canvasSize.width <= 0 || canvasSize.height <= 0) return;
    const nextCrop = fullMobileCropRect(canvasSize.width, canvasSize.height);
    cropRef.current = nextCrop;
    setCrop(nextCrop);
    setCropDirty(false);
  }, [canvasSize.height, canvasSize.width, open, workingImage]);

  useEffect(() => {
    cropRef.current = crop;
  }, [crop]);

  const updateCrop = useCallback((nextCrop: MobileCropRect) => {
    cropRef.current = nextCrop;
    setCrop(nextCrop);
    setCropDirty(true);
  }, []);

  const cropFrameResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          cropGestureStartRef.current = cropRef.current;
        },
        onPanResponderMove: (_event, gesture) => {
          const start = cropGestureStartRef.current;
          if (!start) return;
          updateCrop(
            moveMobileCropRect(start, gesture.dx, gesture.dy, canvasSize.width, canvasSize.height)
          );
        },
        onPanResponderRelease: () => {
          cropGestureStartRef.current = null;
        },
        onPanResponderTerminate: () => {
          cropGestureStartRef.current = null;
        },
      }),
    [canvasSize.height, canvasSize.width, updateCrop]
  );

  const cropHandleResponders = useMemo(() => {
    const createResponder = (handle: MobileCropHandle) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          cropGestureStartRef.current = cropRef.current;
        },
        onPanResponderMove: (_event, gesture) => {
          const start = cropGestureStartRef.current;
          if (!start) return;
          updateCrop(
            resizeMobileCropRect(
              start,
              handle,
              gesture.dx,
              gesture.dy,
              canvasSize.width,
              canvasSize.height
            )
          );
        },
        onPanResponderRelease: () => {
          cropGestureStartRef.current = null;
        },
        onPanResponderTerminate: () => {
          cropGestureStartRef.current = null;
        },
      });

    return {
      'bottom-left': createResponder('bottom-left'),
      'bottom-right': createResponder('bottom-right'),
      'top-left': createResponder('top-left'),
      'top-right': createResponder('top-right'),
    };
  }, [canvasSize.height, canvasSize.width, updateCrop]);

  const annotationResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const point = clampPoint(event, canvasSize.width, canvasSize.height);
          const stroke: AnnotationStroke = {
            color: annotationColor,
            points: [point],
            width: ANNOTATION_BRUSH_WIDTH,
          };
          activeStrokeRef.current = stroke;
          setStrokes((current) => [...current, stroke]);
        },
        onPanResponderMove: (event) => {
          const point = clampPoint(event, canvasSize.width, canvasSize.height);
          const activeStroke = activeStrokeRef.current;
          if (!activeStroke) return;
          const lastPoint = activeStroke.points[activeStroke.points.length - 1];
          if (lastPoint && mobileEditorPointDistance(lastPoint, point) < 1.5) return;
          const nextStroke: AnnotationStroke = {
            ...activeStroke,
            points: [...activeStroke.points, point],
          };
          activeStrokeRef.current = nextStroke;
          setStrokes((current) => [...current.slice(0, -1), nextStroke]);
        },
        onPanResponderRelease: () => {
          activeStrokeRef.current = null;
        },
        onPanResponderTerminate: () => {
          activeStrokeRef.current = null;
        },
      }),
    [annotationColor, canvasSize.height, canvasSize.width]
  );

  const applyCrop = useCallback(async (): Promise<MobileImageDraft> => {
    const currentImage = workingImage;
    if (!currentImage) throw new Error('图片还没有准备好，请重试。');
    if (!cropDirty || isFullCrop(crop, canvasSize.width, canvasSize.height)) return currentImage;
    const nextImage = await cropMobileInputImage(
      currentImage,
      clampMobileCropRect(crop, canvasSize.width, canvasSize.height),
      canvasSize.width,
      canvasSize.height
    );
    setWorkingImage(nextImage);
    setStrokes([]);
    return nextImage;
  }, [canvasSize.height, canvasSize.width, crop, cropDirty, workingImage]);

  const captureAnnotatedImage = useCallback(async (currentImage: MobileImageDraft) => {
    const editorCanvas = editorShotRef.current;
    if (!editorCanvas) throw new Error('图片画布还没有准备好，请重试。');
    const capturedUri = await captureRef(editorCanvas, {
      format: 'jpg',
      quality: 0.95,
      result: 'tmpfile',
      useRenderInContext: true,
    });
    const capturedSize = await getImageSize(capturedUri);
    return encodeMobileInputImage({
      height: capturedSize.height,
      id: currentImage.id,
      name: currentImage.name,
      uri: capturedUri,
      width: capturedSize.width,
    });
  }, []);

  const selectMode = useCallback(
    async (nextMode: EditorMode) => {
      if (busy || nextMode === mode) return;
      if (nextMode === 'annotate' && mode === 'crop') {
        setBusy(true);
        try {
          await applyCrop();
          setMode('annotate');
        } catch (error) {
          onError(errorMessage(error));
        } finally {
          setBusy(false);
        }
        return;
      }
      if (nextMode === 'crop' && mode === 'annotate' && strokes.length > 0) {
        if (!workingImage) return;
        setBusy(true);
        try {
          const nextImage = await captureAnnotatedImage(workingImage);
          setWorkingImage(nextImage);
          setStrokes([]);
          setMode('crop');
        } catch (error) {
          onError(errorMessage(error));
        } finally {
          setBusy(false);
        }
        return;
      }
      setMode(nextMode);
    },
    [applyCrop, busy, captureAnnotatedImage, mode, onError, strokes.length, workingImage]
  );

  const finishEditing = useCallback(async () => {
    if (!workingImage || busy) return;
    setBusy(true);
    try {
      let nextImage = workingImage;
      if (mode === 'crop') {
        nextImage = await applyCrop();
      } else if (strokes.length > 0) {
        nextImage = await captureAnnotatedImage(nextImage);
      }
      onSave(nextImage);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [applyCrop, busy, captureAnnotatedImage, mode, onError, onSave, strokes.length, workingImage]);

  if (!open || !workingImage || canvasSize.width <= 0 || canvasSize.height <= 0) return null;

  return (
    <Modal
      animationType="slide"
      presentationStyle="fullScreen"
      visible={open}
      onRequestClose={onCancel}
    >
      <SafeAreaView style={styles.editorPage}>
        <View style={styles.editorHeader}>
          <Pressable
            accessibilityLabel="关闭图片编辑"
            accessibilityRole="button"
            disabled={busy}
            style={({ pressed }) => [styles.editorHeaderButton, pressed ? styles.pressed : null]}
            onPress={onCancel}
          >
            <Text style={styles.editorHeaderButtonText}>取消</Text>
          </Pressable>
          <View style={styles.editorTitleBlock}>
            <Text style={styles.editorEyebrow}>图片输入</Text>
            <Text style={styles.editorTitle}>整理图片</Text>
          </View>
          <Pressable
            accessibilityLabel="完成图片编辑"
            accessibilityRole="button"
            accessibilityState={{ busy, disabled: busy }}
            disabled={busy}
            style={({ pressed }) => [styles.editorDoneButton, pressed ? styles.pressed : null]}
            onPress={() => void finishEditing()}
          >
            {busy ? (
              <ActivityIndicator color={EDITOR_COLORS.surface} size="small" />
            ) : (
              <Text style={styles.editorDoneText}>完成</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.editorCanvasArea}>
          <View
            ref={editorShotRef}
            collapsable={false}
            style={[styles.editorCanvas, { height: canvasSize.height, width: canvasSize.width }]}
          >
            <Image
              resizeMode="stretch"
              source={{ uri: workingImage.uri }}
              style={StyleSheet.absoluteFill}
            />
            {strokes.map((stroke, index) => (
              <AnnotationStrokeOverlay key={`${stroke.color}-${index}`} stroke={stroke} />
            ))}
            {mode === 'crop' ? (
              <>
                <View
                  {...cropFrameResponder.panHandlers}
                  style={[
                    styles.cropFrame,
                    {
                      height: crop.height,
                      left: crop.x,
                      top: crop.y,
                      width: crop.width,
                    },
                  ]}
                />
                <CropOverlay
                  crop={crop}
                  handleResponders={cropHandleResponders}
                  height={canvasSize.height}
                  width={canvasSize.width}
                />
              </>
            ) : (
              <View {...annotationResponder.panHandlers} style={styles.annotationGestureLayer} />
            )}
          </View>
        </View>

        <View style={styles.editorTools}>
          <View style={styles.editorModeRow}>
            <Pressable
              accessibilityLabel="裁切图片"
              accessibilityRole="button"
              accessibilityState={{ selected: mode === 'crop' }}
              disabled={busy}
              style={({ pressed }) => [
                styles.editorModeButton,
                mode === 'crop' ? styles.editorModeButtonSelected : null,
                pressed ? styles.pressed : null,
              ]}
              onPress={() => void selectMode('crop')}
            >
              <Ionicons
                color={mode === 'crop' ? EDITOR_COLORS.ink : EDITOR_COLORS.muted}
                name="crop-outline"
                size={17}
              />
              <Text
                style={[
                  styles.editorModeText,
                  mode === 'crop' ? styles.editorModeTextSelected : null,
                ]}
              >
                裁切
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel="标注图片"
              accessibilityRole="button"
              accessibilityState={{ selected: mode === 'annotate' }}
              disabled={busy}
              style={({ pressed }) => [
                styles.editorModeButton,
                mode === 'annotate' ? styles.editorModeButtonSelected : null,
                pressed ? styles.pressed : null,
              ]}
              onPress={() => void selectMode('annotate')}
            >
              <Ionicons
                color={mode === 'annotate' ? EDITOR_COLORS.ink : EDITOR_COLORS.muted}
                name="brush-outline"
                size={17}
              />
              <Text
                style={[
                  styles.editorModeText,
                  mode === 'annotate' ? styles.editorModeTextSelected : null,
                ]}
              >
                标注
              </Text>
            </Pressable>
          </View>
          {mode === 'crop' ? (
            <View style={styles.editorHintRow}>
              <Ionicons color={EDITOR_COLORS.muted} name="move-outline" size={16} />
              <Text style={styles.editorHint}>拖动边框或四角，保留需要给 Agent 看的区域</Text>
            </View>
          ) : (
            <>
              <View style={styles.editorHintRow}>
                <Ionicons color={EDITOR_COLORS.muted} name="brush-outline" size={16} />
                <Text style={styles.editorHint}>在图片上直接涂画，完成后会合成到图片</Text>
              </View>
              <View style={styles.annotationToolRow}>
                <View style={styles.annotationColors}>
                  {ANNOTATION_COLORS.map((color) => (
                    <Pressable
                      key={color}
                      accessibilityLabel={`选择${color}标注笔`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: annotationColor === color }}
                      style={({ pressed }) => [
                        styles.annotationColorButton,
                        annotationColor === color ? styles.annotationColorButtonSelected : null,
                        pressed ? styles.pressed : null,
                      ]}
                      onPress={() => setAnnotationColor(color)}
                    >
                      <View style={[styles.annotationColorDot, { backgroundColor: color }]} />
                    </Pressable>
                  ))}
                </View>
                <View style={styles.annotationActions}>
                  <Pressable
                    accessibilityLabel="撤销上一笔标注"
                    accessibilityRole="button"
                    accessibilityState={{ disabled: strokes.length === 0 }}
                    disabled={strokes.length === 0}
                    style={({ pressed }) => [
                      styles.annotationAction,
                      pressed ? styles.pressed : null,
                    ]}
                    onPress={() => setStrokes((current) => current.slice(0, -1))}
                  >
                    <Ionicons color={EDITOR_COLORS.ink} name="arrow-undo-outline" size={18} />
                    <Text style={styles.annotationActionText}>撤销</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel="清空全部标注"
                    accessibilityRole="button"
                    accessibilityState={{ disabled: strokes.length === 0 }}
                    disabled={strokes.length === 0}
                    style={({ pressed }) => [
                      styles.annotationAction,
                      pressed ? styles.pressed : null,
                    ]}
                    onPress={() => setStrokes([])}
                  >
                    <Ionicons color={EDITOR_COLORS.muted} name="trash-outline" size={17} />
                    <Text style={styles.annotationActionText}>清空</Text>
                  </Pressable>
                </View>
              </View>
            </>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '图片编辑失败，请重试。';
}

const styles = StyleSheet.create({
  editorPage: {
    flex: 1,
    backgroundColor: EDITOR_COLORS.page,
  },
  editorHeader: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: EDITOR_COLORS.line,
    paddingHorizontal: 16,
  },
  editorHeaderButton: {
    minWidth: 54,
    minHeight: 38,
    justifyContent: 'center',
  },
  editorHeaderButtonText: {
    color: EDITOR_COLORS.muted,
    fontSize: 14,
    fontWeight: '700',
  },
  editorTitleBlock: {
    minWidth: 0,
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  editorEyebrow: {
    color: EDITOR_COLORS.muted,
    fontSize: 10,
    fontWeight: '800',
  },
  editorTitle: {
    color: EDITOR_COLORS.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  editorDoneButton: {
    minWidth: 54,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: EDITOR_COLORS.ink,
    paddingHorizontal: 12,
  },
  editorDoneText: {
    color: EDITOR_COLORS.surface,
    fontSize: 14,
    fontWeight: '800',
  },
  editorCanvasArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: EDITOR_HORIZONTAL_INSET,
  },
  editorCanvas: {
    overflow: 'visible',
    backgroundColor: EDITOR_COLORS.canvas,
  },
  annotationGestureLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  annotationDot: {
    position: 'absolute',
    borderRadius: 99,
  },
  annotationSegment: {
    position: 'absolute',
    borderRadius: 99,
    transformOrigin: 'left center',
  },
  cropShade: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.52)',
  },
  cropGridLine: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
    width: 1,
  },
  cropFrame: {
    position: 'absolute',
    zIndex: 1,
    borderWidth: 2,
    borderColor: EDITOR_COLORS.surface,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  cropHandle: {
    position: 'absolute',
    zIndex: 2,
    width: 32,
    height: 32,
    borderColor: EDITOR_COLORS.surface,
  },
  cropHandleTopLeft: {
    borderTopWidth: 4,
    borderLeftWidth: 4,
  },
  cropHandleTopRight: {
    borderTopWidth: 4,
    borderRightWidth: 4,
  },
  cropHandleBottomLeft: {
    borderBottomWidth: 4,
    borderLeftWidth: 4,
  },
  cropHandleBottomRight: {
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },
  editorTools: {
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: EDITOR_COLORS.line,
    backgroundColor: EDITOR_COLORS.surface,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
  },
  editorModeRow: {
    flexDirection: 'row',
    gap: 8,
    borderRadius: 10,
    backgroundColor: EDITOR_COLORS.page,
    padding: 4,
  },
  editorModeButton: {
    minHeight: 42,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 8,
  },
  editorModeButtonSelected: {
    backgroundColor: EDITOR_COLORS.surface,
    shadowColor: '#000000',
    shadowOffset: { height: 1, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  editorModeText: {
    color: EDITOR_COLORS.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  editorModeTextSelected: {
    color: EDITOR_COLORS.ink,
  },
  editorHintRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  editorHint: {
    color: EDITOR_COLORS.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  annotationToolRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  annotationColors: {
    flexDirection: 'row',
    gap: 8,
  },
  annotationColorButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  annotationColorButtonSelected: {
    backgroundColor: EDITOR_COLORS.page,
  },
  annotationColorDot: {
    width: 17,
    height: 17,
    borderWidth: 2,
    borderColor: EDITOR_COLORS.surface,
    borderRadius: 9,
  },
  annotationActions: {
    flexDirection: 'row',
    gap: 5,
  },
  annotationAction: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 7,
    paddingHorizontal: 7,
  },
  annotationActionText: {
    color: EDITOR_COLORS.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.72,
  },
});
