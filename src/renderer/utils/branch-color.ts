/**
 * Stable per-branch accent color, used to tint the sidebar rail of
 * worktree-based task sessions (the call site decides which tasks get one).
 * The same branch always maps to the same hue, distinct branches differ. These
 * are data-keyed decorative tints (like Linear/GitHub label colors), not
 * semantic UI tokens, so a fixed curated palette is intentional. Tones are
 * muted and mid-lightness so they read on both the light (near-white) and dark
 * (near-black) sidebar.
 */
const BRANCH_COLORS = [
  '#C4775E', // terracotta
  '#7C9070', // sage
  '#C49A4A', // ochre
  '#6B83A6', // slate blue
  '#B97A8A', // dusty rose
  '#8C8B4F', // olive
  '#5E9491', // teal
  '#B5825C', // clay
  '#9479A3', // mauve
  '#7A8896', // steel
];

/** Returns a stable hex color for a branch name, or undefined when absent. */
export function branchColor(branchName: string | undefined): string | undefined {
  if (!branchName) return undefined;
  let hash = 0;
  for (let i = 0; i < branchName.length; i++) {
    hash = (hash * 31 + branchName.charCodeAt(i)) | 0;
  }
  return BRANCH_COLORS[Math.abs(hash) % BRANCH_COLORS.length];
}
