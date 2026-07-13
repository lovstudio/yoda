import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  SkillEvaluationCase,
  SkillEvaluationRecord,
  SkillEvaluationResult,
} from '@shared/skills/types';

type EvaluationFile = {
  version: 1;
  records: Record<string, SkillEvaluationRecord>;
};

const EMPTY_FILE: EvaluationFile = { version: 1, records: {} };
const MAX_RESULTS_PER_SKILL = 200;

export class SkillEvaluationStore {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private async readFile(): Promise<EvaluationFile> {
    try {
      const parsed = JSON.parse(
        await fs.promises.readFile(this.filePath, 'utf8')
      ) as EvaluationFile;
      if (parsed.version !== 1 || !parsed.records || typeof parsed.records !== 'object') {
        return structuredClone(EMPTY_FILE);
      }
      return parsed;
    } catch {
      return structuredClone(EMPTY_FILE);
    }
  }

  private async writeFile(data: EvaluationFile): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await fs.promises.rename(temporaryPath, this.filePath);
  }

  private mutate(mutator: (data: EvaluationFile) => void): Promise<void> {
    const mutation = this.mutationQueue.then(async () => {
      const data = await this.readFile();
      mutator(data);
      await this.writeFile(data);
    });
    this.mutationQueue = mutation.catch(() => {});
    return mutation;
  }

  async get(skillKey: string): Promise<SkillEvaluationRecord> {
    await this.mutationQueue;
    const data = await this.readFile();
    return (
      data.records[skillKey] ?? {
        skillKey,
        cases: [],
        results: [],
        updatedAt: new Date(0).toISOString(),
      }
    );
  }

  async saveCases(skillKey: string, cases: SkillEvaluationCase[]): Promise<void> {
    const uniqueCases = Array.from(
      new Map(cases.map((testCase) => [testCase.id, testCase])).values()
    );
    await this.mutate((data) => {
      const previous = data.records[skillKey];
      const previousCases = new Map(
        (previous?.cases ?? []).map((testCase) => [testCase.id, testCase])
      );
      const unchangedCaseIds = new Set(
        uniqueCases
          .filter((testCase) => {
            const oldCase = previousCases.get(testCase.id);
            return (
              oldCase?.text === testCase.text &&
              oldCase.expectation === testCase.expectation &&
              oldCase.expectedSkillKey === testCase.expectedSkillKey
            );
          })
          .map((testCase) => testCase.id)
      );
      data.records[skillKey] = {
        skillKey,
        cases: uniqueCases,
        results: (previous?.results ?? []).filter((result) => unchangedCaseIds.has(result.caseId)),
        updatedAt: new Date().toISOString(),
      };
    });
  }

  async recordResult(skillKey: string, result: SkillEvaluationResult): Promise<void> {
    await this.mutate((data) => {
      const previous = data.records[skillKey] ?? {
        skillKey,
        cases: [],
        results: [],
        updatedAt: new Date(0).toISOString(),
      };
      data.records[skillKey] = {
        ...previous,
        results: [...previous.results, result].slice(-MAX_RESULTS_PER_SKILL),
        updatedAt: new Date().toISOString(),
      };
    });
  }
}
