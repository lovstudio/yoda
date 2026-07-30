import { describe, expect, it } from 'vitest';
import { DOCTOR_WINDOW_PARAM, isDoctorWindowSearch } from './doctor-window';

describe('Doctor window launch', () => {
  it('recognizes only the explicit detached window marker', () => {
    expect(isDoctorWindowSearch(`?${DOCTOR_WINDOW_PARAM}=1`)).toBe(true);
    expect(isDoctorWindowSearch(`?${DOCTOR_WINDOW_PARAM}=0`)).toBe(false);
    expect(isDoctorWindowSearch('')).toBe(false);
  });
});
