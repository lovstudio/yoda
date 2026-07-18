import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { app, clipboard, dialog, nativeImage } from 'electron';
import {
  AI_LAB_CODEX_MODEL,
  AI_LAB_DEFAULT_ZENMUX_MODEL,
  type AiLabEngineId,
  type AiLabEngineStatus,
  type AiLabUserApp,
  type AiLabZenmuxModel,
  type CreateAiLabAppInput,
  type LogoGenerationInput,
  type LogoGenerationListItem,
  type LogoGenerationStatus,
  type UpdateAiLabAppInput,
} from '@shared/ai-lab';
import { resolveCommandPath } from '@main/core/dependencies/probe';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { maasService } from '@main/core/maas/maas-service';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import { aiLabGenerations } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { generateAiLabApp } from './app-generation';
import { AiLabAppStore } from './app-store';
import { generateCodexImages } from './codex-image-engine';
import { buildLogoPrompt } from './logo-prompt';
import { generateZenmuxImages } from './zenmux-image-client';

const HISTORY_LIMIT = 60;
const THUMBNAIL_WIDTH = 256;
const MAX_CANDIDATES = 4;

type GenerationRow = typeof aiLabGenerations.$inferSelect;

function imagesDir(): string {
  return join(app.getPath('userData'), 'ai-lab', 'images');
}

function scratchDir(id: string): string {
  return join(app.getPath('userData'), 'ai-lab', 'tmp', id);
}

function imagePath(fileName: string): string {
  return join(imagesDir(), fileName);
}

function thumbnailPath(fileName: string): string {
  return join(imagesDir(), `${fileName}.thumb.png`);
}

function toDataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

function fileNameSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'logo';
}

export class AiLabService {
  private appStore: AiLabAppStore | null = null;

  private getAppStore(): AiLabAppStore {
    this.appStore ??= new AiLabAppStore(join(app.getPath('userData'), 'ai-lab', 'apps.json'));
    return this.appStore;
  }

  async listApps(): Promise<AiLabUserApp[]> {
    return this.getAppStore().list();
  }

  async createApp(input: CreateAiLabAppInput): Promise<AiLabUserApp> {
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error('Describe the app you want to create.');
    if (prompt.length > 4_000) throw new Error('The app description is too long.');
    const project = projectManager.getProject(input.projectId);
    if (!project) throw new Error('Select a project for Yoda Build.');
    if (!project.ctx.supportsLocalSpawn) {
      throw new Error('Yoda Build currently requires a local project.');
    }
    const generated = await generateAiLabApp({
      prompt,
      projectPath: project.repoPath,
      runtimeId: input.runtimeId,
      model: input.model,
      systemPrompt: input.systemPrompt,
    });
    return this.getAppStore().create({
      ...generated,
      prompt,
      projectId: input.projectId,
      runtimeId: input.runtimeId,
      model: input.model,
    });
  }

  async updateApp(input: UpdateAiLabAppInput): Promise<AiLabUserApp> {
    return this.getAppStore().update(input.id, { pinned: input.pinned });
  }

  async deleteApp(id: string): Promise<void> {
    return this.getAppStore().delete(id);
  }

  async listEngines(): Promise<AiLabEngineStatus[]> {
    const [zenmuxCredentials, codexPath] = await Promise.all([
      maasService.getInferenceCredentials('zenmux'),
      resolveCommandPath('codex', new LocalExecutionContext()),
    ]);
    return [
      {
        id: 'zenmux',
        available: Boolean(zenmuxCredentials),
        reason: zenmuxCredentials ? null : 'not-connected',
      },
      {
        id: 'codex',
        available: Boolean(codexPath),
        reason: codexPath ? null : 'cli-missing',
      },
    ];
  }

  async generateLogo(input: LogoGenerationInput): Promise<LogoGenerationListItem> {
    const brandName = input.brandName.trim();
    if (!brandName) throw new Error('Brand name is required.');

    const id = randomUUID();
    const count = Math.min(MAX_CANDIDATES, Math.max(1, Math.floor(input.count) || 1));
    const prompt = buildLogoPrompt({
      brandName,
      description: input.description,
      styleId: input.styleId,
    });
    const model =
      input.engine === 'codex' ? AI_LAB_CODEX_MODEL : (input.model ?? AI_LAB_DEFAULT_ZENMUX_MODEL);

    const startedAt = Date.now();
    let buffers: Buffer[] = [];
    let error: string | null = null;
    try {
      buffers = await this.runEngine(input.engine, model, prompt, count, id);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      log.warn('[ai-lab] logo generation failed', { engine: input.engine, model, error });
    }

    const images = await this.persistImages(id, buffers);
    const status: LogoGenerationStatus = error ? 'failed' : 'succeeded';
    const [row] = await db
      .insert(aiLabGenerations)
      .values({
        id,
        kind: 'logo',
        brandName,
        description: input.description.trim(),
        styleId: input.styleId,
        engine: input.engine,
        model,
        prompt,
        status,
        error,
        images,
        createdAt: new Date().toISOString(),
      })
      .returning();
    telemetryService.capture('ai_lab_logo_generated', {
      engine: input.engine,
      model,
      status,
      count: images.length,
      durationMs: Date.now() - startedAt,
    });
    if (!row) throw new Error('Failed to record the logo generation.');
    return this.toListItem(row);
  }

