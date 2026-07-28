import type { YodaExtensionInstallation } from '@shared/extensions';
import { KV } from '@main/db/kv';

type ExtensionStateSchema = {
  installations: Record<string, YodaExtensionInstallation>;
};

export interface ExtensionStateStore {
  list(): Promise<Record<string, YodaExtensionInstallation>>;
  save(installations: Record<string, YodaExtensionInstallation>): Promise<void>;
}

export class KvExtensionStateStore implements ExtensionStateStore {
  private readonly kv = new KV<ExtensionStateSchema>('extensions');

  async list(): Promise<Record<string, YodaExtensionInstallation>> {
    return (await this.kv.get('installations')) ?? {};
  }

  async save(installations: Record<string, YodaExtensionInstallation>): Promise<void> {
    await this.kv.setStrict('installations', installations);
  }
}
