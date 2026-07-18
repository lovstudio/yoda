import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AiLabUserApp } from '@shared/ai-lab';

export class AiLabAppStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<AiLabUserApp[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isStoredApp).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async create(input: {
    name: string;
    description: string;
    prompt: string;
    html: string;
  }): Promise<AiLabUserApp> {
    const apps = await this.list();
    const now = new Date().toISOString();
    const app: AiLabUserApp = {
      id: randomUUID(),
      ...input,
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };
    await this.write([app, ...apps]);
    return app;
  }

  async update(id: string, update: { pinned: boolean }): Promise<AiLabUserApp> {
    const apps = await this.list();
    const index = apps.findIndex((app) => app.id === id);
    const current = apps[index];
    if (!current) throw new Error('AI Lab app not found.');
    const next = { ...current, ...update, updatedAt: new Date().toISOString() };
    apps[index] = next;
    await this.write(apps);
    return next;
  }

  async delete(id: string): Promise<void> {
    const apps = await this.list();
    const next = apps.filter((app) => app.id !== id);
    if (next.length === apps.length) throw new Error('AI Lab app not found.');
    await this.write(next);
  }

  private async write(apps: AiLabUserApp[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(apps, null, 2)}\n`, 'utf8');
    await rename(tempPath, this.filePath);
  }
}

function isStoredApp(value: unknown): value is AiLabUserApp {
  if (!value || typeof value !== 'object') return false;
  const app = value as Partial<AiLabUserApp>;
  return (
    typeof app.id === 'string' &&
    typeof app.name === 'string' &&
    typeof app.description === 'string' &&
    typeof app.prompt === 'string' &&
    typeof app.html === 'string' &&
    typeof app.pinned === 'boolean' &&
    typeof app.createdAt === 'string' &&
    typeof app.updatedAt === 'string'
  );
}
