/** Adds a network-deny CSP without trusting model-authored policy. */
export function applySandboxPolicy(html: string): string {
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'">`;
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${policy}`);
  }
  return html.replace(/<html(?:\s[^>]*)?>/i, (root) => `${root}<head>${policy}</head>`);
}
