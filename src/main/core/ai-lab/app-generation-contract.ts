const MANIFEST_MARKER = '---YODA_APP_MANIFEST---';
const HTML_MARKER = '---YODA_APP_HTML---';

export type GeneratedAiLabApp = {
  name: string;
  description: string;
  html: string;
};

export function buildAppGenerationPrompt(
  prompt: string,
  context?: { projectPath?: string; systemPrompt?: string }
): string {
  return `You are the app generator inside Yoda AI Lab. Build a polished, genuinely useful mini app from the user's natural-language request.

${
  context?.projectPath
    ? `PROJECT CONTEXT:\nYou are running read-only inside ${context.projectPath}. Inspect the existing project when useful and reuse its product language, data shapes, design tokens, and API conventions. Do not modify project files.`
    : ''
}
${
  context?.systemPrompt?.trim()
    ? `\nSELECTED AGENT INSTRUCTIONS:\n${context.systemPrompt.trim()}`
    : ''
}

USER REQUEST:
${prompt}

RUNTIME CONTRACT:
- Return one complete HTML document. It runs inside a sandboxed iframe.
- Everything must live in this one file: markup, styles, data, and interaction code.
- Keep the complete document under 24 KB so it can be stored and launched instantly.
- Do not use external scripts, stylesheets, fonts, images, network requests, or package imports. The app must work offline immediately.
- Recreate React/shadcn interaction quality with accessible semantic HTML, reusable JavaScript render functions, restrained design tokens, clear focus states, and polished empty/error states.
- Keep data access behind an explicit async service/repository boundary so a real backend adapter can replace local state without changing the UI.
- When a request needs image restyling or reference-image generation, call the host capability documented below. Do not substitute Canvas filters, local calculations, timers, or fake success for a model result.
- For backend capabilities not listed below, implement honest unavailable/error states against a service boundary. Do not fake remote success.
- Use localStorage only as an optional enhancement: the sandbox may deny it, so catch storage errors and keep an in-memory fallback.
- Do not attempt to access window.parent, Electron, Node.js, cookies, or the filesystem.
- Make the layout responsive down to 360px. Respect prefers-color-scheme and prefers-reduced-motion.
- No placeholder buttons: every visible control must work.
- Prefer a focused app with one memorable primary workflow over a generic dashboard.

HOST CAPABILITY — ZENMUX IMAGE EDIT:
- The sandbox exposes window.yoda.ai.editImage(input). The host obtains the user's configured ZenMux MaaS inference credentials; API keys are never available inside the app.
- Input: { imageDataUrl, prompt, size?, quality? }. imageDataUrl must be a base64 PNG/JPEG/WebP data URL. size is one of "1024x1024", "1536x1024", "1024x1536". quality is "auto", "medium", or "high".
- Output: Promise<{ imageDataUrl, model }>. model is pinned by the host to "openai/gpt-image-2" and imageDataUrl is the actual generated PNG.
- The host sends the source as a multipart image edit with high input fidelity. For portrait restyling, prompts must explicitly preserve the exact person's identity, gender presentation, age, facial geometry, hairstyle, pose, camera angle, clothing, and distinctive objects.
- A complete call looks like: const result = await window.yoda.ai.editImage({ imageDataUrl, prompt, size: "1024x1024", quality: "high" });
- To copy the latest host/model error, call await window.yoda.ai.copyLastError(). This delegates clipboard writing to Yoda because the sandbox cannot access the Clipboard API directly.
- Always show genuine pending and error states around the awaited call. Only show success or enable download after result.imageDataUrl is returned.
- Remote error states must keep the full error message available and include a visible control that copies it to the clipboard.
- The host asks the user for permission before the first paid model call in each open app session.

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

export function extractGeneratedAppFromTranscript(
  blocks: { role: string; content: string }[]
): GeneratedAiLabApp {
  let lastUserIndex = -1;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index]?.role === 'user') {
      lastUserIndex = index;
      break;
    }
  }
  const turnOutput = blocks
    .slice(lastUserIndex + 1)
    .filter((block) => block.role === 'assistant')
    .map((block) => block.content)
    .join('\n\n');
  const candidates = [
    turnOutput,
    ...blocks
      .filter((block) => block.role === 'assistant')
      .map((block) => block.content)
      .reverse(),
  ].filter((candidate, index, all) => candidate.trim() && all.indexOf(candidate) === index);

  let lastError: unknown = new Error('The Yoda Build agent did not return an app.');
  for (const candidate of candidates) {
    try {
      return parseGeneratedAiLabApp(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
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
