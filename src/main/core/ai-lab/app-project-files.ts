import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  AI_LAB_APP_CAPABILITIES,
  AI_LAB_APP_MANIFEST_PATH,
  AI_LAB_APP_TEMPLATE_VERSION,
  type AiLabAppCapability,
  type AiLabAppManifest,
  type AiLabAppProjectBuild,
} from '@shared/ai-lab';

const TEMPLATE_FILES: Readonly<Record<string, string>> = {
  'package.json': `${JSON.stringify(
    {
      name: 'yoda-app',
      private: true,
      version: '0.1.0',
      type: 'module',
      packageManager: 'pnpm@10.28.2',
      scripts: {
        dev: 'vite',
        build: 'tsc -b && vite build',
        typecheck: 'tsc -b --pretty false',
        check: 'pnpm run typecheck && pnpm run build',
      },
      dependencies: {
        '@radix-ui/react-slot': '^1.2.3',
        'class-variance-authority': '^0.7.1',
        clsx: '^2.1.1',
        'lucide-react': '^0.564.0',
        react: '^19.2.0',
        'react-dom': '^19.2.0',
        'tailwind-merge': '^2.6.0',
      },
      devDependencies: {
        '@tailwindcss/vite': '^4.2.1',
        '@types/react': '^19.0.0',
        '@types/react-dom': '^19.0.0',
        '@vitejs/plugin-react': '^4.7.0',
        tailwindcss: '^4.2.1',
        typescript: '^6.0.2',
        vite: '^6.4.1',
      },
    },
    null,
    2
  )}\n`,
  'tsconfig.json': `${JSON.stringify(
    {
      files: [],
      references: [{ path: './tsconfig.app.json' }, { path: './tsconfig.node.json' }],
    },
    null,
    2
  )}\n`,
  'tsconfig.app.json': `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        useDefineForClassFields: true,
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        allowJs: false,
        skipLibCheck: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        strict: true,
        forceConsistentCasingInFileNames: true,
        module: 'ESNext',
        moduleResolution: 'Bundler',
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: 'react-jsx',
      },
      include: ['src'],
    },
    null,
    2
  )}\n`,
  'tsconfig.node.json': `${JSON.stringify(
    {
      compilerOptions: {
        composite: true,
        skipLibCheck: true,
        module: 'ESNext',
        moduleResolution: 'Bundler',
        allowImportingTsExtensions: true,
        noEmit: true,
      },
      include: ['vite.config.ts'],
    },
    null,
    2
  )}\n`,
  'vite.config.ts': `import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
  },
});
`,
  'index.html': `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <title>Yoda App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
  'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import './lib/yoda';

const root = document.getElementById('root');
if (!root) throw new Error('App root was not found.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
`,
  'src/vite-env.d.ts': `/// <reference types="vite/client" />
`,
  'src/App.tsx': `import { Sparkles } from 'lucide-react';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';

export function App() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="size-5" />
          </div>
          <CardTitle>你的 App 正在创建</CardTitle>
          <CardDescription>Yoda Build Agent 会直接在这个 React 项目中实现你的想法。</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button">开始体验</Button>
        </CardContent>
      </Card>
    </main>
  );
}
`,
  'src/index.css': `@import "tailwindcss";

:root {
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #171717;
  background: #f7f7f5;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  --background: #f7f7f5;
  --foreground: #171717;
  --card: #ffffff;
  --card-foreground: #171717;
  --primary: #18181b;
  --primary-foreground: #fafafa;
  --muted: #f0f0ed;
  --muted-foreground: #73736d;
  --border: #deded8;
  --radius: 0.75rem;
}

@media (prefers-color-scheme: dark) {
  :root {
    color: #f5f5f4;
    background: #171715;
    --background: #171715;
    --foreground: #f5f5f4;
    --card: #222220;
    --card-foreground: #f5f5f4;
    --primary: #fafafa;
    --primary-foreground: #18181b;
    --muted: #2d2d2a;
    --muted-foreground: #aaa9a2;
    --border: #3a3a36;
  }
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --radius-lg: var(--radius);
}

* {
  border-color: var(--border);
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  background: var(--background);
}

button,
input,
textarea,
select {
  font: inherit;
}
`,
  'src/lib/utils.ts': `import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`,
  'src/lib/yoda.ts': `export type YodaImageEditInput = {
  imageDataUrl: string;
  prompt: string;
  size?: '1024x1024' | '1536x1024' | '1024x1536';
  quality?: 'auto' | 'medium' | 'high';
};

export type YodaImageEditResult = {
  imageDataUrl: string;
  model: string;
};

type HostResponse = {
  channel: 'yoda:ai-lab-host:v1';
  kind: 'response';
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

const CHANNEL = 'yoda:ai-lab-host:v1' as const;
const TIMEOUT_MS = 190_000;

function callHost<TResult>(method: string, payload: unknown, timeoutMessage: string) {
  return new Promise<TResult>((resolve, reject) => {
    const requestId = globalThis.crypto?.randomUUID?.() ?? \`\${Date.now()}-\${Math.random()}\`;
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(timeoutMessage));
    }, TIMEOUT_MS);
    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };
    const onMessage = (event: MessageEvent<HostResponse>) => {
      const data = event.data;
      if (
        event.source !== window.parent ||
        data?.channel !== CHANNEL ||
        data.kind !== 'response' ||
        data.requestId !== requestId
      ) {
        return;
      }
      cleanup();
      if (data.ok) resolve(data.result as TResult);
      else reject(new Error(data.error || 'Yoda capability request failed.'));
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage(
      { channel: CHANNEL, kind: 'request', requestId, method, payload },
      '*'
    );
  });
}

export const yoda = Object.freeze({
  ai: Object.freeze({
    editImage: (input: YodaImageEditInput) =>
      callHost<YodaImageEditResult>('images.edit', input, 'Image generation timed out.'),
    copyLastError: () =>
      callHost<{ copied: true }>('errors.copyLast', {}, 'Copying the error timed out.'),
  }),
});

Object.defineProperty(globalThis, 'yoda', {
  configurable: false,
  writable: false,
  value: yoda,
});

declare global {
  interface Window {
    yoda: typeof yoda;
  }
}
`,
  'src/components/ui/button.tsx': `import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:opacity-90',
        secondary: 'bg-muted text-foreground hover:bg-muted/80',
        outline: 'border bg-transparent hover:bg-muted',
        ghost: 'hover:bg-muted',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-11 px-6',
        icon: 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
`,
  'src/components/ui/card.tsx': `import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border bg-card text-card-foreground shadow-sm', className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 p-6', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-xl font-semibold tracking-tight', className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm leading-relaxed text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6 pt-0', className)} {...props} />;
}
`,
  '.gitignore': `node_modules
dist
.DS_Store
*.local
`,
  '.yoda.json': `${JSON.stringify(
    {
      scripts: {
        setup: 'pnpm install --prefer-frozen-lockfile',
        run: 'pnpm dev --host 127.0.0.1',
      },
    },
    null,
    2
  )}\n`,
  'AGENTS.md': `# Yoda App Project

- This is a React, Vite, TypeScript, Tailwind CSS project.
- Build the requested product by editing files directly. Do not paste source code into chat.
- Reuse components in \`src/components/ui\` and add focused components when needed.
- Keep \`.yoda/app.json\` accurate. Set \`status\` to \`ready\` only after \`pnpm run check\` succeeds.
- Declare \`ai.image.edit\` only when the app calls \`window.yoda.ai.editImage\`.
- Do not expose provider names, model IDs, credentials, or host architecture in product UI.
- Do not start a persistent development server from an Agent turn; Yoda manages preview separately.
`,
};

