import { createRPCController } from '@shared/ipc/rpc';
import type { Paradigm, ParadigmDraft } from '@shared/paradigms/paradigm';
import { paradigmsService } from './paradigms-service';

export const paradigmsController = createRPCController({
  list: (): Promise<Paradigm[]> => paradigmsService.list(),
  get: (id: string): Promise<Paradigm | null> => paradigmsService.get(id),
  create: (draft: ParadigmDraft): Promise<Paradigm> => paradigmsService.create(draft),
  update: (id: string, draft: ParadigmDraft): Promise<Paradigm> =>
    paradigmsService.update(id, draft),
  remove: (id: string): Promise<void> => paradigmsService.remove(id),
  duplicate: (id: string): Promise<Paradigm> => paradigmsService.duplicate(id),
});
