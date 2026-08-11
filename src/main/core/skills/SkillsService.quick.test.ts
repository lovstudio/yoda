import { describe, expect, it, vi } from 'vitest';
import { SkillsService } from './SkillsService';

describe('SkillsService lightweight catalog', () => {
  it('uses the audit-free installed skill path for quick picker requests', async () => {
    const service = new SkillsService();
    const getInstalledSkills = vi.spyOn(service, 'getInstalledSkills').mockResolvedValue([]);

    await expect(service.getCatalogIndex(undefined, { lightweight: true })).resolves.toMatchObject({
      version: 4,
      skills: [],
    });
    expect(getInstalledSkills).toHaveBeenCalledWith([], { includeAudit: false });
  });
});
