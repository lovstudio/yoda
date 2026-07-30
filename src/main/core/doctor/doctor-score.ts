import type { DoctorHealthStatus } from '@shared/doctor';

export function doctorStatus(score: number, inactive = false): DoctorHealthStatus {
  if (inactive) return 'inactive';
  if (score >= 85) return 'healthy';
  if (score >= 60) return 'attention';
  return 'critical';
}
