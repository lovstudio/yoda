/** Absolute path of a skill's SKILL.md, honoring the disabled rename. */
export function skillFilePath(localPath: string, disabled = false): string {
  const separator = localPath.includes('\\') && !localPath.includes('/') ? '\\' : '/';
  return `${localPath.replace(/[\\/]+$/, '')}${separator}${
    disabled ? 'SKILL.md.disabled' : 'SKILL.md'
  }`;
}