export async function scaffoldAiLabAppProject(projectPath: string, name: string): Promise<void> {
  const manifest: AiLabAppManifest = {
    schemaVersion: 1,
    template: 'react-vite',
    templateVersion: AI_LAB_APP_TEMPLATE_VERSION,
    status: 'draft',
    name: name.trim().slice(0, 80) || 'Yoda App',
    description: 'Yoda Build 正在创建这个应用。',
    capabilities: [],
  };
  const files = {
    ...TEMPLATE_FILES,
    [AI_LAB_APP_MANIFEST_PATH]: `${JSON.stringify(manifest, null, 2)}\n`,
  };
  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const targetPath = join(projectPath, relativePath);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFileIfMissing(targetPath, content);
    })
  );
}

export async function writeLegacyAiLabSource(projectPath: string, html: string): Promise<void> {
  const targetPath = join(projectPath, 'legacy', 'index.html');
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, html, 'utf8');
}

export async function migrateLegacyAiLabAppProject(
  projectPath: string,
  name: string,
  html: string
): Promise<void> {
  const alreadyScaffolded = await fileExists(join(projectPath, AI_LAB_APP_MANIFEST_PATH));
  await writeLegacyAiLabSource(projectPath, html);
  await scaffoldAiLabAppProject(projectPath, name);
  if (!alreadyScaffolded) {
    const indexHtml = TEMPLATE_FILES['index.html'];
    if (!indexHtml) throw new Error('The React App template is incomplete.');
    await writeFile(join(projectPath, 'index.html'), indexHtml, 'utf8');
  }
}

