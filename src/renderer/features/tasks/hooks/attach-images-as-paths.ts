export function resolveAttachImagesAsPaths(
  globalValue: boolean | undefined,
  projectOverride: boolean | undefined
): boolean {
  return projectOverride ?? globalValue ?? false;
}
