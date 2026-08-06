export function promptInvokesSkill(prompt: string): boolean {
  return /(^|[\s([{,])[/$][A-Za-z0-9_:-]+(?=\s|$)/.test(prompt);
}
