import fs from 'node:fs';
import path from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const deckDir = path.dirname(fileURLToPath(import.meta.url));
const outlinePath = path.join(deckDir, 'outline.md');
const promptsDir = path.join(deckDir, 'prompts');
const outline = fs.readFileSync(outlinePath, 'utf8');

const styleMatch = outline.match(/<STYLE_INSTRUCTIONS>[\s\S]*?<\/STYLE_INSTRUCTIONS>/);
if (!styleMatch) throw new Error('outline.md 缺少 STYLE_INSTRUCTIONS');

const slideSections = outline
  .split('\n---\n')
  .map((section) => section.trim())
  .filter((section) => /^## Slide \d+ of 18\n/.test(section));
if (slideSections.length !== 18) {
  throw new Error(`预期 18 页，实际解析到 ${slideSections.length} 页`);
}

fs.mkdirSync(promptsDir, { recursive: true });

const preamble = `Create a presentation slide image following these guidelines:

## Image Specifications

- Type: Presentation slide
- Aspect Ratio: 16:9 landscape
- Canvas: 1600 × 900
- Mode: Reading and sharing; every slide must stand alone
- Language: Simplified Chinese

## Core Principles

- Convey ONE clear conclusion per slide.
- Preserve every Chinese phrase and number verbatim.
- Use exact, clean geometric Chinese typography; body text must visually equal at least 20pt.
- Use real referenced product/event images faithfully when supplied; do not redraw or fabricate them.
- Use deterministic flat diagrams, charts and typography for all factual content.
- No slide numbers, decorative borders, glassmorphism, 3D effects, irrelevant stock photos, watermarks, or invented customer evidence.
- The source skill's generic hand-drawn rule is intentionally overridden by this deck's confirmed custom investor style and the user's request for real evidence.
`;

for (const section of slideSections) {
  const slideNumberMatch = section.match(/^## Slide (\d+) of 18/);
  if (!slideNumberMatch) throw new Error('无法解析页码');
  const slideNumber = Number(slideNumberMatch[1]);
  const slideSection = `${section}\n`;
  const filenameMatch = slideSection.match(/\*\*Filename\*\*: (.+\.png)/);
  if (!filenameMatch) throw new Error(`第 ${slideNumber} 页缺少 Filename`);
  const promptFilename = filenameMatch[1].replace(/\.png$/, '.md');
  const prompt = `${preamble}\n## STYLE_INSTRUCTIONS\n\n${styleMatch[0]}\n\n## SLIDE CONTENT\n\n${slideSection}\n## Production Note\n\n+Render with deterministic HTML/CSS/SVG composition so Chinese text, data values, citations and evidence boundaries remain exact. Rasterize the final 1600 × 900 canvas to PNG.\n`;
  fs.writeFileSync(path.join(promptsDir, promptFilename), prompt);
}

stdout.write(`Generated ${slideSections.length} prompts in ${promptsDir}\n`);