export async function markAiLabAppProjectDraft(projectPath: string): Promise<void> {
  const manifestPath = join(projectPath, AI_LAB_APP_MANIFEST_PATH);
  const manifest = await readManifest(manifestPath);
  await writeFile(
    manifestPath,
    `${JSON.stringify({ ...manifest, status: 'draft' }, null, 2)}\n`,
    'utf8'
  );
}

export async function readAiLabAppProjectBuild(
  projectPath: string,
  builtAfter?: string
): Promise<AiLabAppProjectBuild> {
  const manifest = await readManifest(join(projectPath, AI_LAB_APP_MANIFEST_PATH));
  if (manifest.status !== 'ready') {
    throw new Error(
      'The App project is still marked as draft. Finish the implementation and set .yoda/app.json status to ready.'
    );
  }
  const [, , distStat] = await Promise.all([
    access(join(projectPath, 'src', 'App.tsx')),
    access(join(projectPath, 'src', 'main.tsx')),
    stat(join(projectPath, 'dist', 'index.html')),
  ]);
  const builtAfterTime = builtAfter ? Date.parse(builtAfter) : Number.NaN;
  if (Number.isFinite(builtAfterTime) && distStat.mtimeMs + 1_000 < builtAfterTime) {
    throw new Error('The App project build output is older than this Agent task.');
  }
  const packageJson = parseRecord(
    JSON.parse(await readFile(join(projectPath, 'package.json'), 'utf8'))
  );
  const scripts = parseRecord(packageJson.scripts);
  if (typeof scripts.dev !== 'string' || typeof scripts.build !== 'string') {
    throw new Error('The App project must define dev and build scripts.');
  }
  return {
    name: manifest.name.trim().slice(0, 80),
    description: manifest.description.trim().slice(0, 160),
    runtimeKind: 'react-vite',
    templateVersion: manifest.templateVersion,
    capabilities: manifest.capabilities,
  };
}

async function readManifest(filePath: string): Promise<AiLabAppManifest> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    throw new Error('The App project is missing a valid .yoda/app.json manifest.');
  }
  const record = parseRecord(value);
  if (
    record.schemaVersion !== 1 ||
    record.template !== 'react-vite' ||
    typeof record.templateVersion !== 'number' ||
    (record.status !== 'draft' && record.status !== 'ready') ||
    typeof record.name !== 'string' ||
    !record.name.trim() ||
    typeof record.description !== 'string' ||
    !record.description.trim() ||
    !Array.isArray(record.capabilities) ||
    !record.capabilities.every(isAppCapability)
  ) {
    throw new Error('The App project has an incomplete .yoda/app.json manifest.');
  }
  return {
    schemaVersion: 1,
    template: 'react-vite',
    templateVersion: record.templateVersion,
    status: record.status,
    name: record.name,
    description: record.description,
    capabilities: record.capabilities,
  };
}

function isAppCapability(value: unknown): value is AiLabAppCapability {
  return AI_LAB_APP_CAPABILITIES.some((capability) => capability === value);
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an object.');
  }
  return value as Record<string, unknown>;
}

async function writeFileIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
