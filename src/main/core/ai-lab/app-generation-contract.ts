const MANIFEST_MARKER = '---YODA_APP_MANIFEST---';
const HTML_MARKER = '---YODA_APP_HTML---';

export type GeneratedAiLabApp = {
  name: string;
  description: string;
  html: string;
};

export function buildAppGenerationPrompt(prompt: string): string {
  return `You are the app generator inside Yoda AI Lab. Build a polished, genuinely useful mini app from the user's natural-language request.

USER REQUEST:
${prompt}

RUNTIME CONTRACT:
- Return one complete HTML document. It runs inside a sandboxed iframe.
- Everything must live in this one file: markup, styles, data, and interaction code.
- Keep the complete document under 24 KB so it can be stored and launched instantly.
- Do not use external scripts, stylesheets, fonts, images, network requests, or package imports. The app must work offline immediately.
- Recreate React/shadcn interaction quality with accessible semantic HTML, reusable JavaScript render functions, restrained design tokens, clear focus states, and polished empty/error states.
- Keep data access behind an explicit async service/repository boundary so a real backend adapter can replace local state without changing the UI.
- When the request needs a backend, implement the API contract and error/loading states against local in-memory data. Do not fake remote success.
- Use localStorage only as an optional enhancement: the sandbox may deny it, so catch storage errors and keep an in-memory fallback.
- Do not attempt to access window.parent, Electron, Node.js, cookies, or the filesystem.
- Make the layout responsive down to 360px. Respect prefers-color-scheme and prefers-reduced-motion.
- No placeholder buttons: every visible control must work.
- Prefer a focused app with one memorable primary workflow over a generic dashboard.

OUTPUT CONTRACT:
Output exactly these two markers and their content, with no Markdown fence or commentary:
${MANIFEST_MARKER}
{"name":"short app name, at most 24 characters","description":"one sentence, at most 80 characters"}
${HTML_MARKER}
<!doctype html>...the complete app...</html>`;
}

export function parseGeneratedAiLabApp(raw: string): GeneratedAiLabApp {
  const manifestIndex = raw.indexOf(MANIFEST_MARKER);
  const htmlIndex = raw.indexOf(HTML_MARKER);
  if (manifestIndex < 0 || htmlIndex <= manifestIndex) {
    throw new Error('The app generator returned an invalid response.');
  }

  const manifestText = raw
    .slice(manifestIndex + MANIFEST_MARKER.length, htmlIndex)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '');
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    throw new Error('The app generator returned an invalid manifest.');
  }
  if (!isAppManifest(manifest)) {
    throw new Error('The app generator returned an incomplete manifest.');
  }

  const html = raw
    .slice(htmlIndex + HTML_MARKER.length)
    .trim()
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/```\s*$/i, '');
  if (!/^<!doctype html>/i.test(html) || !/<\/html>\s*$/i.test(html)) {
    throw new Error('The app generator did not return a complete HTML document.');
  }
  return {
    name: manifest.name.trim().slice(0, 24),
    description: manifest.description.trim().slice(0, 80),
    html,
  };
}

function isAppManifest(value: unknown): value is { name: string; description: string } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { name?: unknown; description?: unknown };
  return (
    typeof candidate.name === 'string' &&
    candidate.name.trim().length > 0 &&
    typeof candidate.description === 'string' &&
    candidate.description.trim().length > 0
  );
}