  async listGenerations(): Promise<LogoGenerationListItem[]> {
    const rows = await db
      .select()
      .from(aiLabGenerations)
      .orderBy(desc(aiLabGenerations.createdAt))
      .limit(HISTORY_LIMIT);
    return Promise.all(rows.map((row) => this.toListItem(row)));
  }

  /** Full-resolution image as a data URL, loaded on demand for the preview dialog. */
  async getGenerationImage(input: { id: string; index: number }): Promise<string> {
    const fileName = await this.requireImageFileName(input.id, input.index);
    return toDataUrl(await readFile(imagePath(fileName)));
  }

  async saveGenerationImage(input: {
    id: string;
    index: number;
  }): Promise<{ saved: boolean; path: string | null }> {
    const row = await this.requireRow(input.id);
    const fileName = requireFileName(row, input.index);
    const result = await dialog.showSaveDialog({
      defaultPath: `${fileNameSlug(row.brandName)}-logo-${input.index + 1}.png`,
      filters: [{ name: 'PNG', extensions: ['png'] }],
    });
    if (result.canceled || !result.filePath) return { saved: false, path: null };
    await copyFile(imagePath(fileName), result.filePath);
    return { saved: true, path: result.filePath };
  }

  async copyGenerationImage(input: { id: string; index: number }): Promise<void> {
    const fileName = await this.requireImageFileName(input.id, input.index);
    const image = nativeImage.createFromPath(imagePath(fileName));
    if (image.isEmpty()) throw new Error('Image file is missing or unreadable.');
    clipboard.writeImage(image);
  }

  async deleteGeneration(id: string): Promise<void> {
    const row = await this.requireRow(id);
    await Promise.all(
      row.images.flatMap((fileName) => [
        unlink(imagePath(fileName)).catch(() => undefined),
        unlink(thumbnailPath(fileName)).catch(() => undefined),
      ])
    );
    await db.delete(aiLabGenerations).where(eq(aiLabGenerations.id, id));
  }

  private async runEngine(
    engine: AiLabEngineId,
    model: string,
    prompt: string,
    count: number,
    id: string
  ): Promise<Buffer[]> {
    if (engine === 'zenmux') {
      const credentials = await maasService.getInferenceCredentials('zenmux');
      if (!credentials) {
        throw new Error('ZenMux is not connected. Add a ZenMux API key first.');
      }
      return generateZenmuxImages({
        ...credentials,
        model: model as AiLabZenmuxModel,
        prompt,
        count,
      });
    }

    const workDir = scratchDir(id);
    await mkdir(workDir, { recursive: true });
    try {
      return await generateCodexImages({ prompt, count, workDir });
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async persistImages(id: string, buffers: Buffer[]): Promise<string[]> {
    if (buffers.length === 0) return [];
    await mkdir(imagesDir(), { recursive: true });
    return Promise.all(
      buffers.map(async (buffer, index) => {
        const fileName = `${id}-${index + 1}.png`;
        await writeFile(imagePath(fileName), buffer);
        const thumbnail = nativeImage.createFromBuffer(buffer).resize({ width: THUMBNAIL_WIDTH });
        await writeFile(thumbnailPath(fileName), thumbnail.toPNG());
        return fileName;
      })
    );
  }

  private async toListItem(row: GenerationRow): Promise<LogoGenerationListItem> {
    const thumbnails = await Promise.all(
      row.images.map(async (fileName) => {
        try {
          return toDataUrl(await readFile(thumbnailPath(fileName)));
        } catch {
          // Thumbnail missing (e.g. cleaned up manually) — fall back to the full image.
          try {
            return toDataUrl(await readFile(imagePath(fileName)));
          } catch {
            return '';
          }
        }
      })
    );
    return {
      id: row.id,
      brandName: row.brandName,
      description: row.description,
      styleId: row.styleId,
      engine: row.engine as AiLabEngineId,
      model: row.model,
      prompt: row.prompt,
      status: row.status as LogoGenerationStatus,
      error: row.error,
      imageCount: row.images.length,
      createdAt: row.createdAt,
      thumbnails,
    };
  }

  private async requireRow(id: string): Promise<GenerationRow> {
    const [row] = await db
      .select()
      .from(aiLabGenerations)
      .where(eq(aiLabGenerations.id, id))
      .limit(1);
    if (!row) throw new Error('Logo generation not found.');
    return row;
  }

  private async requireImageFileName(id: string, index: number): Promise<string> {
    return requireFileName(await this.requireRow(id), index);
  }
}

function requireFileName(row: GenerationRow, index: number): string {
  const fileName = row.images[index];
  if (!fileName) throw new Error('Image not found in this generation.');
  return fileName;
}

export const aiLabService = new AiLabService();
