/**
 * Stable per-branch accent color.
 *
 * Whether a task is a fork or sits on the trunk is a per-user habit (some
 * people are always forking, some never), so it can't carry information. A
 * branch's *identity* can: the same branch always gets the same hue, different
 * branches differ — useful in every workflow. These are data-keyed decorative
 * tints (like Linear/GitHub label colors), not semantic UI tokens, so a fixed
 * curated palette is intentional. Tones are muted and mid-lightness so they
 * read on both the light (near-white) and dark (near-black) sidebar.
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
