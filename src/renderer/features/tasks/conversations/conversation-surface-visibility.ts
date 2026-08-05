export function isConversationSurfaceVisible({
  isActiveTask,
  isSplitView,
  forceVisible,
}: {
  isActiveTask: boolean;
  isSplitView: boolean;
  forceVisible: boolean;
}): boolean {
  return forceVisible || isActiveTask || isSplitView;
}
