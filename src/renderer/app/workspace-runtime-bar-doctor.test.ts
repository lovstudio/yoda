import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readRuntimeBarSource } from '@renderer/app/runtime-bar/test-helpers/read-bar-source';

describe('Workspace runtime bar Doctor entry', () => {
  it('opens the Doctor dialog from a labeled bottom-bar action', () => {
    const source = readRuntimeBarSource();
    const registry = readFileSync(new URL('./modal-registry.ts', import.meta.url), 'utf8');
    const doctor = readFileSync(
      new URL('../features/doctor/doctor-modal.tsx', import.meta.url),
      'utf8'
    );
    expect(source).toContain("t('workspaceRuntime.doctor')");
    expect(source).toContain("useShowModal('doctorModal')");
    expect(source).toContain('showDoctorModal({})');
    expect(source).toContain('<Stethoscope');
    expect(registry).toContain(
      "import { DoctorModal } from '@renderer/features/doctor/doctor-modal'"
    );
    expect(registry).toContain("doctorModal: createModal(DoctorModal, { size: 'xl' })");
    expect(doctor).toContain('<DialogHeader');
    expect(doctor).toContain('<h1 className="text-xl font-semibold tracking-tight">{eyebrow}</h1>');
    expect(doctor).not.toContain('h-screen w-screen');
  });
});
