import type { RuntimeId } from './runtime-registry';

export const DOCTOR_WINDOW_PARAM = 'doctorWindow';

export type DoctorMainDestination =
  | { view: 'agents'; runtimeId?: RuntimeId }
  | { view: 'skills' }
  | { view: 'mcp' }
  | { view: 'projects' };

export function isDoctorWindowSearch(search: string): boolean {
  return new URLSearchParams(search).get(DOCTOR_WINDOW_PARAM) === '1';
}
