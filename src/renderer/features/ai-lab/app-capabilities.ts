const IMAGE_EDIT_BRIDGE_REFERENCE =
  /\b(?:(?:window|globalThis)\s*(?:\?\.|\.)\s*)?yoda\s*(?:\?\.|\.)\s*ai\s*(?:\?\.|\.)\s*editImage\b/;

/**
 * Generated apps only receive image-generation chrome when their source
 * actually uses the matching host bridge.
 */
export function appUsesImageEditBridge(html: string): boolean {
  return IMAGE_EDIT_BRIDGE_REFERENCE.test(html);
}
